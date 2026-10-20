import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({
  open: null as null | Record<string, unknown>,
  status: "pending",
  calls: [] as unknown[],
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/commerce/http", async (original) => ({
  ...(await original<typeof import("../src/lib/commerce/http")>()),
  requireUser: async () => ({ id: "user-id", email: "google@example.com" }),
  rpc: vi.fn(async (name: string) =>
    name === "amobla_account"
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
        maybeSingle: async () => ({ data: state.open, error: null }),
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
  mp: vi.fn(async (path: string, method = "GET", body?: unknown) => {
    state.calls.push({ path, method, body });
    if (method === "GET")
      return {
        status: state.status,
        external_reference: "old-order",
        collector_id: 123,
      };
    if (method === "PUT") return { status: "cancelled" };
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
