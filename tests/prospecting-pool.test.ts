import { describe, expect, it } from "vitest";
import {
  autoStatus, cleanProfile, completeness, confidenceOf, learnings, MIN_FIT, missingForQueue, outcomesOf, pickForQueue, poolBlock, scoreOf, variables,
  type LearnRow, type Profile,
} from "@/lib/prospecting/pool";
import type { Dataset, ProspectAccount, ProspectContact } from "@/lib/prospecting/types";

// Todos los nombres y números son datos sintéticos de prueba.
const contact = (o: Partial<ProspectContact> = {}): ProspectContact => ({
  id: "c1", channel: "whatsapp", address: "+5492230000001", address_original: null, person_name: null, is_decision_maker: false,
  confidence: null, source: null, needs_review: false, review_reason: null, verified: false, invalid: false, is_primary: true, blocked: null, ...o,
});
const account = (o: Partial<ProspectAccount> = {}): ProspectAccount => ({
  id: "a1", agency_id: "g1", name: "Inmobiliaria Ficticia", website: "https://ficticia.test", linked: false, campaign: null, sdr: "SDR Test", priority: null,
  score: null, score_components: {}, scoring_version: null, zone: "Zona Test", decision_maker: null, decision_maker_role: null, stage: "pending",
  lost_reason: null, next_action: null, due_at: null, due_precision: "time", version: 1, created_at: "2026-11-01T00:00:00Z", imported: false, demos: 0,
  suppressed: false, contacts: [contact()], ...o,
});
const strong: Profile = { number_confidence: "verificado", listings_total: 80, empty_listings: 30, uses_staging: "no", pct_residential: 90, new_listings_30d: 8, demo_listing_url: "https://ficticia.test/aviso/1", demo_photos_importable: "si", photo_quality: "media" };

describe("catálogo de Prospectos", () => {
  it("valida cada dato contra su tipo y deja borrar con vacío", () => {
    const { patch, errors } = cleanProfile({ listings_total: "120", uses_staging: "no", meta_ads: "si", demo_listing_url: "https://x.test/a", ai_provider: "", pct_residential: 140, structure: "raro", inventado: 1 });
    expect(patch).toEqual({ listings_total: 120, uses_staging: "no", meta_ads: true, demo_listing_url: "https://x.test/a", ai_provider: null });
    expect(errors).toHaveLength(3);
  });
  it("lleva la confianza de la planilla a las opciones del catálogo", () => {
    expect(confidenceOf(contact({ confidence: "WhatsApp verificado" }))).toBe("verificado");
    expect(confidenceOf(contact({ confidence: "Enlace WhatsApp en web propia; no se probó recepción" }))).toBe("link_web_propia");
    expect(confidenceOf(contact({ confidence: "Celular publicado; WhatsApp y vigencia por confirmar" }))).toBe("celular_publicado");
    expect(confidenceOf(contact({ confidence: "Celular publicado en directorio oficial; WhatsApp no verificado" }))).toBe("directorio");
    expect(confidenceOf(null)).toBeNull();
  });
  it("completa con la planilla lo que no se cargó, sin pisar lo cargado", () => {
    const a = account({ contacts: [contact({ confidence: "WhatsApp verificado" })] });
    const { vars, inferred } = variables(a, { listings_total: 10 }, { source_data: { "Propiedades publicadas (Argenprop)": "128", Instagram: "@ficticia" } });
    expect(vars.listings_total).toBe(10);
    expect(vars.number_confidence).toBe("verificado");
    expect(vars.instagram).toBe("@ficticia");
    expect(inferred).toEqual(["number_confidence", "instagram"]);
  });
});

describe("ranking", () => {
  it("sin WhatsApp usable la contactabilidad es cero", () => {
    expect(scoreOf(account({ contacts: [contact({ invalid: true })] }), strong).contact).toBe(0);
  });
  it("una cartera con muchos avisos vacíos y aviso para la demo rankea arriba de una sin datos", () => {
    const a = account();
    const high = scoreOf(a, strong);
    const empty = scoreOf(a, {});
    expect(high.total).toBeGreaterThan(empty.total + 25);
    expect(high.fit).toBeGreaterThanOrEqual(MIN_FIT);
    expect(high.demo).toBe(95);
  });
  it("un proveedor de IA o el amoblado virtual topean el encaje y dicen por qué", () => {
    const withProvider = scoreOf(account(), { ...strong, ai_provider: "Otra IA" });
    expect(withProvider.fit).toBe(25);
    expect(withProvider.caps.join(" ")).toMatch(/proveedor de IA/);
    expect(scoreOf(account(), { ...strong, uses_staging: "amoblado_virtual" }).fit).toBeLessThanOrEqual(45);
  });
  it("una línea fija casi no cuenta como contactable", () => {
    expect(scoreOf(account(), { ...strong, line_type: "fijo" }).contact).toBe(15);
  });
});

describe("entrada a la cola", () => {
  it("pide WhatsApp, aviso para la demo y encaje mínimo; la exploración no pide encaje", () => {
    const a = account({ contacts: [] });
    const s = scoreOf(a, {});
    // Sin datos el encaje queda neutro (no se sabe, no es malo): faltan el WhatsApp y el aviso.
    expect(missingForQueue(a, {}, s)).toHaveLength(2);
    const b = account();
    const weak: Profile = { demo_listing_url: "https://x.test/a", empty_listings: 0, uses_staging: "amoblado_virtual", pct_residential: 10, new_listings_30d: 0, listings_total: 2 };
    expect(missingForQueue(b, weak, scoreOf(b, weak))).toHaveLength(1);
    expect(missingForQueue(b, weak, scoreOf(b, weak), true)).toHaveLength(0);
    expect(missingForQueue(b, strong, scoreOf(b, strong))).toHaveLength(0);
  });
  it("el estado sale de los datos y no pisa «en cola» ni «descartado»", () => {
    expect(autoStatus(null, ["falta"], 0.2)).toBe("descubierto");
    expect(autoStatus("descubierto", ["falta"], 0.6)).toBe("enriquecido");
    expect(autoStatus("enriquecido", [], 0.6)).toBe("calificado");
    expect(autoStatus("en_cola", ["falta"], 0)).toBe("en_cola");
    expect(autoStatus("descartado", [], 1)).toBe("descartado");
    expect(completeness(strong)).toBeGreaterThan(0.5);
  });
  it("suma las mejores por ranking y una parte al azar entre las demás listas", () => {
    const list = [
      ...[90, 80, 70, 60, 50, 40, 30, 20, 10, 5].map((score, i) => ({ id: `q${i}`, score, status: "calificado" as const, hardReady: true })),
      { id: "e1", score: 12, status: "enriquecido" as const, hardReady: true },
      { id: "e2", score: 11, status: "enriquecido" as const, hardReady: true },
      { id: "x1", score: 99, status: "descubierto" as const, hardReady: false },
      { id: "d1", score: 99, status: "descartado" as const, hardReady: true },
    ];
    const pick = pickForQueue(list, 10, () => 0);
    expect(pick.explore).toEqual(["e1", "e2"]);
    expect(pick.top).toEqual(["q0", "q1", "q2", "q3", "q4", "q5", "q6", "q7"]);
    // Una tanda chica no explora, y sin candidatas para explorar se completa por ranking.
    expect(pickForQueue(list, 3, () => 0)).toEqual({ top: ["q0", "q1", "q2"], explore: [] });
    expect(pickForQueue(list.filter((c) => c.status === "calificado"), 6).top).toHaveLength(6);
  });
});

describe("la cola de Follow-up", () => {
  it("una inmobiliaria con perfil espera en Prospectos hasta que se la pasa a la cola; sin perfil, nada cambia", () => {
    expect(poolBlock({ status: "enriquecido" }, "no-contactado", false)).toMatch(/En Prospectos \(Enriquecido\)/);
    expect(poolBlock({ status: "descartado" }, "no-contactado", false)).toMatch(/Descartado/);
    expect(poolBlock({ status: "en_cola" }, "no-contactado", false)).toBeNull();
    expect(poolBlock(undefined, "no-contactado", false)).toBeNull();
    // Ya saludada o en otra etapa: Prospectos no la frena.
    expect(poolBlock({ status: "enriquecido" }, "no-contactado", true)).toBeNull();
    expect(poolBlock({ status: "enriquecido" }, "no-responde", false)).toBeNull();
  });
});

describe("aprendizajes", () => {
  const ds = (): Dataset => ({
    now: "2026-11-11T12:00:00Z",
    settings: { version: 1, message_window_days: 7, account_window_days: 30, small_sample: 30 },
    accounts: [
      account({ id: "a1", stage: "interested", demo: { created: true, sent: true, level: 2 } }),
      account({ id: "a2", stage: "sent", website: null }),
      account({ id: "a3", stage: "pending", website: null, contacts: [contact({ invalid: true })] }),
      account({ id: "a4", stage: "pending" }),
    ],
    attempts: [
      { id: "t1", account_id: "a1", status: "sent", sent_at: "2026-11-02T15:00:00Z" },
      { id: "t2", account_id: "a2", status: "sent", sent_at: "2026-11-03T15:00:00Z" },
    ] as Dataset["attempts"],
    events: [
      { id: "e1", account_id: "a1", type: "reply", human: true, corrected: false },
      { id: "e2", account_id: "a1", type: "interest", human: null, corrected: false },
      { id: "e3", account_id: "a2", type: "reply", human: false, corrected: false },
    ] as Dataset["events"],
    templates: [],
    last_import: null,
  });
  it("cuenta el resultado con las reglas del panel: respuesta humana, número válido e interacción con la demo", () => {
    const o = outcomesOf(ds());
    expect(o.get("a1")).toMatchObject({ attempted: true, valid: true, replied: true, interested: true, engaged: true });
    expect(o.get("a2")).toMatchObject({ attempted: true, valid: true, replied: false });
    expect(o.get("a3")).toMatchObject({ attempted: true, valid: false });
    expect(o.get("a4")).toMatchObject({ attempted: false });
  });
  it("cruza cada variable con el resultado, marca la muestra chica y filtra por primer mensaje", () => {
    const d = ds();
    const o = outcomesOf(d);
    const rows: LearnRow[] = d.accounts.map((a) => ({ account: a, vars: {}, outcome: o.get(a.id)!, score: null, sheetScore: null, explore: false, message: a.id === "a1" ? "Saludo V2" : a.id === "a2" ? "Saludo V1" : null }));
    const all = learnings(rows, 30);
    expect(all.total).toMatchObject({ n: 3, valid: 2, replied: 1, interested: 1, engaged: 1 });
    const web = all.dimensions.find((x) => x.key === "web")!;
    expect(web.rows.find((r) => r.value === "Con web")).toMatchObject({ n: 1, replied: 1, small: true });
    expect(web.rows.find((r) => r.value === "Sin web")).toMatchObject({ n: 2, valid: 1, replied: 0 });
    expect(all.dimensions.some((x) => x.key === "message")).toBe(true);
    const v2 = learnings(rows, 30, "Saludo V2");
    expect(v2.total.n).toBe(1);
    expect(v2.dimensions.some((x) => x.key === "message")).toBe(false);
  });
});

describe("catálogo: datos del relevamiento", () => {
  it("acepta la fuente propia, el perfil en el portal y la nota del aviso para la demo", () => {
    const { patch, errors } = cleanProfile({ source_channel: "relevamiento", portal_url: "https://www.argenprop.com/inmobiliaria-x", demo_listing_note: "Living vacío" });
    expect(errors).toEqual([]);
    expect(patch).toEqual({ source_channel: "relevamiento", portal_url: "https://www.argenprop.com/inmobiliaria-x", demo_listing_note: "Living vacío" });
  });
});
