// Batches launched in several tabs at once: the account admits one live
// generation, so a tab whose turn has not come gets 409 BUSY. Before, that
// tab dropped its whole queue (only a passing message, then «N versiones
// faltantes»); now it waits its turn and sends the same version again.
import { afterEach, describe, expect, it, vi } from "vitest";

// A minimal React for the hook outside a component: the queue's logic lives in refs.
vi.mock("react", () => ({
  useRef: <T,>(v: T) => ({ current: v }),
  useState: <T,>(v: T) => [v, () => undefined],
  useCallback: <T,>(fn: T) => fn,
}));
vi.mock("@/lib/analytics", () => ({ track: () => undefined, trackMilestone: () => undefined }));
const api = vi.fn();
vi.mock("../src/components/admin-demos", async () => {
  class ApiError extends Error {
    constructor(
      message: string,
      public status: number,
      public body: Record<string, unknown>,
    ) {
      super(message);
    }
  }
  return { ApiError, api: (...args: unknown[]) => api(...args) };
});
vi.mock("server-only", () => ({}));
const rpcError = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ adminClient: () => ({ rpc: async () => ({ data: null, error: rpcError() }) }) }));

import { ApiError } from "../src/components/admin-demos";
import { BUSY_RETRY_MS, isBusy, useStagingQueue } from "../src/components/use-staging-queue";
import { failure, rpc } from "../src/lib/commerce/http";

const photo = (id: string, live = false) => ({
  id,
  room: "living",
  mode: "furnish",
  discarded: [],
  shown: {},
  generations: live ? [{ id: `g-${id}`, style: "nordico", status: "running" }] : [{ id: `g-${id}`, style: "nordico", status: "succeeded" }],
});

afterEach(() => {
  vi.useRealTimers();
  api.mockReset();
});

describe("one live generation per account", () => {
  it("the server's BUSY travels with its code", async () => {
    rpcError.mockReturnValue({ message: "BUSY", code: "P0001" });
    const e = await rpc("amobla_reserve_batch").catch((x) => x);
    const res = failure(e);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Ya tenés una generación en curso. Esperá su resultado.", code: "busy" });
  });

  it("isBusy only for that answer", () => {
    expect(isBusy(new ApiError("x", 409, { code: "busy" }))).toBe(true);
    expect(isBusy(new ApiError("Esta foto ya está en la demo.", 409, {}))).toBe(false);
    expect(isBusy(new Error("red"))).toBe(false);
  });

  it("a tab whose turn has not come waits and sends every version, without dropping the batch", async () => {
    vi.useFakeTimers();
    // The other tab's generation is live for the first two attempts of this one.
    let refusals = 2;
    const sent: string[] = [];
    api.mockImplementation(async (_path: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { key: string };
      if (refusals > 0) {
        refusals--;
        throw new ApiError("Ya tenés una generación en curso. Esperá su resultado.", 409, { error: "…", code: "busy" });
      }
      sent.push(body.key);
      return { ok: true };
    });
    const reports: { tone: string; text: string }[] = [];
    const detail = { photos: [photo("a"), photo("b"), photo("c")].map((p) => ({ ...p, generations: [] })), staging: { payer: "team", blocked: null } };
    const queue = useStagingQueue({
      base: "/api/admin/demos/d1",
      detail: detail as never,
      poll: async (id) => photo(id) as never,
      report: (r) => reports.push(r),
      trackAgency: false,
    });
    const accepted = await queue.request(["a", "b", "c"].map((photoId) => ({ photoId, style: "nordico" })));
    expect(accepted).toBe(true);
    await vi.advanceTimersByTimeAsync(BUSY_RETRY_MS * 3);
    expect(sent).toHaveLength(3);
    // The first attempt was refused twice and went out once, with one key.
    expect(api.mock.calls.filter(([path]) => String(path).endsWith("/photos/a"))).toHaveLength(3);
    const keysA = new Set(api.mock.calls.filter(([path]) => String(path).endsWith("/photos/a")).map(([, init]) => JSON.parse(String(init.body)).key));
    expect(keysA.size).toBe(1);
    expect(reports.filter((r) => r.tone === "error")).toEqual([]);
    expect(reports[0].text).toMatch(/espera su turno y sigue sola/);
    expect(reports.at(-1)?.text).toBe("3 versiones listas. Revisalas antes de publicar.");
  });

  it("any other 409 still stops the queue and says how many were left", async () => {
    api.mockRejectedValue(new ApiError("Este estilo tiene un resultado en revisión técnica.", 409, {}));
    const reports: { tone: string; text: string }[] = [];
    const detail = { photos: [photo("a"), photo("b")].map((p) => ({ ...p, generations: [] })), staging: { payer: "team", blocked: null } };
    const queue = useStagingQueue({ base: "/x", detail: detail as never, poll: async () => null, report: (r) => reports.push(r), trackAgency: false });
    await queue.request(["a", "b"].map((photoId) => ({ photoId, style: "nordico" })));
    await vi.waitFor(() => expect(reports.length).toBeGreaterThan(0));
    expect(reports[0]).toEqual({ tone: "error", text: "Este estilo tiene un resultado en revisión técnica. 1 versión quedó sin enviar." });
  });
});
