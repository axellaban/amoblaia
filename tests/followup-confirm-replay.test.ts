import { beforeEach, describe, expect, it, vi } from "vitest";

// Confirmar un envío dos veces (respuesta perdida, doble clic, reintento de Chapa) no es un error:
// la ejecución ya está guardada por versión e inmobiliaria y nunca vuelve atrás.
const AG = "00000000-0000-4000-8000-0000000000b1";
const V1 = "00000000-0000-4000-8000-0000000000c1";
const db = vi.hoisted(() => ({ reads: [] as string[], row: null as null | { status: string; updated_at: string } }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  currentUser: async () => null,
  userClient: async () => ({}),
  adminClient: () => ({
    from: (table: string) => {
      db.reads.push(table);
      if (table !== "followup_executions") throw new Error(`unexpected read of ${table}`);
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: db.row, error: null }),
      };
      return chain;
    },
    rpc: async () => {
      throw new Error("a replay never writes");
    },
  }),
}));
vi.mock("@/lib/agency/external", () => ({}));
vi.mock("@/lib/agency/commercial-server", () => ({}));
vi.mock("@/lib/agency/admin-edit", () => ({}));
vi.mock("@/lib/agency/panel-link", () => ({}));
vi.mock("@/lib/prospecting/server", () => ({}));
vi.mock("@/lib/prospecting/record-send", () => ({}));

import { confirmExecution } from "../src/lib/followup/server";

const actor = { id: "00000000-0000-4000-8000-0000000000f1", name: "Facu" };

beforeEach(() => {
  db.reads.length = 0;
  db.row = null;
});

describe("confirmar un envío ya confirmado", () => {
  it("devuelve el envío guardado, sin volver a escribir ni armar la cola", async () => {
    db.row = { status: "sent", updated_at: "2026-11-10T15:00:00.000Z" };
    const out = await confirmExecution({ agencyId: AG, stage: "no-contactado", action: "principal", versionId: V1, text: "Hola" }, actor, { includeItem: false });
    expect(out).toEqual({ execution: { status: "sent", at: "2026-11-10T15:00:00.000Z" }, warning: null, item: null, replayed: true });
    // One small read of the execution: not the whole board, which used to answer 409 once the agency had moved on.
    expect(db.reads).toEqual(["followup_executions"]);
  });

  it("solo cuenta como repetido lo que ya salió: abierto o fallido sigue el camino normal", async () => {
    for (const status of ["opened", "failed"]) {
      db.reads.length = 0;
      db.row = { status, updated_at: "2026-11-10T15:00:00.000Z" };
      // It goes past the replay check, on to rebuild the queue (which this test does not provide): no «replayed».
      await expect(confirmExecution({ agencyId: AG, versionId: V1 }, actor, { includeItem: false })).rejects.toThrow();
      expect(db.reads[0]).toBe("followup_executions");
    }
  });

  it("no consulta nada con identificadores inválidos", async () => {
    await expect(confirmExecution({ agencyId: "x", versionId: "y" }, actor, { includeItem: false })).rejects.toThrow();
    expect(db.reads).not.toContain("followup_executions");
  });
});
