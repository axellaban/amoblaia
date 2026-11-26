import { beforeEach, describe, expect, it, vi } from "vitest";

// QA 26/11: la foto diaria de la cola (cron de las 06:00) se perdió porque la lectura completa
// chocó con el statement timeout de Postgres (57014). El cron ahora reintenta una vez.
const reads = vi.hoisted(() => ({ rows: 0 }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => {
  // Any table read answers empty: the test only cares about the first read that fails.
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "in", "is", "gte", "lte", "lt", "gt", "order", "range", "limit", "not", "or", "filter", "match"]) chain[m] = () => chain;
  chain.maybeSingle = async () => ({ data: null, error: null });
  chain.single = async () => ({ data: null, error: null });
  chain.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
  return {
    currentUser: async () => null,
    userClient: async () => ({}),
    adminClient: () => ({ from: () => chain, rpc: async () => ({ data: null, error: null }) }),
  };
});
vi.mock("@/lib/agency/commercial-server", () => ({
  commercialRow: async () => null,
  demoFirstActivity: async () => new Map(),
  commercialRows: async () => {
    reads.rows++;
    throw Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" });
  },
}));
vi.mock("@/lib/prospecting/server", () => ({
  prospectDataset: async () => null,
  prospectRpc: async () => null,
}));
vi.mock("@/lib/prospecting/pool-server", () => ({ poolGates: async () => new Map() }));
vi.mock("@/lib/agency/external", () => ({}));
vi.mock("@/lib/agency/admin-edit", () => ({}));
vi.mock("@/lib/agency/panel-link", () => ({}));
vi.mock("@/lib/prospecting/record-send", () => ({}));

import { snapshotQueueDay } from "../src/lib/followup/server";

beforeEach(() => {
  reads.rows = 0;
});

describe("foto diaria de la cola", () => {
  it("si la lectura falla, la vuelve a intentar antes de rendirse", async () => {
    await expect(snapshotQueueDay({ pauseMs: 0 })).rejects.toThrow(/statement timeout/);
    expect(reads.rows).toBe(2);
  });

  it("respeta la cantidad de intentos pedida", async () => {
    await expect(snapshotQueueDay({ attempts: 1, pauseMs: 0 })).rejects.toThrow();
    expect(reads.rows).toBe(1);
    await expect(snapshotQueueDay({ attempts: 3, pauseMs: 0 })).rejects.toThrow();
    expect(reads.rows).toBe(4);
  });
});
