import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Authorization and server-side validation of every prospecting route. The
// database is a recorder: invariants are covered on real SQL elsewhere.
const state = vi.hoisted(() => ({
  user: null as null | { id: string; email: string; email_confirmed_at?: string; is_anonymous?: boolean },
  rpcs: [] as { name: string; args: Record<string, unknown> }[],
  result: {} as Record<string, unknown>,
  error: null as null | { message: string; code?: string },
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  currentUser: async () => state.user,
  userClient: async () => ({}),
  adminClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.rpcs.push({ name, args });
      if (state.error) return { data: null, error: state.error };
      return { data: name in state.result ? state.result[name] : { id: "x" }, error: null };
    },
  }),
}));

import * as root from "../src/app/api/admin/prospeccion/route";
import * as cuenta from "../src/app/api/admin/prospeccion/cuentas/[id]/route";
import * as eventos from "../src/app/api/admin/prospeccion/cuentas/[id]/eventos/route";
import * as contactos from "../src/app/api/admin/prospeccion/cuentas/[id]/contactos/route";
import * as bajas from "../src/app/api/admin/prospeccion/cuentas/[id]/bajas/route";
import * as intentos from "../src/app/api/admin/prospeccion/intentos/route";
import * as intento from "../src/app/api/admin/prospeccion/intentos/[id]/route";
import * as plantillas from "../src/app/api/admin/prospeccion/plantillas/route";
import * as importar from "../src/app/api/admin/prospeccion/importar/route";

const origin = "https://habita.test";
const ID = "00000000-0000-4000-8000-000000000001";
const ID2 = "00000000-0000-4000-8000-000000000002";
const req = (path: string, method = "GET", body?: unknown, headers: Record<string, string> = { origin }) =>
  new Request(`${origin}${path}`, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) });
const ADMIN = { id: ID2, email: "equipo@example.test", email_confirmed_at: "2026-01-01" };

beforeEach(() => {
  vi.stubEnv("SAAS_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://db.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public");
  vi.stubEnv("SUPABASE_SECRET_KEY", "secret");
  vi.stubEnv("ADMIN_EMAILS", "equipo@example.test");
  state.user = ADMIN;
  state.rpcs = [];
  state.result = {};
  state.error = null;
});

/** Every route, as (name, call). */
const calls: [string, () => Promise<Response>][] = [
  ["GET dataset", () => root.GET()],
  ["POST cuenta", () => root.POST(req("/api/admin/prospeccion", "POST", { name: "X" }))],
  ["GET ficha", () => cuenta.GET(req(`/api/admin/prospeccion/cuentas/${ID}`), ctx())],
  ["PATCH cuenta", () => cuenta.PATCH(req("/x", "PATCH", { version: 1, next_action: "a" }), ctx())],
  ["POST evento", () => eventos.POST(req("/x", "POST", { key: ID, type: "note" }), ctx())],
  ["POST contacto", () => contactos.POST(req("/x", "POST", { channel: "email", address: "a@b.test" }), ctx())],
  ["POST baja", () => bajas.POST(req("/x", "POST", { scope: "account", reason: "r" }), ctx())],
  ["PATCH baja", () => bajas.PATCH(req("/x", "PATCH", { suppressionId: ID, reason: "r" }), ctx())],
  ["POST intento", () => intentos.POST(req("/x", "POST", { key: ID, accountId: ID, contactId: ID, step: 1, body: "x", reviewed: true }))],
  ["POST acción", () => intento.POST(req("/x", "POST", { action: "open", version: 1 }), ctx())],
  ["POST plantilla", () => plantillas.POST(req("/x", "POST", { name: "n", channel: "whatsapp", step: 1, body: "b" }))],
  ["POST importar", () => importar.POST(req("/x", "POST", { csv: "Inmobiliaria\nA", source: "s" }))],
];

describe("Permissions", () => {
  it.each(calls)("%s: signed-out visitors get 401 and nothing runs", async (_n, call) => {
    state.user = null;
    expect((await call()).status).toBe(401);
    expect(state.rpcs).toEqual([]);
  });
  it.each(calls)("%s: accounts outside the team get 403", async (_n, call) => {
    state.user = { id: ID, email: "inmobiliaria@example.test", email_confirmed_at: "2026-01-01" };
    expect((await call()).status).toBe(403);
    expect(state.rpcs).toEqual([]);
  });
  it("mutations refuse a foreign origin (no unauthenticated or cross-site automation)", async () => {
    const r = await intento.POST(req("/x", "POST", { action: "confirm", method: "manual", observed: true }, { origin: "https://evil.test" }), ctx());
    expect(r.status).toBe(403);
    expect(state.rpcs).toEqual([]);
  });
  it("the dataset reconciles server conversions before reading, and is never cached", async () => {
    const r = await root.GET();
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(state.rpcs.map((x) => x.name)).toEqual(["habita_prospect_sync_conversions", "habita_prospect_dataset"]);
  });
  it("public demo pages and the agency panel never read prospecting data", () => {
    for (const file of ["src/components/demo-view.tsx", "src/app/demo/[token]/page.tsx", "src/lib/agency/site.ts", "src/lib/agency/panel.ts"]) {
      const src = readFileSync(file, "utf8");
      expect(src).not.toMatch(/prospect_|habita_prospect|lib\/prospecting/);
    }
  });
});

describe("Attempts", () => {
  it("never prepares without an explicit recipient review", async () => {
    const r = await intentos.POST(req("/x", "POST", { key: ID, accountId: ID, contactId: ID, step: 1, body: "x", reviewed: false }));
    expect(r.status).toBe(400);
    expect(state.rpcs).toEqual([]);
  });
  it("refuses unfilled placeholders", async () => {
    const r = await intentos.POST(req("/x", "POST", { key: ID, accountId: ID, contactId: ID, step: 1, body: "Mirá {{demo}}", reviewed: true }));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/\{\{demo\}\}/);
  });
  it("an edited template text is stored as custom; the identical text keeps the version", async () => {
    state.result.habita_prospect_context = { body: "Hola {{inmobiliaria}}", subject: null, name: "FICTICIA", decision_maker: null, sdr: "S", demo_token: null };
    await intentos.POST(req("/x", "POST", { key: ID, accountId: ID, contactId: ID, step: 1, body: "Hola FICTICIA", templateVersionId: ID2, sender: "S", reviewed: true }));
    expect(state.rpcs.find((x) => x.name === "habita_prospect_prepare")!.args).toMatchObject({ p_custom: false, p_template_version: ID2 });
    state.rpcs = [];
    await intentos.POST(req("/x", "POST", { key: ID, accountId: ID, contactId: ID, step: 1, body: "Hola FICTICIA!!", templateVersionId: ID2, sender: "S", reviewed: true }));
    expect(state.rpcs.find((x) => x.name === "habita_prospect_prepare")!.args).toMatchObject({ p_custom: true });
  });
  it("confirming requires the operator to state they observed the send", async () => {
    const r = await intento.POST(req("/x", "POST", { action: "confirm", method: "manual" }), ctx());
    expect(r.status).toBe(400);
    expect(state.rpcs).toEqual([]);
  });
  it("opening returns the channel link only for an opened attempt; an expired lease is reported as uncertain", async () => {
    state.result.habita_prospect_open = { id: ID, status: "opened", channel: "whatsapp", recipient: "+5492230000000", body: "Hola", subject: null };
    const ok = await (await intento.POST(req("/x", "POST", { action: "open", version: 1 }), ctx())).json();
    expect(ok.url).toBe("https://wa.me/5492230000000?text=Hola");
    state.result.habita_prospect_open = { id: ID, status: "uncertain", channel: "whatsapp", recipient: "+5492230000000", body: "Hola" };
    const r = await intento.POST(req("/x", "POST", { action: "open", version: 1 }), ctx());
    expect(r.status).toBe(409);
    expect((await r.json()).code).toBe("UNCERTAIN");
  });
  it("maps database refusals to stable codes", async () => {
    state.error = { message: "ATTEMPT_OPEN:abc" };
    const r = await intentos.POST(req("/x", "POST", { key: ID, accountId: ID, contactId: ID, step: 1, body: "x", reviewed: true }));
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ code: "ATTEMPT_OPEN", detail: "abc" });
    state.error = { message: "SUPPRESSED:account" };
    expect((await (await intentos.POST(req("/x", "POST", { key: ID, accountId: ID, contactId: ID, step: 1, body: "x", reviewed: true }))).json()).code).toBe("SUPPRESSED");
  });
});

describe("Validation", () => {
  it("a manually typed WhatsApp number must be complete: no guessing the 9", async () => {
    const r = await contactos.POST(req("/x", "POST", { channel: "whatsapp", address: "223 400 0000" }), ctx());
    expect(r.status).toBe(400);
    await contactos.POST(req("/x", "POST", { channel: "whatsapp", address: "+54 9 223 400 0000" }), ctx());
    expect(state.rpcs[0].args.p_fields).toMatchObject({ address: "+5492234000000" });
  });
  it("only facts can move the stage forward", async () => {
    await cuenta.PATCH(req("/x", "PATCH", { version: 3, stage: "customer" }), ctx());
    expect(state.rpcs[0].args).toMatchObject({ p_version: 3, p_patch: { stage: "customer" } });
    state.error = { message: "INVALID_STAGE" };
    expect((await cuenta.PATCH(req("/x", "PATCH", { version: 3, stage: "customer" }), ctx())).status).toBe(400);
  });
  it("events need a key and a known type", async () => {
    expect((await eventos.POST(req("/x", "POST", { type: "reply" }), ctx())).status).toBe(400);
    expect((await eventos.POST(req("/x", "POST", { key: ID, type: "opened_demo" }), ctx())).status).toBe(400);
  });
  it("import preview writes nothing; apply needs an import key and only links what the team ticked", async () => {
    const csv = readFileSync("tests/fixtures/prospeccion-sintetica.csv", "utf8");
    state.result.habita_prospect_agencies = [{ id: ID, name: "FICTICIA Dos", website: null, account_id: null, source: null, source_key: null }];
    const p = await (await importar.POST(req("/x", "POST", { csv, source: "fixture" }))).json();
    expect(p.totals).toMatchObject({ rows: 6, errors: 2, suggestions: 1, legacySends: 1 });
    expect(state.rpcs.map((x) => x.name)).toEqual(["habita_prospect_agencies"]);
    expect((await importar.POST(req("/x", "POST", { csv, source: "fixture", mode: "apply" }))).status).toBe(400);
    state.rpcs = [];
    await importar.POST(req("/x", "POST", { csv, source: "fixture", mode: "apply", importId: ID2, legacyChannel: "whatsapp", links: { "nombre:ficticia-dos": ID, "nombre:ficticia-tres": ID } }));
    const args = state.rpcs.find((x) => x.name === "habita_prospect_import")!.args;
    expect(args.p_legacy_channel).toBe("whatsapp");
    const rows = args.p_rows as { source_key: string; agency_id: string | null }[];
    expect(rows).toHaveLength(4);
    expect(rows.find((r) => r.source_key === "nombre:ficticia-dos")!.agency_id).toBe(ID);
    expect(rows.find((r) => r.source_key === "nombre:ficticia-tres")!.agency_id).toBeNull();
  });
});
