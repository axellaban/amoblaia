import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Incremental reads (lib/supabase/incremental.ts): the first read brings the whole table, the
// next ones only the rows whose cursor moved; a deletion (the count no longer matches) rereads it all.
type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({ rows: [] as Row[], calls: [] as { kind: "rows" | "count"; since: string | null; type: unknown[] | null }[] }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  adminClient: () => ({
    from: () => {
      let since: string | null = null;
      let types: unknown[] | null = null;
      let head = false;
      let from = 0;
      let to = Infinity;
      const q = {
        select: (_cols: string, opts?: { head?: boolean }) => ((head = Boolean(opts?.head)), q),
        in: (_k: string, v: unknown[]) => ((types = v), q),
        gte: (_k: string, v: string) => ((since = v), q),
        order: () => q,
        range: (a: number, b: number) => ((from = a), (to = b), q),
        then: (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) => {
          const all = db.rows
            .filter((r) => !types || types.includes(r.type))
            .filter((r) => !since || String(r.recorded_at) >= since)
            .sort((a, b) => String(a.id).localeCompare(String(b.id)));
          db.calls.push({ kind: head ? "count" : "rows", since, type: types });
          const answer = head ? { data: null, error: null, count: all.length } : { data: all.slice(from, to + 1), error: null };
          return Promise.resolve(answer).then(ok, fail);
        },
      };
      return q;
    },
  }),
}));

import { incrementalTable, ttlValue } from "@/lib/supabase/incremental";

const at = (min: number) => new Date(Date.UTC(2026, 10, 20, 12, min)).toISOString();
const table = () =>
  incrementalTable<Row>({ table: "prospect_events", columns: "id,type,recorded_at", cursor: "recorded_at", key: ["id"], filter: (q) => q.in("type", ["reply", "sent"]) });

describe("incremental reads", () => {
  beforeEach(() => {
    process.env.HABITA_TEST_CACHE = "1";
    db.calls = [];
    db.rows = [
      { id: "a", type: "reply", recorded_at: at(0) },
      { id: "b", type: "sent", recorded_at: at(10) },
      { id: "x", type: "note", recorded_at: at(10) },
    ];
  });
  afterAll(() => { delete process.env.HABITA_TEST_CACHE; });

  it("reads everything once, then only what changed since the last read (with a margin)", async () => {
    const t = table();
    expect((await t.read()).map((r) => r.id)).toEqual(["a", "b"]);
    expect(db.calls).toEqual([{ kind: "rows", since: null, type: ["reply", "sent"] }]);
    db.calls = [];
    db.rows.push({ id: "c", type: "reply", recorded_at: at(30) });
    expect((await t.read()).map((r) => r.id).sort()).toEqual(["a", "b", "c"]);
    // From the newest cursor seen (minute 10) minus two minutes; then a count without data.
    expect(db.calls).toEqual([{ kind: "rows", since: at(8), type: ["reply", "sent"] }, { kind: "count", since: null, type: ["reply", "sent"] }]);
  });

  it("an updated row replaces the cached one", async () => {
    const t = table();
    await t.read();
    db.rows[0] = { id: "a", type: "reply", recorded_at: at(40), note: "changed" };
    const rows = await t.read();
    expect(rows.find((r) => r.id === "a")?.note).toBe("changed");
    expect(rows).toHaveLength(2);
  });

  it("a deletion leaves the count short: it rereads the whole table", async () => {
    const t = table();
    await t.read();
    db.rows = db.rows.filter((r) => r.id !== "b");
    db.calls = [];
    expect((await t.read()).map((r) => r.id)).toEqual(["a"]);
    expect(db.calls.map((c) => c.kind)).toEqual(["rows", "count", "rows"]);
    expect(db.calls[2].since).toBeNull();
  });

  it("returns copies: changing a row does not change the cache", async () => {
    const t = table();
    (await t.read())[0].id = "zzz";
    expect((await t.read()).map((r) => r.id).sort()).toEqual(["a", "b"]);
  });

  it("without HABITA_TEST_CACHE (the other tests) every read is a full one", async () => {
    delete process.env.HABITA_TEST_CACHE;
    const t = table();
    await t.read();
    await t.read();
    expect(db.calls.map((c) => c.since)).toEqual([null, null]);
  });
});

describe("ttlValue", () => {
  it("keeps the value until cleared", async () => {
    process.env.HABITA_TEST_CACHE = "1";
    let n = 0;
    const v = ttlValue(async () => ++n, 60_000);
    expect(await v.get()).toBe(1);
    expect(await v.get()).toBe(1);
    v.clear();
    expect(await v.get()).toBe(2);
    delete process.env.HABITA_TEST_CACHE;
  });
});
