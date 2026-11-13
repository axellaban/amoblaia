import { beforeEach, describe, expect, it, vi } from "vitest";

// La vista Prospectos por /api/prospeccion (la que opera Chapa Labs): qué filas devuelve y qué
// guarda cada operación. La base es un grabador; sus reglas se prueban en SQL real en
// prospecting-pool-database.test.ts. Datos sintéticos.
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ACTOR = uuid(900);
const state = vi.hoisted(() => ({
  rpcs: [] as { name: string; args: Record<string, unknown> }[],
  dataset: null as unknown,
  pool: null as unknown,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => {
  const chain = () => {
    const p: Record<string, unknown> = {};
    for (const k of ["select", "in", "eq", "range", "order"]) p[k] = () => p;
    p.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
    return p;
  };
  return {
    currentUser: async () => null,
    userClient: async () => ({}),
    adminClient: () => ({
      rpc: async (name: string, args: Record<string, unknown>) => {
        state.rpcs.push({ name, args });
        if (name === "habita_prospect_dataset") return { data: structuredClone(state.dataset), error: null };
        if (name === "habita_prospect_pool") return state.pool ? { data: structuredClone(state.pool), error: null } : { data: null, error: { code: "PGRST202", message: "not found" } };
        if (name === "habita_prospect_add") return { data: { id: uuid(50) }, error: null };
        return { data: { id: "x" }, error: null };
      },
      from: chain,
      auth: { admin: { listUsers: async () => ({ data: { users: [{ id: ACTOR, email: "facu@example.test", user_metadata: { full_name: "Facu Test" } }] } }) } },
    }),
  };
});
vi.mock("@/lib/agency/external", () => ({}));
import { GET, POST } from "../src/app/api/prospeccion/route";

const SECRET = "p".repeat(40);
const origin = "https://habita.test";
const get = (query: string) => GET(new Request(`${origin}/api/prospeccion?${query}`, { headers: { authorization: `Bearer ${SECRET}` } }));
const post = (prospectos: Record<string, unknown>) =>
  POST(new Request(`${origin}/api/prospeccion`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` }, body: JSON.stringify({ by: "Facu", prospectos }) }));

const wa = (n: number, o: Record<string, unknown> = {}) => ({ id: uuid(300 + n), channel: "whatsapp", address: `+54922300000${n}`, address_original: null, person_name: null, is_decision_maker: false, confidence: null, source: null, needs_review: false, review_reason: null, verified: true, invalid: false, is_primary: true, blocked: null, ...o });
const account = (n: number, o: Record<string, unknown> = {}) => ({
  id: uuid(n), agency_id: uuid(100 + n), name: `Inmobiliaria Ficticia ${n}`, website: `https://ficticia${n}.test`, linked: false, campaign: null, sdr: "Facu", priority: null, score: 50,
  score_components: {}, scoring_version: null, zone: "Zona Test", decision_maker: null, decision_maker_role: null, stage: "pending", lost_reason: null, next_action: null,
  due_at: null, due_precision: "day", version: 2, created_at: "2026-11-01T00:00:00Z", imported: true, demos: 0, suppressed: false, contacts: [wa(n)], ...o,
});
const profile = (n: number, status: string, values: Record<string, unknown> = {}, o: Record<string, unknown> = {}) => ({
  account_id: uuid(n), status, discard_reason: null, profile: values, score: null, score_components: {}, scoring_version: null, explore: false, queued_at: null, queue_snapshot: null, updated_at: "2026-11-10T00:00:00Z", ...o,
});
const READY = { empty_listings: 20, listings_total: 60, uses_staging: "no", demo_listing_url: "https://ficticia.test/aviso/1", demo_photos_importable: "si" };
const saves = () => state.rpcs.filter((r) => r.name === "habita_prospect_pool_save").map((r) => r.args as { p_account: string; p_actor: string; p_patch: Record<string, unknown> });

beforeEach(() => {
  vi.stubEnv("SAAS_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://db.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public");
  vi.stubEnv("SUPABASE_SECRET_KEY", "secret");
  vi.stubEnv("ADMIN_EMAILS", "facu@example.test");
  vi.stubEnv("METRICS_SECRET", SECRET);
  vi.stubEnv("PROSPECTING_API_SECRET", "");
  vi.stubEnv("PROSPECTING_ACTOR_ID", "");
  vi.stubEnv("PROSPECT_SYNC_ACTOR_ID", "");
  state.rpcs = [];
  state.dataset = {
    now: "2026-11-11T12:00:00Z",
    settings: { small_sample: 30 },
    accounts: [
      account(1), // de antes de Prospectos, con WhatsApp: ya en la cola
      account(2, { contacts: [] }), // sin WhatsApp
      account(3), // con perfil completo
      account(4, { stage: "sent" }), // ya contactada: no es un prospecto pendiente
      account(5), // con perfil, lista para explorar
    ],
    attempts: [{ id: "t4", account_id: uuid(4), status: "sent", sent_at: "2026-11-03T15:00:00Z", step: 1, legacy: true, variant_label: null }],
    events: [{ id: "e4", account_id: uuid(4), type: "reply", human: true, corrected: false, occurred_at: "2026-11-04T15:00:00Z" }],
    templates: [],
    last_import: null,
  };
  state.pool = {
    profiles: [profile(3, "calificado", READY), profile(5, "enriquecido", { demo_listing_url: "https://ficticia.test/aviso/5", ai_provider: "Otra IA" })],
    extra: [{ account_id: uuid(2), address: "Calle Falsa 123", source: "planilla", source_data: { Instagram: "@ficticia2" }, source_notes: "Nota de prueba" }],
  };
});

describe("/api/prospeccion · Prospectos", () => {
  it("GET: las pendientes sin contactar, por ranking, con su estado, lo que falta y el catálogo", async () => {
    const r = await get("vista=prospectos");
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.available).toBe(true);
    expect(b.rows.map((x: { id: string }) => x.id)).not.toContain(uuid(4));
    expect(b.rows[0].id).toBe(uuid(3));
    const by = Object.fromEntries(b.rows.map((x: { id: string }) => [x.id, x]));
    expect(by[uuid(1)]).toMatchObject({ status: "en_cola", legacy: true, missing: [] });
    expect(by[uuid(2)]).toMatchObject({ status: "descubierto", legacy: true, address: "Calle Falsa 123", inferred: { instagram: "@ficticia2" } });
    expect(by[uuid(2)].missing.join(" ")).toMatch(/WhatsApp/);
    expect(by[uuid(3)]).toMatchObject({ status: "calificado", legacy: false, missing: [], demoPath: "importar", warnings: [] });
    expect(by[uuid(5)].score.caps.join(" ")).toMatch(/proveedor de IA/);
    // El estado se deriva de los datos al leer: la 5 tiene pocos datos cargados.
    expect(b.counts).toMatchObject({ total: 4, en_cola: 1, calificado: 1, descubierto: 2 });
    expect(b.catalog.fields.length).toBeGreaterThan(20);
    expect(b.catalog.scoringVersion).toBe("prospectos_v2");
    // Aprendizajes: la única intentada es la ya contactada.
    expect(b.learning.total).toMatchObject({ n: 1, valid: 1, replied: 1 });
    expect(b.learning.messages).toEqual(["Histórico (planilla)"]);
  });

  it("sin la migración la vista lo dice y las operaciones no guardan", async () => {
    state.pool = null;
    const b = await (await get("vista=prospectos")).json();
    expect(b.available).toBe(false);
    expect(b.rows.length).toBe(4);
    const r = await post({ op: "guardar", cuenta: uuid(2), valores: { listings_total: 10 } });
    expect(r.status).toBe(503);
    expect(saves()).toEqual([]);
  });

  it("guardar: valida, recalcula el ranking y deja el estado que sale de los datos", async () => {
    expect((await post({ op: "guardar", cuenta: uuid(2), valores: { listings_total: "muchos" } })).status).toBe(400);
    const r = await post({ op: "guardar", cuenta: uuid(2), valores: { listings_total: 40, empty_listings: 10 }, zona: "Centro" });
    expect(r.status).toBe(200);
    expect(state.rpcs.find((x) => x.name === "habita_prospect_update")?.args).toMatchObject({ p_account: uuid(2), p_version: 2, p_patch: { zone: "Centro" } });
    const [s] = saves();
    expect(s).toMatchObject({ p_account: uuid(2), p_actor: ACTOR, p_patch: { profile: { listings_total: 40, empty_listings: 10 }, status: "descubierto", scoring_version: "prospectos_v2", explore: false } });
    expect(s.p_patch.snapshot).toBeUndefined();
    // Una de antes de Prospectos que ya estaba en la cola no sale de la cola por cargarle datos.
    await post({ op: "guardar", cuenta: uuid(1), valores: { listings_total: 40 } });
    expect(saves()[1].p_patch).toMatchObject({ status: "en_cola" });
    expect(saves()[1].p_patch.snapshot).toBeUndefined();
  });

  it("cola: solo entra si cumple lo que falta, y guarda la foto de lo que se sabía", async () => {
    const no = await post({ op: "cola", cuenta: uuid(2) });
    expect(no.status).toBe(409);
    expect((await no.json()).error).toMatch(/WhatsApp/);
    expect(saves()).toEqual([]);
    expect((await post({ op: "cola", cuenta: uuid(3) })).status).toBe(200);
    const [s] = saves();
    expect(s.p_patch).toMatchObject({ status: "en_cola", explore: false });
    expect(s.p_patch.snapshot).toMatchObject({ scoring_version: "prospectos_v2", profile: { empty_listings: 20, demo_listing_url: READY.demo_listing_url } });
    // Con proveedor de IA no entra por ranking, pero sí por exploración.
    expect((await post({ op: "cola", cuenta: uuid(5) })).status).toBe(409);
    expect((await post({ op: "cola", cuenta: uuid(5), explorar: true })).status).toBe(200);
    expect(saves()[1].p_patch).toMatchObject({ status: "en_cola", explore: true });
  });

  it("descartar pide motivo; sacar de la cola devuelve el estado que sale de los datos", async () => {
    expect((await post({ op: "descartar", cuenta: uuid(3) })).status).toBe(400);
    expect((await post({ op: "descartar", cuenta: uuid(3), motivo: "Solo campos" })).status).toBe(200);
    expect(saves()[0].p_patch).toMatchObject({ status: "descartado", discard_reason: "Solo campos" });
    const r = await post({ op: "sacar", cuenta: uuid(1) });
    expect(await r.json()).toMatchObject({ ok: true, status: "descubierto" });
    expect(saves()[1].p_patch).toMatchObject({ status: "descubierto", explore: false });
  });

  it("llenar: suma las calificadas por ranking", async () => {
    const r = await post({ op: "llenar", cantidad: 3 });
    const b = await r.json();
    expect(b.added).toEqual([{ id: uuid(3), name: "Inmobiliaria Ficticia 3", explore: false }]);
    expect(saves().map((s) => s.p_account)).toEqual([uuid(3)]);
    expect((await post({ op: "llenar", cantidad: 0 })).status).toBe(400);
  });

  it("crear: avisa si ya está en la base y, si no, la crea con su WhatsApp por revisar", async () => {
    const dup = await post({ op: "crear", nombre: "inmobiliaria ficticia 1" });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toMatchObject({ code: "DUPLICATE", detail: uuid(1) });
    expect(state.rpcs.some((x) => x.name === "habita_prospect_add")).toBe(false);
    expect((await post({ op: "crear", nombre: "Nueva Ficticia", whatsapp: "123" })).status).toBe(400);
    // La cuenta recién creada aparece en la base en la lectura siguiente.
    (state.dataset as { accounts: unknown[] }).accounts.push(account(50, { name: "Nueva Ficticia", contacts: [wa(9, { needs_review: true, verified: false })] }));
    (state.pool as { profiles: unknown[] }).profiles.push(profile(50, "descubierto"));
    const ok = await post({ op: "crear", nombre: "Nueva Ficticia", web: "nuevaficticia.test", whatsapp: "2235000000", valores: { source_channel: "google_maps" }, confirmar: true });
    expect(ok.status).toBe(200);
    expect(state.rpcs.find((x) => x.name === "habita_prospect_add")?.args).toMatchObject({ p_name: "Nueva Ficticia", p_website: "nuevaficticia.test" });
    expect(state.rpcs.find((x) => x.name === "habita_prospect_contact")?.args).toMatchObject({ p_account: uuid(50), p_fields: { channel: "whatsapp", address: "+5492235000000", needs_review: true } });
    expect(saves()[0].p_patch).toMatchObject({ status: "descubierto", profile: { source_channel: "google_maps" } });
  });
});
