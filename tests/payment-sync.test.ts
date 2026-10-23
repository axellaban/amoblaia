import { afterEach, beforeEach, expect, it, vi } from "vitest";
const orderId = "00000000-0000-4000-8000-000000000091";
const state = vi.hoisted(() => ({
  recorded: "approved",
  applied: [] as Record<string, unknown>[],
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  adminClient: () => ({
    from: () => {
      const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        single: async () => ({
          data: {
            id: orderId,
            snapshot: { kind: "pack", price_cents: 499000, photos: 5 },
          },
          error: null,
        }),
        maybeSingle: async () => ({ data: null, error: null }),
      };
      return q;
    },
  }),
}));
vi.mock("@/lib/commerce/http", () => ({
  HttpError: class extends Error {},
  rpc: vi.fn(async (_name: string, args: Record<string, unknown>) => {
    state.applied.push(args);
    return state.recorded;
  }),
}));
import { syncPayment } from "@/lib/commerce/mercadopago";
const payment = (extra: Record<string, unknown>) => ({
  id: 77,
  collector_id: 123,
  external_reference: orderId,
  currency_id: "ARS",
  transaction_amount: 4990,
  status: "approved",
  live_mode: true,
  date_approved: "2026-10-23T10:00:00Z",
  date_created: "2026-10-23T10:00:00Z",
  ...extra,
});
let calls: [string, string][] = [];
function provider(body: Record<string, unknown>) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push([String(url), init?.method || "GET"]);
      return Response.json(String(url).endsWith("/refunds") ? {} : body);
    }),
  );
}
beforeEach(() => {
  state.recorded = "approved";
  state.applied = [];
  vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "token");
  vi.stubEnv("MERCADOPAGO_COLLECTOR_ID", "123");
  vi.stubEnv("MERCADOPAGO_MODE", "production");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("gives back a payment the database recorded as a duplicate", async () => {
  state.recorded = "duplicate";
  provider(payment({}));
  await syncPayment("77");
  expect(calls).toContainEqual([
    "https://api.mercadopago.com/v1/payments/77/refunds",
    "POST",
  ]);
});

it("leaves a refused refund for support instead of retrying it forever", async () => {
  state.recorded = "duplicate";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      String(url).endsWith("/refunds")
        ? Response.json({ message: "insufficient" }, { status: 400 })
        : Response.json(payment({})),
    ),
  );
  await expect(syncPayment("77")).resolves.toBeUndefined();
});

it("does not refund a payment that was credited", async () => {
  provider(payment({}));
  await syncPayment("77");
  expect(calls.some(([url]) => url.endsWith("/refunds"))).toBe(false);
});

it("keeps a chargeback a chargeback even when it reports a refunded amount", async () => {
  state.recorded = "charged_back";
  provider(
    payment({ status: "charged_back", transaction_amount_refunded: 4990 }),
  );
  await syncPayment("77");
  expect(state.applied[0]).toMatchObject({ p_status: "charged_back" });
});

it("records money given back on an approval as a partial refund", async () => {
  provider(payment({ transaction_amount_refunded: 1000 }));
  await syncPayment("77");
  expect(state.applied[0]).toMatchObject({ p_status: "partially_refunded" });
});
