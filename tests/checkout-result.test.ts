import { afterEach, beforeEach, expect, it, vi } from "vitest";
const orderId = "00000000-0000-4000-8000-000000000001";
const state = vi.hoisted(() => ({
  order: {} as Record<string, unknown> | null,
  payments: [] as Record<string, unknown>[],
  invoiceSub: "sub-1",
  invoicePayment: "payment-1",
  providerStatus: "pending",
  fail: false,
  synced: [] as string[],
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  adminClient: () => ({
    from: (table: string) => {
      let owner = "";
      const q = {
        select: () => q,
        eq: (column: string, value: string) => {
          if (column === "user_id") owner = value;
          return q;
        },
        order: () => q,
        limit: () => q,
        maybeSingle: async () => ({
          data: owner === "user-1" ? state.order : null,
          error: null,
        }),
        single: async () => ({ data: state.order, error: null }),
        then: (ok: (value: unknown) => unknown) =>
          ok({
            data: table === "payments" ? state.payments : state.order,
            error: null,
          }),
      };
      return q;
    },
  }),
}));
vi.mock("@/lib/commerce/mercadopago", async (original) => ({
  ...(await original<typeof import("../src/lib/commerce/mercadopago")>()),
  syncSubscription: vi.fn(async () => {
    if (state.fail) throw new Error("PROVIDER_UNAVAILABLE");
    return { sub: { id: "sub-1", status: state.providerStatus } };
  }),
  syncPayment: vi.fn(async (id: string) => {
    state.synced.push(id);
  }),
  mp: vi.fn(async () => ({
    results: [
      {
        preapproval_id: state.invoiceSub,
        payment: { id: state.invoicePayment },
      },
    ],
  })),
}));
import { reconcileCheckout } from "../src/lib/commerce/reconcile";
import { checkoutUrl } from "../src/lib/commerce/mercadopago";
beforeEach(() => {
  state.order = {
    id: orderId,
    user_id: "user-1",
    status: "checkout_ready",
    provider_subscription_id: "sub-1",
    checkout_url: "https://www.mercadopago.com.ar/checkout",
    snapshot: { kind: "month", name: "Inicial" },
  };
  state.payments = [];
  state.providerStatus = "pending";
  state.invoiceSub = "sub-1";
  state.invoicePayment = "payment-1";
  state.fail = false;
  state.synced = [];
});
afterEach(() => vi.unstubAllGlobals());
it("checks ownership before contacting Mercado Pago", async () => {
  await expect(
    reconcileCheckout("another-user", orderId),
  ).rejects.toMatchObject({ status: 404 });
  expect(state.synced).toEqual([]);
});
it("does not call an authorization a paid purchase", async () => {
  state.providerStatus = "authorized";
  expect((await reconcileCheckout("user-1", orderId)).state).toBe("pending");
});
it("resumes an abandoned checkout with its server-verified destination", async () => {
  const result = await reconcileCheckout("user-1", orderId);
  expect(result.state).toBe("ready");
  expect(result.url).toBe("https://www.mercadopago.com.ar/checkout");
});
it("only reconciles invoices that actually belong to this subscription", async () => {
  state.invoiceSub = "someone-elses-subscription";
  await reconcileCheckout("user-1", orderId);
  expect(state.synced).toEqual([]);
});
it("confirms a payment only after its coverage has been applied in the database", async () => {
  state.payments = [{ status: "approved", coverage_start: null }];
  expect((await reconcileCheckout("user-1", orderId)).state).not.toBe(
    "approved",
  );
  state.payments[0].coverage_start = "2026-10-22T00:00:00Z";
  expect((await reconcileCheckout("user-1", orderId)).state).toBe("approved");
});
it("keeps a provider outage under review without offering another checkout", async () => {
  state.fail = true;
  const result = await reconcileCheckout("user-1", orderId);
  expect(result.state).toBe("review");
  expect(result.url).toBeNull();
});
it.each(["rejected", "pending", "refunded", "cancelled"])(
  "reports the verified %s outcome without granting approval",
  async (status) => {
    state.payments = [{ status, coverage_start: null }];
    if (status === "cancelled") state.order!.status = "cancelled";
    expect((await reconcileCheckout("user-1", orderId)).state).toBe(status);
  },
);
it.each([
  "http://www.mercadopago.com.ar/pay",
  "https://mercadopago.com.ar.evil.example/pay",
  "https://evil.example/pay",
  "https://user@mercadopago.com.ar/pay",
  "https://mercadopago.com.ar:8443/pay",
])("rejects an unsafe checkout URL: %s", (url) => {
  expect(() => checkoutUrl(url)).toThrow("INVALID_CHECKOUT_URL");
});
