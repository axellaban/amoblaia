import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: [] as { id: string; orders: { payments: { status: string }[] } }[],
  retired: [] as string[],
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  adminClient: () => ({
    from: () => {
      const q: Record<string, unknown> = {
        select: () => q,
        in: () => q,
        eq: (_: string, id: string) => {
          state.retired.push(id);
          return q;
        },
        update: () => q,
        limit: async () => ({ data: state.rows, error: null }),
        maybeSingle: async () => ({ data: null, error: null }),
      };
      return q;
    },
  }),
}));
vi.mock("@/lib/commerce/http", () => ({
  HttpError: class extends Error {},
  rpc: vi.fn(),
}));

import { isFullyReversed } from "@/lib/commerce/catalog";
import { retireReversedSubscriptions } from "@/lib/commerce/mercadopago";

beforeEach(() => {
  state.rows = [];
  state.retired = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 200 })),
  );
  process.env.MERCADOPAGO_ACCESS_TOKEN = "TEST-token";
});

it("only treats a plan as reversed when nothing is still paid for", () => {
  expect(isFullyReversed(["refunded"])).toBe(true);
  expect(isFullyReversed(["charged_back", "rejected"])).toBe(true);
  expect(isFullyReversed(["refunded", "approved"])).toBe(false);
  expect(isFullyReversed(["partially_refunded"])).toBe(false);
  expect(isFullyReversed([])).toBe(false);
});

it("cancels open subscriptions whose only charge was refunded", async () => {
  state.rows = [
    { id: "sub-refunded", orders: { payments: [{ status: "refunded" }] } },
    { id: "sub-paid", orders: { payments: [{ status: "approved" }] } },
    { id: "sub-unpaid", orders: { payments: [] } },
  ];
  await retireReversedSubscriptions();
  const calls = vi
    .mocked(fetch)
    .mock.calls.map(([url, init]) => [String(url), init?.method]);
  expect(calls).toEqual([
    ["https://api.mercadopago.com/preapproval/sub-refunded", "PUT"],
  ]);
  expect(state.retired).toContain("sub-refunded");
});
