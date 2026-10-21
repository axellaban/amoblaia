import { beforeEach, afterEach, expect, it, vi } from "vitest";

// A small in-memory table store: enough of supabase-js for these flows.
const state = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  rpc: [] as { name: string; args: unknown }[],
  calls: [] as string[],
  invoices: [] as { preapproval_id: string; payment?: { id: string } }[],
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  adminClient: () => ({
    rpc: async (name: string, args: unknown) => {
      state.rpc.push({ name, args });
      return { data: null, error: null };
    },
    from: (table: string) => {
      const filters: ((r: Record<string, unknown>) => boolean)[] = [];
      let patch: Record<string, unknown> | null = null;
      const rows = () =>
        (state.tables[table] ||= []).filter((r) => filters.every((f) => f(r)));
      const q: Record<string, unknown> = {
        select: () => q,
        order: () => q,
        limit: () => q,
        eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
        is: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
        in: (k: string, v: unknown[]) => (
          filters.push((r) => v.includes(r[k])),
          q
        ),
        not: (k: string, _op: string, v: unknown) => (
          filters.push((r) => r[k] !== v && r[k] !== undefined),
          q
        ),
        update: (data: Record<string, unknown>) => ((patch = data), q),
        insert: (data: Record<string, unknown>) => {
          (state.tables[table] ||= []).push({ ...data });
          return q;
        },
        single: async () => ({ data: rows()[0], error: null }),
        maybeSingle: async () => {
          if (patch) for (const r of rows()) Object.assign(r, patch);
          return { data: rows()[0] || null, error: null };
        },
        then: (ok: (v: unknown) => unknown) => {
          if (patch) for (const r of rows()) Object.assign(r, patch);
          return Promise.resolve({ data: rows(), error: null }).then(ok);
        },
      };
      return q;
    },
  }),
}));
import {
  finishPlanChanges,
  syncPayment,
  syncSubscriptionPayments,
} from "../src/lib/commerce/mercadopago";

const subscription = (id: string, order: string) => ({
  id,
  collector_id: 123,
  external_reference: order,
  status: "authorized",
  auto_recurring: {
    currency_id: "ARS",
    frequency: 1,
    frequency_type: "months",
    transaction_amount: 20000,
  },
});
beforeEach(() => {
  vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "test-token");
  vi.stubEnv("MERCADOPAGO_COLLECTOR_ID", "123");
  vi.stubEnv("MERCADOPAGO_MODE", "production");
  state.rpc = [];
  state.calls = [];
  state.invoices = [];
  const snapshot = { kind: "month", price_cents: 2000000, photos: 6 };
  state.tables = {
    orders: [
      {
        id: "order-old",
        user_id: "u",
        status: "paid",
        snapshot,
        provider_subscription_id: "sub-old",
      },
      {
        id: "order-new",
        user_id: "u",
        status: "checkout_ready",
        snapshot,
        provider_subscription_id: "sub-new",
        replaces_subscription_id: "sub-old",
      },
    ],
    subscriptions: [
      {
        id: "sub-old",
        order_id: "order-old",
        user_id: "u",
        status: "authorized",
      },
      {
        id: "sub-new",
        order_id: "order-new",
        user_id: "u",
        status: "authorized",
      },
    ],
    payments: [],
    profiles: [{ id: "u", blocked: false }],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace("https://api.mercadopago.com", "");
      state.calls.push(`${init?.method || "GET"} ${path}`);
      if (init?.method === "PUT") return Response.json({ status: "cancelled" });
      if (path.startsWith("/authorized_payments/search"))
        return Response.json({ results: state.invoices });
      if (path.startsWith("/preapproval/sub-old"))
        return Response.json(subscription("sub-old", "order-old"));
      if (path.startsWith("/preapproval/sub-new"))
        return Response.json(subscription("sub-new", "order-new"));
      const id = path.split("/").pop();
      return Response.json({
        id,
        collector_id: 123,
        external_reference: "",
        currency_id: "ARS",
        transaction_amount: 20000,
        status: id === "pay-back" ? "charged_back" : "approved",
        live_mode: true,
        date_approved: "2026-10-21T10:00:00Z",
        date_created: "2026-10-21T10:00:00Z",
      });
    }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("finishes a plan change whose checkout could not retire the old plan", async () => {
  await finishPlanChanges("u");
  expect(state.calls).toContain("PUT /preapproval/sub-old");
  expect(
    state.tables.subscriptions.find((s) => s.id === "sub-old")!.status,
  ).toBe("cancelled");
});

it("leaves alone plan changes that are already complete", async () => {
  state.tables.subscriptions[0].status = "cancelled";
  await finishPlanChanges("u");
  expect(state.calls).toEqual([]);
});

it("applies a subscription's charges without waiting for a notification", async () => {
  state.invoices = [
    { preapproval_id: "sub-new", payment: { id: "pay-1" } },
    { preapproval_id: "sub-new", payment: { id: "pay-known" } },
    { preapproval_id: "sub-new" },
    { preapproval_id: "other", payment: { id: "pay-other" } },
  ];
  state.tables.payments = [{ id: "pay-known", coverage_start: "2026-10-01" }];
  await syncSubscriptionPayments("sub-new");
  const applied = state.rpc
    .filter((c) => c.name === "amobla_apply_payment")
    .map((c) => (c.args as { p_id: string }).p_id);
  expect(applied).toEqual(["pay-1"]);
});

it("stops every open plan when a chargeback blocks the account", async () => {
  // The reversed charge belongs to the old plan; the blocked account must
  // not keep paying the new one either.
  state.tables.subscriptions[0].status = "cancelled";
  state.tables.profiles[0].blocked = true;
  await syncPayment("pay-back", "sub-old");
  expect(state.calls).toContain("PUT /preapproval/sub-new");
});

it("stops only the reversed plan when the account stays open", async () => {
  await syncPayment("pay-back", "sub-old");
  expect(state.calls).toContain("PUT /preapproval/sub-old");
  expect(state.calls).not.toContain("PUT /preapproval/sub-new");
});
