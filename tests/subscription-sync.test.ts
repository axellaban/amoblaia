import { beforeEach, afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  order: {} as Record<string, unknown>,
  writes: [] as { table: string; data: unknown }[],
  insertError: null as null | { code: string; message: string },
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  adminClient: () => ({
    from: (table: string) => {
      let pending: unknown = null;
      const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        is: () => q,
        single: async () => ({ data: { ...state.order }, error: null }),
        maybeSingle: async () => ({ data: null, error: null }),
        update: (data: Record<string, unknown>) => {
          state.writes.push({ table, data });
          if (table === "orders") Object.assign(state.order, data);
          return q;
        },
        insert: (data: unknown) => {
          pending = data;
          return q;
        },
        then: (ok: (v: unknown) => unknown) => {
          if (pending) {
            state.writes.push({ table, data: pending });
            return Promise.resolve({ error: state.insertError }).then(ok);
          }
          return Promise.resolve({ error: null }).then(ok);
        },
      };
      return q;
    },
  }),
}));
import {
  isDuplicateSubscription,
  syncSubscription,
} from "../src/lib/commerce/mercadopago";

beforeEach(() => {
  vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "test-token");
  vi.stubEnv("MERCADOPAGO_COLLECTOR_ID", "123");
  state.writes = [];
  state.insertError = null;
  state.order = {
    id: "order-1",
    user_id: "user-1",
    status: "checkout_needs_review",
    provider_subscription_id: null,
    snapshot: { kind: "month", price_cents: 2000000, photos: 6 },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        id: "sub-1",
        collector_id: 123,
        external_reference: "order-1",
        status: "authorized",
        auto_recurring: {
          currency_id: "ARS",
          frequency: 1,
          frequency_type: "months",
          transaction_amount: 20000,
        },
      }),
    ),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("adopts a subscription whose id was never saved, so the payment is not stranded", async () => {
  await syncSubscription("sub-1");
  expect(state.writes).toContainEqual({
    table: "orders",
    data: {
      provider_subscription_id: "sub-1",
      checkout_id: "sub-1",
      status: "checkout_ready",
    },
  });
  expect(state.writes).toContainEqual({
    table: "subscriptions",
    data: {
      id: "sub-1",
      order_id: "order-1",
      user_id: "user-1",
      status: "authorized",
    },
  });
});

it("does not adopt into an order bound to another subscription", async () => {
  state.order.provider_subscription_id = "other-sub";
  state.order.status = "checkout_ready";
  await expect(syncSubscription("sub-1")).rejects.toThrow(
    "SUBSCRIPTION_MISMATCH",
  );
});

it("retries instead of ignoring a clash with another open subscription", async () => {
  state.order.provider_subscription_id = "sub-1";
  state.insertError = {
    code: "23505",
    message: 'duplicate key value violates "subscriptions_one_open"',
  };
  await expect(syncSubscription("sub-1")).rejects.toThrow(
    "SUBSCRIPTION_SAVE_FAILED",
  );
});

it("tells a repeated insert apart from a second open subscription", () => {
  expect(
    isDuplicateSubscription({ code: "23505", message: "subscriptions_pkey" }),
  ).toBe(true);
  expect(
    isDuplicateSubscription({
      code: "23505",
      message: "subscriptions_one_open",
    }),
  ).toBe(false);
});
