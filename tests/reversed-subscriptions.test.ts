import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  ids: [] as string[],
  retired: [] as string[],
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  adminClient: () => ({
    from: () => {
      const q: Record<string, unknown> = {
        update: () => q,
        select: () => q,
        eq: (_: string, id: string) => {
          state.retired.push(id);
          return q;
        },
        maybeSingle: async () => ({ data: null, error: null }),
      };
      return q;
    },
  }),
}));
vi.mock("@/lib/commerce/http", () => ({
  HttpError: class extends Error {},
  rpc: vi.fn(async () => state.ids),
}));

import { isFullyReversed } from "@/lib/commerce/catalog";
import {
  endsCurrentPeriod,
  retireReversedSubscriptions,
} from "@/lib/commerce/mercadopago";

beforeEach(() => {
  state.ids = [];
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

it("ends the plan only when the refunded charge is the latest of its own cycle", () => {
  // Refunding the latest month ends the plan.
  expect(
    endsCurrentPeriod("oct", [
      { id: "sep", status: "approved", paid_at: "2026-09-01T00:00:00Z" },
      { id: "oct", status: "refunded", paid_at: "2026-10-01T00:00:00Z" },
    ]),
  ).toBe(true);
  // Refunding an older month leaves the current one running.
  expect(
    endsCurrentPeriod("sep", [
      { id: "sep", status: "refunded", paid_at: "2026-09-01T00:00:00Z" },
      { id: "oct", status: "approved", paid_at: "2026-10-01T00:00:00Z" },
    ]),
  ).toBe(false);
  // Refunding the second of two charges of the same renewal keeps the plan.
  expect(
    endsCurrentPeriod("dup", [
      { id: "nov", status: "approved", paid_at: "2026-11-01T00:00:00Z" },
      { id: "dup", status: "refunded", paid_at: "2026-11-01T06:00:00Z" },
    ]),
  ).toBe(false);
  // A refund seen before its approval is dated now: last month does not save it.
  expect(
    endsCurrentPeriod("new", [
      { id: "old", status: "approved", paid_at: "2020-01-01T00:00:00Z" },
      { id: "new", status: "refunded", paid_at: null },
    ]),
  ).toBe(true);
});

it("cancels each subscription the database lists as fully reversed", async () => {
  state.ids = ["sub-refunded"];
  await retireReversedSubscriptions();
  const calls = vi
    .mocked(fetch)
    .mock.calls.map(([url, init]) => [String(url), init?.method]);
  expect(calls).toEqual([
    ["https://api.mercadopago.com/preapproval/sub-refunded", "PUT"],
  ]);
  expect(state.retired).toContain("sub-refunded");
});

it("stops at the deadline it is given", async () => {
  state.ids = ["sub-1", "sub-2"];
  await retireReversedSubscriptions(Date.now() - 1);
  expect(fetch).not.toHaveBeenCalled();
});
