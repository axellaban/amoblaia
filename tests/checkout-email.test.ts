import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  open: [] as Record<string, unknown>[],
  current: null as Record<string, unknown> | null,
  calls: [] as {
    path?: string;
    method?: string;
    body?: unknown;
    table?: string;
    data?: unknown;
  }[],
  rpcArgs: [] as { name: string; args: Record<string, unknown> }[],
  providerStatus: "pending",
  fail: 0,
  reason: "",
  dispatch: true,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/commerce/http", async (original) => ({
  ...(await original<typeof import("../src/lib/commerce/http")>()),
  requireUser: async () => ({ id: "user-id", email: "google@example.com" }),
  rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
    state.rpcArgs.push({ name, args });
    return name === "amobla_account"
      ? { blocked: false }
      : {
          dispatch: state.dispatch,
          order: {
            status: "creating",
            snapshot: {
              kind: String(args.p_sku).startsWith("pack-")
                ? "pack"
                : String(args.p_sku).endsWith("-year")
                  ? "year"
                  : "month",
              name: "Inicial",
              price_cents: 2000000,
            },
          },
        };
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  adminClient: () => ({
    from: (table: string) => {
      let mutation = false;
      const q = {
        select: () => q,
        eq: () => q,
        not: () => q,
        order: () => q,
        limit: () => q,
        in: () => q,
        maybeSingle: async () => ({ data: state.current, error: null }),
        update: (data: unknown) => {
          mutation = true;
          state.calls.push({ table, data });
          return q;
        },
        then: (resolve: (v: unknown) => unknown) =>
          resolve({ error: null, data: mutation ? null : state.open }),
      };
      return q;
    },
  }),
}));
vi.mock("@/lib/commerce/mercadopago", async (original) => {
  const real =
    await original<typeof import("../src/lib/commerce/mercadopago")>();
  return {
    ...real,
    billingConfigured: () => true,
    settleStaleOrders: vi.fn(async () => {}),
    verifyCheckoutPayer: vi.fn(async (email: string) => {
      if (email === "seller@example.com") {
        const { HttpError } = await import("../src/lib/commerce/http");
        throw new HttpError(
          400,
          "Usá una cuenta compradora distinta de la vendedora.",
        );
      }
    }),
    syncSubscription: vi.fn(async (id: string) => ({
      sub: { id, status: state.providerStatus },
      order: {},
    })),
    retireSubscription: vi.fn(async (id: string) => {
      state.calls.push({
        path: `/preapproval/${id}`,
        method: "PUT",
        body: { status: "cancelled" },
      });
    }),
    mp: vi.fn(async (path: string, method: string, body: unknown) => {
      state.calls.push({ path, method, body });
      if (state.fail) throw new real.MercadoPagoError(state.fail, state.reason);
      return {
        id: "new-sub",
        status: "pending",
        init_point:
          "https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_id=new-sub",
        sandbox_init_point: "https://sandbox.mercadopago.com.ar/pay",
      };
    }),
  };
});
import { POST } from "../src/app/api/checkout/route";
const key = "00000000-0000-4000-8000-000000000001";
const request = (patch: Record<string, unknown> = {}) =>
  new Request("https://amobla.example/api/checkout", {
    method: "POST",
    headers: {
      Origin: "https://amobla.example",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sku: "basic-month",
      key,
      payerEmail: "buyer@example.com",
      ...patch,
    }),
  });
beforeEach(() => {
  Object.assign(state, {
    open: [],
    current: null,
    calls: [],
    rpcArgs: [],
    providerStatus: "pending",
    fail: 0,
    reason: "",
    dispatch: true,
  });
  vi.stubEnv("MERCADOPAGO_MODE", "production");
  vi.stubEnv("APP_URL", "https://amobla.example");
  vi.stubEnv("MERCADOPAGO_NOTIFICATION_TOKEN", "private-notification-token");
});
afterEach(() => vi.unstubAllEnvs());
describe("Hosted checkout", () => {
  it("creates a pending subscription with an explicit payer and an order-bound return URL", async () => {
    expect(
      (await POST(request({ payerEmail: " MP-Buyer@example.com " }))).status,
    ).toBe(200);
    expect(state.calls).toContainEqual(
      expect.objectContaining({
        path: "/preapproval",
        method: "POST",
        body: expect.objectContaining({
          payer_email: "mp-buyer@example.com",
          status: "pending",
          external_reference: key,
          back_url: `https://amobla.example/cuenta?orden=${key}&pago=retorno`,
          auto_recurring: {
            frequency: 1,
            frequency_type: "months",
            transaction_amount: 20000,
            currency_id: "ARS",
          },
        }),
      }),
    );
    expect(JSON.stringify(state.calls)).not.toContain("card_token_id");
    expect(state.calls.some((c) => c.table === "subscriptions")).toBe(false);
  });
  it.each([
    undefined,
    "",
    "bad",
    ["buyer@example.com"],
    "x".repeat(255) + "@example.com",
  ])(
    "does not replace an invalid payer with Google: %s",
    async (payerEmail) => {
      expect((await POST(request({ payerEmail }))).status).toBe(400);
      expect(state.calls).toEqual([]);
    },
  );
  it("rejects stale embedded-card submissions before creating anything", async () => {
    const r = await POST(request({ cardToken: "old-token" }));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toContain("Recargá");
    expect(state.calls).toEqual([]);
    expect(state.rpcArgs).toEqual([]);
  });
  it("rejects the merchant's own payer identity before reserving an order", async () => {
    expect(
      (await POST(request({ payerEmail: " SELLER@EXAMPLE.COM " }))).status,
    ).toBe(400);
    expect(state.calls).toEqual([]);
    expect(state.rpcArgs).toEqual([]);
  });
  it("preserves annual recurrence and charges the full catalog amount", async () => {
    await POST(request({ sku: "basic-year" }));
    expect(state.calls).toContainEqual(
      expect.objectContaining({
        body: expect.objectContaining({
          auto_recurring: expect.objectContaining({
            frequency: 12,
            transaction_amount: 20000,
          }),
        }),
      }),
    );
  });
  it("uses Pro for a pack without binding its payer to Google", async () => {
    const r = await POST(request({ sku: "pack-10", payerEmail: undefined }));
    expect(r.status).toBe(200);
    const body = state.calls.find((c) => c.path === "/checkout/preferences")
      ?.body as Record<string, unknown>;
    expect(body).not.toHaveProperty("payer");
    expect(body.external_reference).toBe(key);
    expect(body.back_urls).toEqual(
      expect.objectContaining({
        success: `https://amobla.example/cuenta?orden=${key}&pago=retorno`,
      }),
    );
  });
  it("reuses a link only after the provider confirms it is still pending", async () => {
    state.open = [
      {
        id: "old-order",
        sku: "basic-month",
        payer_email: "buyer@example.com",
        checkout_url: "https://www.mercadopago.com.ar/old",
        provider_subscription_id: "old-sub",
      },
    ];
    expect(await (await POST(request())).json()).toEqual({
      url: "https://www.mercadopago.com.ar/old",
      order: "old-order",
    });
    expect(state.calls).toEqual([]);
  });
  it("never cancels or reopens a checkout that became authorized", async () => {
    state.open = [
      {
        id: "old-order",
        sku: "basic-month",
        payer_email: "buyer@example.com",
        checkout_url: "https://www.mercadopago.com.ar/old",
        provider_subscription_id: "old-sub",
      },
    ];
    state.providerStatus = "authorized";
    expect((await POST(request())).status).toBe(409);
    expect(state.calls).toEqual([]);
  });
  it("replaces a pending checkout when its payer changes", async () => {
    state.open = [
      {
        id: "old-order",
        sku: "basic-month",
        payer_email: "wrong@example.com",
        checkout_url: "https://www.mercadopago.com.ar/old",
        provider_subscription_id: "old-sub",
      },
    ];
    expect((await POST(request())).status).toBe(200);
    expect(state.calls).toContainEqual({
      path: "/preapproval/old-sub",
      method: "PUT",
      body: { status: "cancelled" },
    });
  });
  it("opens a plan change without cancelling the active plan", async () => {
    state.current = {
      id: "current-sub",
      order_id: "current-order",
      orders: { sku: "standard-month" },
    };
    state.open = [
      { id: "current-order", provider_subscription_id: "current-sub" },
    ];
    expect((await POST(request())).status).toBe(200);
    expect(state.rpcArgs).toContainEqual({
      name: "amobla_create_order",
      args: expect.objectContaining({ p_replace: true }),
    });
    expect(state.calls.some((c) => c.method === "PUT")).toBe(false);
  });
  it("refuses a new purchase of the active plan", async () => {
    state.current = {
      id: "current-sub",
      order_id: "current-order",
      orders: { sku: "basic-month" },
    };
    expect((await POST(request())).status).toBe(409);
    expect(state.calls).toEqual([]);
  });
  it.each([408, 409, 429, 500])(
    "keeps uncertain failures under review, including HTTP %s",
    async (status) => {
      state.fail = status;
      expect((await POST(request())).status).toBe(500);
      expect(state.calls).toContainEqual({
        table: "orders",
        data: { status: "checkout_needs_review" },
      });
    },
  );
  it("closes a definite refusal without exposing provider details", async () => {
    state.fail = 400;
    state.reason = '{"message":"technical private diagnostic"}';
    const r = await POST(request());
    expect(r.status).toBe(402);
    expect((await r.json()).error).not.toContain("technical");
    expect(state.calls).toContainEqual({
      table: "orders",
      data: { status: "checkout_failed" },
    });
  });
  it("does not re-dispatch an idempotent order whose result is uncertain", async () => {
    state.dispatch = false;
    expect((await POST(request())).status).toBe(409);
    expect(state.calls.some((c) => c.method === "POST")).toBe(false);
  });
});
