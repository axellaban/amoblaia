import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  processed: null as string | null,
  attempts: 0,
  error: "",
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  adminClient: () => ({
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({
          data: { processed_at: state.processed },
          error: null,
        }),
        update: () => q,
        then: (ok: (v: unknown) => unknown) => ok({ error: null }),
      };
      return q;
    },
    rpc: async (_name: string, args: { p_error: string }) => {
      state.attempts++;
      state.error = args.p_error;
      return { error: null };
    },
  }),
}));
import { processInbox } from "../src/lib/commerce/mercadopago";
beforeEach(() => {
  state.processed = null;
  state.attempts = 0;
  state.error = "";
  vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "test-token");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("acknowledges an already processed notification without querying the provider or applying credits again", async () => {
  state.processed = "2026-10-22T23:00:00Z";
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  expect(
    await processInbox("key", "subscription_authorized_payment", "123"),
  ).toBe(true);
  expect(fetcher).not.toHaveBeenCalled();
  expect(state.attempts).toBe(0);
});
it("persists and counts an unresolved invoice instead of marking it processed", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(Response.json({}, { status: 404 }))
      .mockResolvedValueOnce(Response.json({ results: [] })),
  );
  expect(
    await processInbox("key", "subscription_authorized_payment", "123"),
  ).toBe(false);
  expect(state.processed).toBeNull();
  expect(state.attempts).toBe(1);
  expect(state.error).toBe("MERCADOPAGO_404");
});
