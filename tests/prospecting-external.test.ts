import { beforeEach, describe, expect, it, vi } from "vitest";

// La API de prospección para el panel de Chapa Labs (/api/prospeccion): clave, forma de las filas
// y qué funciones de la base llama cada acción. La base es un grabador; sus reglas se prueban en
// SQL real en prospecting-database.test.ts.
const A = "00000000-0000-4000-8000-0000000000a1";
const AG = "00000000-0000-4000-8000-0000000000b1";
const C = "00000000-0000-4000-8000-0000000000c1";
const ACTOR = "00000000-0000-4000-8000-0000000000d1";
const state = vi.hoisted(() => ({
  rpcs: [] as { name: string; args: Record<string, unknown> }[],
  dataset: null as unknown,
  results: {} as Record<string, unknown>,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  currentUser: async () => null,
  userClient: async () => ({}),
  adminClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.rpcs.push({ name, args });
      if (name === "habita_prospect_dataset") return { data: structuredClone(state.dataset), error: null };
      return { data: name in state.results ? state.results[name] : { id: "x" }, error: null };
    },
    from: () => ({ select: () => ({ in: async () => ({ data: [{ agency_id: AG, token: "tok", status: "published", published_at: "2026-11-01T12:00:00Z", activity_level: 2 }], error: null }) }) }),
    auth: { admin: { listUsers: async () => ({ data: { users: [{ id: ACTOR, email: "equipo@example.test" }] } }) } },
  }),
}));

const ext = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock("@/lib/agency/external", () => ({
  agencyList: async () => (ext.calls.push(["list"]), { rows: [{ id: "ag", name: "Inmo", wa: "5492235111111" }], toReview: [] }),
  agencyThumb: async (id: string, w: unknown) => (ext.calls.push(["thumb", id, w]), Buffer.from([0xff, 0xd8])),
  setDemosSent: async (...a: unknown[]) => (ext.calls.push(["sent", ...a]), 2),
  agencyDemoLink: async (...a: unknown[]) => (ext.calls.push(["demo", ...a]), { url: "https://habita.test/d/x/presentacion" }),
  agencyPanel: async (...a: unknown[]) => (ext.calls.push(["panel", ...a]), { url: "https://habita.test/p/x" }),
  recalcScores: async () => (ext.calls.push(["recalc"]), { demos: 3 }),
}));
import { GET, POST } from "../src/app/api/prospeccion/route";
import { HEADER, stableUuid } from "../src/lib/prospecting/external";

const SECRET = "m".repeat(40);
const origin = "https://habita.test";
const req = (method: string, body?: unknown, auth = `Bearer ${SECRET}`) =>
  new Request(`${origin}/api/prospeccion`, { method, headers: { "content-type": "application/json", authorization: auth }, body: body === undefined ? undefined : JSON.stringify(body) });

function dataset({ stage = "pending", attempts = [] as unknown[], events = [] as unknown[], needsReview = false } = {}) {
  return {
    now: "2026-11-05T12:00:00Z",
    settings: {},
    accounts: [{
      id: A, agency_id: AG, name: "Inmobiliaria Ficticia", website: null, linked: false, campaign: null, sdr: "Ana", priority: "A", score: 80,
      score_components: {}, scoring_version: null, zone: "Mar del Plata", decision_maker: "Laura Gómez", decision_maker_role: null, stage,
      lost_reason: null, next_action: null, due_at: null, due_precision: "day", version: 3, created_at: "2026-10-01T00:00:00Z", imported: true, demos: 1,
      suppressed: false,
      contacts: [{ id: C, channel: "whatsapp", address: "+5492235111111", address_original: null, person_name: null, is_decision_maker: true, confidence: null, source: null, needs_review: needsReview, review_reason: null, verified: !needsReview, invalid: false, is_primary: true, blocked: null }],
    }],
    attempts,
    events,
    templates: [],
    last_import: null,
  };
}
const sent = (step: number, at: string) => ({ id: `t${step}`, account_id: A, contact_id: C, campaign: "general", step, status: "sent", sent_at: at, sent_precision: "time", channel: "whatsapp", sender: "Ana", legacy: false, variant_label: "Personalizado", version: 2, prepared_at: at });

beforeEach(() => {
  vi.stubEnv("SAAS_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://db.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public");
  vi.stubEnv("SUPABASE_SECRET_KEY", "secret");
  vi.stubEnv("ADMIN_EMAILS", "equipo@example.test");
  vi.stubEnv("METRICS_SECRET", SECRET);
  vi.stubEnv("PROSPECTING_API_SECRET", "");
  vi.stubEnv("PROSPECTING_ACTOR_ID", "");
  vi.stubEnv("PROSPECT_SYNC_ACTOR_ID", "");
  state.rpcs = [];
  state.results = {};
  state.dataset = dataset();
});
const names = () => state.rpcs.map((r) => r.name).filter((n) => n !== "habita_prospect_dataset" && n !== "habita_prospect_sync_conversions");

describe("/api/prospeccion", () => {
  it("sin la clave no responde nada", async () => {
    expect((await GET(req("GET", undefined, "Bearer otra-clave-cualquiera-de-mas-de-32-letras"))).status).toBe(401);
    expect((await POST(req("POST", { code: A, action: { type: "note", text: "x" } }, ""))).status).toBe(401);
    expect(state.rpcs).toEqual([]);
  });

  it("GET: una fila por cuenta con las columnas que lee Chapa", async () => {
    state.dataset = dataset({ stage: "conversation", attempts: [sent(1, "2026-11-02T13:00:00Z")], events: [{ id: "e1", account_id: A, type: "reply", occurred_at: "2026-11-03T15:30:00Z", precision: "time", channel: "whatsapp", details: {}, corrected: false }] });
    const r = await GET(req("GET"));
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.header).toEqual([...HEADER]);
    const row = Object.fromEntries(b.header.map((h: string, i: number) => [h, b.rows[0][i]]));
    expect(row).toMatchObject({
      ID: A, Inmobiliaria: "Inmobiliaria Ficticia", Saludo: "Laura", Teléfono: "+5492235111111", "Confianza del número": "verificado",
      Estado: "Respondió", Mensajes: 1, "Primer contacto": "2026-11-02 10:00", Respondió: "2026-11-03 12:30", "Link de su demo": "https://habita.test/demo/tok",
      "Abrió la demo": "sí", "Probó la demo": "sí", Actualizado: 3,
    });
    expect(b.events.map((e: { type: string }) => e.type)).toEqual(["mensaje", "respondio"]);
  });

  it("«mandé el mensaje» prepara, abre y confirma el paso que dice la plantilla, a nombre del equipo", async () => {
    state.results.habita_prospect_prepare = { id: "new", version: 1, status: "prepared" };
    state.results.habita_prospect_open = { id: "new", status: "opened" };
    const r = await POST(req("POST", { code: A, by: "Ana", action: { type: "sent", channel: "whatsapp", template: "whatsapp_2", text: "Hola Laura" } }));
    expect(r.status).toBe(200);
    expect(names()).toEqual(["habita_prospect_prepare", "habita_prospect_open", "habita_prospect_confirm"]);
    const prep = state.rpcs.find((x) => x.name === "habita_prospect_prepare")!.args;
    expect(prep).toMatchObject({ p_actor: ACTOR, p_account: A, p_contact: C, p_step: 2, p_body: "Hola Laura", p_sender: "Ana", p_custom: true, p_reviewed: true });
    expect(prep.p_key).toBe(stableUuid(`send:${A}:2:whatsapp:0`));
    expect(state.rpcs.find((x) => x.name === "habita_prospect_confirm")!.args).toMatchObject({ p_attempt: "new", p_method: "manual" });
    expect((await r.json()).header).toEqual([...HEADER]);
  });

  it("un paso que ya salió no se registra de nuevo (lote o reintento)", async () => {
    state.dataset = dataset({ attempts: [sent(1, "2026-11-02T13:00:00Z")] });
    const r = await POST(req("POST", { code: A, action: { type: "sent", step: 1 } }));
    expect(r.status).toBe(200);
    expect(names()).toEqual([]);
  });

  it("un número por revisar no se usa", async () => {
    state.dataset = dataset({ needsReview: true });
    const r = await POST(req("POST", { code: A, action: { type: "sent", template: "whatsapp_1", text: "Hola" } }));
    expect(r.status).toBe(409);
    expect((await r.json()).code).toBe("CONTACT_NEEDS_REVIEW");
    expect(names()).toEqual([]);
  });

  it("si ya respondió, el mensaje es de conversación (paso 0)", async () => {
    state.dataset = dataset({ stage: "conversation" });
    state.results.habita_prospect_prepare = { id: "n", version: 1, status: "prepared" };
    state.results.habita_prospect_open = { id: "n", status: "opened" };
    await POST(req("POST", { code: A, action: { type: "sent", template: "whatsapp_2", text: "Te paso los precios" } }));
    expect(state.rpcs.find((x) => x.name === "habita_prospect_prepare")!.args.p_step).toBe(0);
  });

  it("resultados: respuesta e interés con evidencia, baja de la cuenta, inválido el WhatsApp; cliente no se marca a mano", async () => {
    await POST(req("POST", { code: A, by: "Ana", action: { type: "outcome", outcome: "respondio", detail: "Preguntó precios" } }));
    expect(state.rpcs.find((x) => x.name === "habita_prospect_record")!.args).toMatchObject({ p_type: "reply", p_evidence: "Preguntó precios", p_actor: ACTOR });
    state.rpcs = [];
    await POST(req("POST", { code: A, action: { type: "outcome", outcome: "baja" } }));
    expect(names()).toEqual(["habita_prospect_suppress"]);
    state.rpcs = [];
    await POST(req("POST", { code: A, action: { type: "outcome", outcome: "invalido" } }));
    expect(state.rpcs.find((x) => x.name === "habita_prospect_contact")!.args).toMatchObject({ p_contact: C, p_fields: { invalid: true } });
    state.rpcs = [];
    const r = await POST(req("POST", { code: A, action: { type: "outcome", outcome: "cliente" } }));
    expect(r.status).toBe(400);
    expect(names()).toEqual([]);
  });

  it("sincronización: la pestaña que manda Chapa se importa con el origen de la última importación", async () => {
    state.dataset = { ...dataset(), last_import: { id: "i", source: "Origen de la planilla", file_name: null, applied_at: "2026-11-01T00:00:00Z", report: {} } };
    state.results.habita_prospect_agencies = [];
    state.results.habita_prospect_import = { created: 1, updated: 0, unchanged: 0, legacy_sends: 1 };
    const csv = "Inmobiliaria,Número (sin 0 ni 15),Estado,Fecha envío\nInmo Uno,2235111111,Enviado,03/11/2026";
    const r = await POST(req("POST", { sync: { csv } }));
    expect(r.status).toBe(200);
    expect((await r.json()).legacy_sends).toBe(1);
    expect(state.rpcs.find((x) => x.name === "habita_prospect_import")!.args).toMatchObject({ p_actor: ACTOR, p_source: "Origen de la planilla", p_legacy_channel: "whatsapp", p_overwrite: false });
    expect((await POST(req("POST", { sync: { csv } }, "Bearer x"))).status).toBe(401);
  });

  it("lista «Inmobiliarias»: filas, portada y acciones de la lista, a nombre del equipo", async () => {
    ext.calls = [];
    const AG = "00000000-0000-4000-8000-0000000000e1";
    const list = await GET(new Request(`${origin}/api/prospeccion?vista=inmobiliarias`, { headers: { authorization: `Bearer ${SECRET}` } }));
    expect((await list.json()).rows[0].wa).toBe("5492235111111");
    const img = await GET(new Request(`${origin}/api/prospeccion?foto=${AG}&w=120`, { headers: { authorization: `Bearer ${SECRET}` } }));
    expect(img.headers.get("content-type")).toBe("image/jpeg");
    expect((await (await POST(req("POST", { inmobiliaria: AG, accion: "demo-estado", enviada: true }))).json()).changed).toBe(2);
    expect((await (await POST(req("POST", { inmobiliaria: AG, accion: "link-demo" }))).json()).url).toContain("/presentacion");
    expect((await (await POST(req("POST", { inmobiliaria: AG, accion: "link-panel" }))).json()).url).toBe("https://habita.test/p/x");
    expect((await POST(req("POST", { accion: "recalcular-scores" }))).status).toBe(200);
    expect(ext.calls).toEqual([
      ["list"],
      ["thumb", AG, "120"],
      ["sent", AG, true, ACTOR],
      ["demo", AG, ACTOR, origin],
      ["panel", AG, ACTOR, origin],
      ["recalc"],
    ]);
    expect((await POST(req("POST", { inmobiliaria: "x", accion: "link-panel" }))).status).toBe(404);
    expect((await POST(req("POST", { inmobiliaria: AG, accion: "demo-estado" }))).status).toBe(400);
    expect((await GET(new Request(`${origin}/api/prospeccion?vista=inmobiliarias`, { headers: { authorization: "Bearer otra" } }))).status).toBe(401);
  });

  it("próximo paso: se guarda con la versión de la cuenta", async () => {
    await POST(req("POST", { code: A, action: { type: "schedule", nextAt: "2026-11-10", nextStep: "Llamar" } }));
    expect(state.rpcs.find((x) => x.name === "habita_prospect_update")!.args).toMatchObject({
      p_version: 3,
      p_patch: { next_action: "Llamar", due_at: "2026-11-10T03:00:00.000Z", due_precision: "day" },
    });
  });
});
