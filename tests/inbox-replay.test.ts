import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  processed: null as string | null,
  attempts: 0,
  error: "",
  received: "2026-10-22T23:00:00Z",
  closed: null as null | Record<string, unknown>,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  adminClient: () => ({
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({
          data: {
            processed_at: state.processed,
            received_at: state.received,
          },
          error: null,
        }),
        update: (data: Record<string, unknown>) => {
          state.closed = data;
          return q;
        },
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
  state.received = new Date().toISOString();
  state.closed = null;
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
it("closes a notification whose invoice is still missing after three days", async () => {
  state.received = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({}, { status: 404 }))
    .mockResolvedValueOnce(Response.json({ results: [] }));
  vi.stubGlobal("fetch", fetcher);
  expect(
    await processInbox("key", "subscription_authorized_payment", "123"),
  ).toBe(true);
  // It asked Mercado Pago one last time before giving up.
  expect(fetcher).toHaveBeenCalled();
  expect(state.closed).toMatchObject({
    last_error: "ABANDONED_MERCADOPAGO_404",
  });
});
it("keeps retrying other failures however old they are", async () => {
  state.received = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({}, { status: 500 })),
  );
  expect(
    await processInbox("key", "subscription_authorized_payment", "123"),
  ).toBe(false);
  expect(state.attempts).toBe(1);
});
