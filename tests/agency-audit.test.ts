// Regression (QA 13/11 pm): the agency audit called amobla_account, which
// locks the actor's profile (FOR UPDATE) and recomputes credits. Seven photo
// reorders at once queued on that lock until the statement timeout and every
// audit row was lost ("agency_edit_audit_failed order"). The audit only needs
// the profile row to exist: a plain insert that ignores duplicates.
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  calls: [] as { table: string; op: string; row: Record<string, unknown>; opts?: unknown }[],
  rpcs: [] as string[],
  fail: {} as Record<string, boolean>,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  adminClient: () => ({
    from: (table: string) => ({
      upsert: async (row: Record<string, unknown>, opts?: unknown) => {
        state.calls.push({ table, op: "upsert", row, opts });
        return { error: state.fail[`${table}:upsert`] ? { code: "57014" } : null };
      },
      insert: async (row: Record<string, unknown>) => {
        state.calls.push({ table, op: "insert", row });
        return { error: state.fail[`${table}:insert`] ? { code: "23503" } : null };
      },
    }),
  }),
}));
vi.mock("@/lib/commerce/http", async (original) => {
  const real = await original<typeof import("../src/lib/commerce/http")>();
  return {
    ...real,
    rpc: async (name: string) => {
      state.rpcs.push(name);
      return null;
    },
  };
});

import { auditAgency, auditAgencyEdit } from "../src/lib/agency/edit-context";

const ACTOR = "11111111-1111-4111-8111-111111111111";
const AGENCY = "22222222-2222-4222-8222-222222222222";

describe("auditoría de la edición de una inmobiliaria", () => {
  beforeEach(() => {
    state.calls = [];
    state.rpcs = [];
    state.fail = {};
  });

  it("asegura el perfil sin amobla_account (sin bloquear la fila ni recalcular créditos)", async () => {
    await auditAgency(ACTOR, AGENCY, "agency_edit", { operation: "order" });
    expect(state.rpcs).toEqual([]);
    expect(state.calls).toEqual([
      { table: "profiles", op: "upsert", row: { id: ACTOR }, opts: { onConflict: "id", ignoreDuplicates: true } },
      { table: "admin_audit", op: "insert", row: { actor_id: ACTOR, action: "agency_edit", subject_id: AGENCY, details: { operation: "order" } } },
    ]);
  });

  it("varias escrituras a la vez dejan cada una su registro", async () => {
    const demo = { id: "33333333-3333-4333-8333-333333333333", agency_id: AGENCY };
    await Promise.all(Array.from({ length: 7 }, () => auditAgencyEdit({ admin: true, actor: { id: ACTOR }, demo }, "order")));
    expect(state.rpcs).toEqual([]);
    expect(state.calls.filter((c) => c.table === "admin_audit")).toHaveLength(7);
  });

  it("si no se puede asegurar el perfil, falla sin insertar", async () => {
    state.fail["profiles:upsert"] = true;
    await expect(auditAgency(ACTOR, AGENCY, "agency_edit_start")).rejects.toThrow("AGENCY_AUDIT_FAILED");
    expect(state.calls.some((c) => c.table === "admin_audit")).toBe(false);
  });
});
