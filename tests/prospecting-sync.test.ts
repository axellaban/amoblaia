import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildRows, guessMapping, parseCsv, preview } from "@/lib/prospecting/import";

// Automatic sync of the sheet. The database is a recorder; the rules that
// decide what is applied, held and rejected are checked on the synthetic fixture.
const state = vi.hoisted(() => ({
  rpcs: [] as { name: string; args: Record<string, unknown> }[],
  agencies: [] as unknown[],
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  adminClient: () => ({
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      state.rpcs.push({ name, args });
      if (name === "habita_prospect_agencies") return { data: state.agencies, error: null };
      return { data: { created: 0, updated: 0, unchanged: 0 }, error: null };
    },
  }),
}));

import { runSheetSync, splitForSync } from "@/lib/prospecting/sync";

const csv = readFileSync("tests/fixtures/prospeccion-sintetica.csv", "utf8");
const ACTOR = "8f1c2a3e-4b5d-4e6f-8a7b-9c0d1e2f3a4b";
const SOURCE = "Prospecting amobla IA · Prospectos";

describe("sheet sync", () => {
  beforeEach(() => {
    state.rpcs = [];
    state.agencies = [];
  });

  it("holds new rows that look like an existing agency and rejects the broken ones", () => {
    const parsed = parseCsv(csv);
    const existing = [{ id: "1a2b3c4d-0000-4000-8000-000000000001", name: "FICTICIA Dos", website: null, account_id: null, source: null, source_key: null }];
    const rows = preview(buildRows(parsed, guessMapping(parsed.headers)), SOURCE, existing);
    const { apply, held } = splitForSync(rows);
    expect(held.map((r) => r.name)).toEqual(["FICTICIA Dos"]);
    expect(apply.every((r) => r.action !== "error")).toBe(true);
    expect(apply.map((r) => r.name)).not.toContain("FICTICIA Dos");
  });

  it("sends each run with a new import id, no overwrite, and the team's legacy channel", async () => {
    const report = await runSheetSync({ actor: ACTOR, csv, source: SOURCE, legacyChannel: "whatsapp" });
    const call = state.rpcs.find((r) => r.name === "habita_prospect_import")!;
    expect(call.args).toMatchObject({ p_actor: ACTOR, p_source: SOURCE, p_overwrite: false, p_legacy_channel: "whatsapp" });
    expect(call.args.p_import).toMatch(/^[0-9a-f-]{36}$/);
    expect((call.args.p_rows as unknown[]).length).toBe(4);
    expect(report).toMatchObject({ rejected: expect.any(Array) });
  });

  it("never links an existing agency automatically", async () => {
    state.agencies = [{ id: "1a2b3c4d-0000-4000-8000-000000000001", name: "FICTICIA Dos", website: null, account_id: null, source: null, source_key: null }];
    const report = await runSheetSync({ actor: ACTOR, csv, source: SOURCE, legacyChannel: "unknown" });
    const call = state.rpcs.find((r) => r.name === "habita_prospect_import")!;
    expect((call.args.p_rows as { agency_id: string | null }[]).every((r) => r.agency_id === null)).toBe(true);
    expect(report).toMatchObject({ held: [expect.objectContaining({ name: "FICTICIA Dos" })] });
  });

  it("refuses a sheet without a name column", async () => {
    await expect(runSheetSync({ actor: ACTOR, csv: "Score,Zona\n10,Norte", source: SOURCE, legacyChannel: "unknown" })).rejects.toThrow(
      "no tiene columna de nombre",
    );
    expect(state.rpcs.find((r) => r.name === "habita_prospect_import")).toBeUndefined();
  });
});
