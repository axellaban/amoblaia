import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({
  open: null as null | Record<string, unknown>,
  status: "pending",
  calls: [] as unknown[],
  fail: "",
  current: null as null | Record<string, unknown>,
  cancelFails: false,
  rpcArgs: [] as unknown[],
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/commerce/http", async (original) => ({
  ...(await original<typeof import("../src/lib/commerce/http")>()),
  requireUser: async () => ({ id: "user-id", email: "google@example.com" }),
  rpc: vi.fn(async (name: string, args: unknown) =>
    (state.rpcArgs.push({ name, args }), name === "amobla_account")
      ? { blocked: false }
      : {
          dispatch: true,
          order: {
            snapshot: { kind: "month", name: "Inicial", price_cents: 2000000 },
          },
        },
  ),
}));
vi.mock("@/lib/supabase/server", () => ({
  adminClient: () => ({
    from: (table: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        not: () => q,
        order: () => q,
        limit: () => q,
        in: () => q,
        maybeSingle: async () => ({
          data: table === "subscriptions" ? state.current : state.open,
          error: null,
        }),
        update: (data: unknown) => {
          state.calls.push({ table, data });
          return q;
        },
        insert: (data: unknown) => {
          state.calls.push({ table, data });
          return q;
        },
        then: (resolve: (v: unknown) => unknown) => resolve({ error: null }),
      };
      return q;
    },
  }),
}));
vi.mock("@/lib/commerce/mercadopago", () => ({
  billingConfigured: () => true,
  isDuplicateSubscription: () => false,
  settleStaleOrders: vi.fn(async () => {}),
  mp: vi.fn(async (path: string, method = "GET", body?: unknown) => {
    state.calls.push({ path, method, body });
    if (method === "GET")
      return {
        status: state.status,
        external_reference: "old-order",
        collector_id: 123,
      };
    if (method === "PUT") {
      if (state.cancelFails && path.includes("current-sub"))
        throw new Error("MERCADOPAGO_500");
      return { status: "cancelled" };
    }
    if (state.fail) throw new Error(state.fail);
    return {
      id: "new-sub",
      init_point:
        "https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_id=new-sub",
    };
  }),
}));
import { POST } from "../src/app/api/checkout/route";
beforeEach(() => {
  state.open = null;
  state.status = "pending";
  state.calls = [];
  state.fail = "";
  state.current = null;
  state.cancelFails = false;
  state.rpcArgs = [];
  vi.stubEnv("MERCADOPAGO_MODE", "production");
  vi.stubEnv("MERCADOPAGO_COLLECTOR_ID", "123");
  vi.stubEnv("APP_URL", "https://amobla.example");
  vi.stubEnv("MERCADOPAGO_NOTIFICATION_TOKEN", "private-notification-token");
});
afterEach(() => vi.unstubAllEnvs());
const request = (payerEmail?: string) =>
  new Request("https://amobla.example/api/checkout", {
    method: "POST",
    headers: {
      Origin: "https://amobla.example",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sku: "basic-month",
      key: "00000000-0000-4000-8000-000000000001",
      payerEmail,
    }),
  });
describe("Mercado Pago payer identity", () => {
  it("requires the payment email instead of silently using the Google email", async () => {
    expect((await POST(request())).status).toBe(400);
    expect(state.calls).toEqual([]);
  });
  it("binds the checkout to the explicitly entered normalized payment email", async () => {
    const r = await POST(request("  MP-Buyer@example.com  "));
    expect(r.status).toBe(200);
    expect(state.calls).toContainEqual(
      expect.objectContaining({
        path: "/preapproval",
        method: "POST",
        body: expect.objectContaining({ payer_email: "mp-buyer@example.com" }),
      }),
    );
  });
  it("reuses a pending checkout only when its stored payer email matches", async () => {
    state.open = {
      id: "old-order",
      payer_email: "mp@example.com",
      checkout_url: "https://www.mercadopago.com.ar/old",
      provider_subscription_id: "old-sub",
    };
    const r = await POST(request("mp@example.com"));
    expect(await r.json()).toEqual({
      url: "https://www.mercadopago.com.ar/old",
    });
    expect(state.calls).toEqual([]);
  });
  it("replaces a legacy wrong-email checkout and cancels its pending provider subscription", async () => {
    state.open = {
      id: "old-order",
      payer_email: null,
      checkout_url: "https://www.mercadopago.com.ar/old",
      provider_subscription_id: "old-sub",
    };
    expect((await POST(request("mp@example.com"))).status).toBe(200);
    expect(state.calls).toContainEqual({
      path: "/preapproval/old-sub",
      method: "PUT",
      body: { status: "cancelled" },
    });
    expect(state.calls).toContainEqual({
      table: "orders",
      data: { status: "superseded" },
    });
  });
  it("does not cancel a subscription that is already authorized", async () => {
    state.open = {
      id: "old-order",
      payer_email: null,
      checkout_url: "https://www.mercadopago.com.ar/old",
      provider_subscription_id: "old-sub",
    };
    state.status = "authorized";
    expect((await POST(request("mp@example.com"))).status).toBe(409);
    expect(
      state.calls.some((c) => (c as { method?: string }).method === "PUT"),
    ).toBe(false);
  });
});
const cardRequest = (cardToken: unknown) =>
  new Request("https://amobla.example/api/checkout", {
    method: "POST",
    headers: {
      Origin: "https://amobla.example",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sku: "basic-month",
      key: "00000000-0000-4000-8000-000000000002",
      cardToken,
    }),
  });
describe("Card subscriptions", () => {
  it("creates an authorized subscription with the account email, no Mercado Pago login", async () => {
    const r = await POST(cardRequest("a1b2c3d4e5f60718293a4b5c6d7e8f90"));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ subscribed: true, changed: false });
    expect(state.calls).toContainEqual(
      expect.objectContaining({
        path: "/preapproval",
        method: "POST",
        body: expect.objectContaining({
          status: "authorized",
          card_token_id: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
          payer_email: "google@example.com",
          auto_recurring: expect.objectContaining({
            transaction_amount: 20000,
            currency_id: "ARS",
          }),
        }),
      }),
    );
    expect(state.calls).toContainEqual({
      table: "subscriptions",
      data: expect.objectContaining({ id: "new-sub", status: "authorized" }),
    });
  });
  it("closes the order and asks for another card when Mercado Pago declines it", async () => {
    state.fail = "MERCADOPAGO_400";
    const r = await POST(cardRequest("a1b2c3d4e5f60718293a4b5c6d7e8f90"));
    expect(r.status).toBe(402);
    expect(state.calls).toContainEqual({
      table: "orders",
      data: { status: "checkout_failed" },
    });
  });
  it("keeps an uncertain provider error for review instead of retrying", async () => {
    state.fail = "MERCADOPAGO_500";
    expect(
      (await POST(cardRequest("a1b2c3d4e5f60718293a4b5c6d7e8f90"))).status,
    ).toBe(500);
    expect(state.calls).toContainEqual({
      table: "orders",
      data: { status: "checkout_needs_review" },
    });
  });
  it("rejects a malformed card token before calling Mercado Pago", async () => {
    expect((await POST(cardRequest("<script>"))).status).toBe(400);
    expect(state.calls).toEqual([]);
  });
  it("does not open a checkout when Mercado Pago only rate-limits the request", async () => {
    state.fail = "MERCADOPAGO_429";
    expect(
      (await POST(cardRequest("a1b2c3d4e5f60718293a4b5c6d7e8f90"))).status,
    ).toBe(500);
    expect(state.calls).toContainEqual({
      table: "orders",
      data: { status: "checkout_needs_review" },
    });
  });
});
describe("Plan changes", () => {
  const token = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
  beforeEach(() => {
    state.current = {
      id: "current-sub",
      order_id: "current-order",
      status: "authorized",
      orders: { sku: "standard-month" },
    };
  });
  it("replaces the current plan and cancels it only after the new one is authorized", async () => {
    const r = await POST(cardRequest(token));
    expect(await r.json()).toEqual({ subscribed: true, changed: true });
    expect(state.rpcArgs).toContainEqual({
      name: "amobla_create_order",
      args: expect.objectContaining({ p_replace: true }),
    });
    const created = state.calls.findIndex(
      (c) => (c as { path?: string }).path === "/preapproval",
    );
    const cancelled = state.calls.findIndex(
      (c) => (c as { path?: string }).path === "/preapproval/current-sub",
    );
    expect(created).toBeGreaterThanOrEqual(0);
    expect(cancelled).toBeGreaterThan(created);
    expect(state.calls).toContainEqual({
      table: "subscriptions",
      data: { status: "cancelled" },
    });
  });
  it("rolls back the new plan when the old one cannot be cancelled", async () => {
    state.cancelFails = true;
    const r = await POST(cardRequest(token));
    expect(r.status).toBe(502);
    expect(state.calls).toContainEqual({
      path: "/preapproval/new-sub",
      method: "PUT",
      body: { status: "cancelled" },
    });
    expect(state.calls).not.toContainEqual({
      table: "subscriptions",
      data: { status: "cancelled" },
    });
  });
  it("refuses to buy the plan the user already has", async () => {
    state.current = { ...state.current, orders: { sku: "basic-month" } };
    expect((await POST(cardRequest(token))).status).toBe(409);
    expect(state.calls).toEqual([]);
  });
  it("keeps a first purchase compatible with the database before the migration", async () => {
    state.current = null;
    await POST(cardRequest(token));
    const call = state.rpcArgs.find(
      (c) => (c as { name: string }).name === "amobla_create_order",
    ) as { args: Record<string, unknown> };
    expect(call.args).not.toHaveProperty("p_replace");
  });
});
