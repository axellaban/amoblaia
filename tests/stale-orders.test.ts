import { beforeEach, afterEach, expect, it, vi } from "vitest";

// Orders left half-way: the case that blocked a real purchase with a 409.
const state = vi.hoisted(() => ({
  stale: [] as Record<string, unknown>[],
  closed: [] as unknown[],
  searches: [] as string[],
  found: [] as { id: string; external_reference: string }[],
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  adminClient: () => ({
    from: () => {
      let update: unknown = null;
      const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        in: () => q,
        is: () => q,
        lt: () => q,
        update: (data: unknown) => {
          update = data;
          return q;
        },
        then: (ok: (v: unknown) => unknown) => {
          if (update) {
            state.closed.push(update);
            return Promise.resolve({ error: null }).then(ok);
          }
          return Promise.resolve({ data: state.stale, error: null }).then(ok);
        },
      };
      return q;
    },
  }),
}));
import { settleStaleOrders } from "../src/lib/commerce/mercadopago";

beforeEach(() => {
  vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "test-token");
  state.closed = [];
  state.searches = [];
  state.found = [];
  state.stale = [
    {
      id: "stuck-order",
      snapshot: { kind: "month" },
      payer_email: null,
    },
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      state.searches.push(String(url));
      return Response.json({ results: state.found });
    }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("closes a subscription order that Mercado Pago never created", async () => {
  await settleStaleOrders("user-1", ["Owner@Example.com", ""]);
  expect(state.searches).toEqual([
    "https://api.mercadopago.com/preapproval/search?payer_email=owner%40example.com&limit=100",
  ]);
  expect(state.closed).toEqual([{ status: "checkout_failed" }]);
});

it("keeps an order that does exist in Mercado Pago instead of closing it", async () => {
  state.found = [
    { id: "someone-else", external_reference: "other-order" },
    { id: "real-sub", external_reference: "stuck-order" },
  ];
  // The adoption itself is covered in subscription-sync.test.ts; here the
  // order must simply not be closed.
  await settleStaleOrders("user-1", ["owner@example.com"]).catch(() => {});
  expect(state.closed).toEqual([]);
});

it("closes a stale pack checkout without asking Mercado Pago", async () => {
  state.stale = [{ id: "pack-order", snapshot: { kind: "pack" } }];
  await settleStaleOrders("user-1", ["owner@example.com"]);
  expect(state.searches).toEqual([]);
  expect(state.closed).toEqual([{ status: "checkout_failed" }]);
});

it("leaves the order blocking when Mercado Pago cannot be checked", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("down", { status: 503 })),
  );
  await expect(
    settleStaleOrders("user-1", ["owner@example.com"]),
  ).rejects.toThrow("MERCADOPAGO_503");
  expect(state.closed).toEqual([]);
});
