import { beforeEach, afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ authorized: true, requests: 0 }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/commerce/http", async (original) => {
  const real = await original<typeof import("../src/lib/commerce/http")>();
  return {
    ...real,
    requireAdmin: async () => {
      if (!state.authorized) throw new real.HttpError(403, "Acceso reservado al equipo.");
      return { id: "owner-id", email: "seller@example.com" };
    },
  };
});
vi.mock("@/lib/commerce/mercadopago", () => ({
  billingStatus: () => ({ ready: true, mode: "production", missing: [] }),
  mp: async () => {
    state.requests++;
    return { id: 123, email: "seller@example.com", site_id: "MLA", country_id: "AR", access_token: "private-do-not-return", tags: [] };
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  adminClient: () => ({
    from: () => {
      const q = {
        select: () => q, eq: () => q, order: () => q, limit: () => q,
        maybeSingle: async () => ({ data: { id: "12345678-0000-4000-8000-000000000000", payer_email: "seller@example.com", created_at: "2026-10-22T22:20:30Z", status: "checkout_failed" }, error: null }),
      };
      return q;
    },
  }),
}));
import { GET } from "../src/app/api/admin/billing/route";
beforeEach(() => { state.authorized = true; state.requests = 0; vi.stubEnv("MERCADOPAGO_COLLECTOR_ID", "123"); });
afterEach(() => vi.unstubAllEnvs());
it("reserves payment diagnostics to admins", async () => {
  state.authorized = false;
  expect((await GET()).status).toBe(403);
  expect(state.requests).toBe(0);
});
it("returns verification flags without emails, credentials or card data", async () => {
  const response = await GET();
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  const body = await response.json();
  expect(body.merchant).toMatchObject({ site: "MLA", country: "AR", collectorMatches: true, loginMatchesSeller: true });
  expect(body.latestAttempt).toMatchObject({ emailMatchesSeller: true, hasEmail: true });
  expect(JSON.stringify(body)).not.toContain("seller@example.com");
  expect(JSON.stringify(body)).not.toContain("private-do-not-return");
});
