import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ paid: 0 }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  adminClient: () => ({
    from: () => {
      const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        not: async () => ({ count: state.paid, error: null }),
        update: () => ({ eq: async () => ({ error: null }) }),
        maybeSingle: async () => ({ data: null, error: null }),
      };
      return q;
    },
  }),
}));
import {
  endLaunchPrice,
  validatePayment,
  type Order,
  type Payment,
} from "../src/lib/commerce/mercadopago";

const order: Order = {
  id: "order-1",
  user_id: "user-1",
  status: "paid",
  checkout_url: null,
  provider_subscription_id: "sub-1",
  snapshot: {
    sku: "standard-month",
    name: "Agente",
    kind: "month",
    photos: 20,
    versions: 3,
    price_cents: 5390000,
    promo_price_cents: 2690000,
    promo_months: 3,
    active: true,
  },
};
let calls: { method: string; body?: unknown }[] = [];
function provider(amount: number, status = "authorized") {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push({
        method: init?.method || "GET",
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return Response.json({
        id: "sub-1",
        collector_id: 123,
        status,
        auto_recurring: { transaction_amount: amount, currency_id: "ARS" },
      });
    }),
  );
}
beforeEach(() => {
  vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "test-token");
  vi.stubEnv("MERCADOPAGO_COLLECTOR_ID", "123");
  vi.stubEnv("MERCADOPAGO_MODE", "production");
});

describe("Launch price billing", () => {
  it("accepts a renewal at the launch or the list price only", () => {
    const payment: Payment = {
      id: 1,
      collector_id: 123,
      external_reference: "order-1",
      currency_id: "ARS",
      transaction_amount: 26900,
      status: "approved",
      live_mode: true,
      date_approved: null,
      date_created: new Date().toISOString(),
    };
    expect(() => validatePayment(payment, order)).not.toThrow();
    expect(() =>
      validatePayment({ ...payment, transaction_amount: 53900 }, order),
    ).not.toThrow();
    expect(() =>
      validatePayment({ ...payment, transaction_amount: 20000 }, order),
    ).toThrow(/PAYMENT_AMOUNT_MISMATCH/);
  });

  it("keeps the launch price until its months are paid", async () => {
    state.paid = 2;
    provider(26900);
    await endLaunchPrice("sub-1", order);
    expect(calls).toEqual([]);
  });

  it("moves the next renewals to the list price after the third payment", async () => {
    state.paid = 3;
    provider(26900);
    await endLaunchPrice("sub-1", order);
    expect(calls.map((c) => c.method)).toEqual(["GET", "PUT"]);
    expect(calls[1].body).toEqual({
      auto_recurring: { transaction_amount: 53900, currency_id: "ARS" },
    });
  });

  it("does nothing once switched, or for a cancelled subscription", async () => {
    state.paid = 4;
    provider(53900);
    await endLaunchPrice("sub-1", order);
    provider(26900, "cancelled");
    await endLaunchPrice("sub-1", order);
    expect(calls.map((c) => c.method)).toEqual(["GET"]);
  });
});
