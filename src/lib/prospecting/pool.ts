// Prospectos: la base de inmobiliarias antes de entrar a la cola de Follow-up.
// Lógica pura (sin base ni red): el catálogo de variables, el ranking, lo que
// falta para entrar a la cola, a quién sumar hoy y qué variables convierten.
//
// El ranking es una hipótesis versionada, no una probabilidad de compra: se
// ajusta a mano con la tabla de aprendizajes y cada ajuste es una versión nueva.
import type { Dataset, ProspectAccount, ProspectContact } from "./types";

export const SCORING_VERSION = "prospectos_v1";
/** Encaje mínimo para entrar a la cola por ranking (el cupo de exploración no lo exige). */
export const MIN_FIT = 40;
/** Parte de cada tanda que entra al azar, para que el ranking no se confirme solo. */
export const EXPLORE_SHARE = 0.15;
export const WEIGHTS = { contact: 0.35, fit: 0.45, demo: 0.2 };

export type PoolStatus = "descubierto" | "enriquecido" | "calificado" | "en_cola" | "descartado";
export const STATUS_LABEL: Record<PoolStatus, string> = {
  descubierto: "Descubierto",
  enriquecido: "Enriquecido",
  calificado: "Calificado",
  en_cola: "En cola",
  descartado: "Descartado",
};
export const STATUS_HELP: Record<PoolStatus, string> = {
  descubierto: "Sabemos que existe; faltan sus datos.",
  enriquecido: "Tiene al menos la mitad de los datos clave.",
  calificado: "Tiene WhatsApp, un aviso para la demo y encaje suficiente: puede entrar a la cola.",
  en_cola: "Ya está en la cola de Follow-up, esperando el saludo.",
  descartado: "No se la va a contactar.",
};

/**
 * Por qué una inmobiliaria con perfil todavía no puede recibir el saludo: sigue en Prospectos
 * hasta que se la pasa a la cola. Sin perfil (cuentas de antes) no bloquea nada.
 */
export function poolBlock(gate: { status: PoolStatus } | undefined, stage: string, sent: boolean) {
  if (!gate || gate.status === "en_cola" || stage !== "no-contactado" || sent) return null;
  return `En Prospectos (${STATUS_LABEL[gate.status]}): todavía no entró a la cola.`;
}

type Option = { value: string; label: string };
export type Field = {
  key: string;
  label: string;
  group: string;
  type: "enum" | "number" | "bool" | "text" | "url";
  options?: Option[];
  min?: number;
  max?: number;
  help?: string;
  /** Cuenta para «datos completos» y alimenta el ranking. */
  key_data?: boolean;
};
const opts = (...pairs: [string, string][]): Option[] => pairs.map(([value, label]) => ({ value, label }));

export const GROUPS = [
  { key: "fuente", label: "Fuente" },
  { key: "contacto", label: "Contacto" },
  { key: "decisor", label: "Quién decide" },
  { key: "cartera", label: "Cartera" },
  { key: "visual", label: "Necesidad visual" },
  { key: "digital", label: "Madurez digital" },
  { key: "competencia", label: "Competencia" },
] as const;

export const FIELDS: Field[] = [
  { key: "source_channel", label: "Dónde la encontramos", group: "fuente", type: "enum", key_data: true, options: opts(["argenprop", "Argenprop"], ["zonaprop", "Zonaprop"], ["mercadolibre", "MercadoLibre"], ["directorio", "Directorio"], ["google_maps", "Google Maps"], ["instagram", "Instagram"], ["referido", "Referido"], ["relevamiento", "Relevamiento web"], ["otro", "Otro"]) },
  { key: "source_batch", label: "Lote", group: "fuente", type: "text", help: "La tanda en que se cargó, para comparar fuentes." },
  { key: "research_notes", label: "Notas del relevamiento", group: "fuente", type: "text", help: "Lo que vale saber antes del saludo." },

  { key: "number_confidence", label: "Confianza del número", group: "contacto", type: "enum", key_data: true, options: opts(["verificado", "WhatsApp verificado"], ["link_web_propia", "Enlace de WhatsApp en su web"], ["celular_publicado", "Celular publicado"], ["portal", "Publicado en un portal"], ["directorio", "Directorio o fuente vieja"]) },
  { key: "line_type", label: "Tipo de línea", group: "contacto", type: "enum", key_data: true, options: opts(["celular", "Celular"], ["fijo", "Fijo"]) },
  { key: "number_owner", label: "De quién es el número", group: "contacto", type: "enum", options: opts(["dueno", "Dueño/a"], ["agente", "Un agente"], ["recepcion", "Recepción"]) },
  { key: "wa_business", label: "Usa WhatsApp Business", group: "contacto", type: "bool" },
  { key: "auto_reply", label: "Tiene respuesta automática", group: "contacto", type: "bool" },

  { key: "structure", label: "Estructura", group: "decisor", type: "enum", key_data: true, options: opts(["unipersonal", "Una persona"], ["familiar", "Familiar"], ["equipo", "Equipo"], ["franquicia", "Franquicia"]) },
  { key: "decision_confirmed", label: "Decisor confirmado", group: "decisor", type: "bool" },
  { key: "agents", label: "Agentes", group: "decisor", type: "number", min: 0, max: 500 },

  { key: "portal_url", label: "Perfil en un portal", group: "cartera", type: "url" },
  { key: "listings_total", label: "Avisos activos", group: "cartera", type: "number", min: 0, max: 20000, key_data: true },
  { key: "main_operation", label: "Operación principal", group: "cartera", type: "enum", options: opts(["venta", "Venta"], ["alquiler", "Alquiler"], ["temporario", "Alquiler temporario"], ["mixto", "Mixto"]) },
  { key: "pct_residential", label: "% residencial", group: "cartera", type: "number", min: 0, max: 100, key_data: true },
  { key: "median_price_usd", label: "Precio mediano (USD)", group: "cartera", type: "number", min: 0, max: 100000000 },
  { key: "listing_age_days", label: "Antigüedad de los avisos (días)", group: "cartera", type: "number", min: 0, max: 5000 },
  { key: "new_listings_30d", label: "Avisos nuevos en 30 días", group: "cartera", type: "number", min: 0, max: 5000, key_data: true },

  { key: "empty_listings", label: "Avisos con ambientes vacíos", group: "visual", type: "number", min: 0, max: 20000, key_data: true },
  { key: "photo_quality", label: "Calidad de las fotos", group: "visual", type: "enum", key_data: true, options: opts(["profesional", "Profesional"], ["media", "Media"], ["celular", "De celular"]) },
  { key: "uses_staging", label: "Ya ambienta sus fotos", group: "visual", type: "enum", key_data: true, options: opts(["no", "No"], ["renders", "Renders"], ["amoblado_virtual", "Amoblado virtual"], ["video_tour", "Video o recorrido"]) },
  { key: "demo_listing_url", label: "Aviso para la demo", group: "visual", type: "url", key_data: true, help: "Un aviso con ambientes vacíos para armar su demo." },
  { key: "demo_listing_note", label: "Por qué ese aviso", group: "visual", type: "text" },
  { key: "demo_photos_importable", label: "Sus fotos se pueden importar", group: "visual", type: "enum", key_data: true, options: opts(["si", "Sí"], ["no", "No"]) },

  { key: "web_platform", label: "Plataforma de su web", group: "digital", type: "enum", key_data: true, options: opts(["tokko", "Tokko"], ["xintel", "Xintel"], ["mapaprop", "Mapaprop"], ["wordpress", "WordPress"], ["propia", "Desarrollo propio"], ["otra", "Otra"], ["sin_web", "No tiene web"]) },
  { key: "instagram", label: "Instagram", group: "digital", type: "text" },
  { key: "ig_followers", label: "Seguidores en Instagram", group: "digital", type: "number", min: 0, max: 100000000 },
  { key: "ig_posts_30d", label: "Publicaciones en 30 días", group: "digital", type: "number", min: 0, max: 5000 },
  { key: "google_reviews", label: "Reseñas en Google", group: "digital", type: "number", min: 0, max: 1000000 },
  { key: "meta_ads", label: "Hace publicidad en Meta", group: "digital", type: "bool" },
  { key: "paid_featured", label: "Paga avisos destacados", group: "digital", type: "bool" },

  { key: "ai_provider", label: "Proveedor de IA actual", group: "competencia", type: "text", help: "Si ya usa otra herramienta de IA para sus fotos." },
];
const FIELD = new Map(FIELDS.map((f) => [f.key, f]));
const KEY_FIELDS = FIELDS.filter((f) => f.key_data);

export type Profile = Record<string, string | number | boolean>;

/**
 * Los valores que llegan del panel, validados contra el catálogo. `null` o vacío borra la variable.
 * Devuelve el parche para guardar y los errores, sin tirar: el servidor decide.
 */
export function cleanProfile(input: unknown): { patch: Record<string, string | number | boolean | null>; errors: string[] } {
  const patch: Record<string, string | number | boolean | null> = {};
  const errors: string[] = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) return { patch, errors: ["Faltan los datos."] };
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    const f = FIELD.get(key);
    if (!f) { errors.push(`«${key}» no es un dato de Prospectos.`); continue; }
    if (raw === null || raw === undefined || raw === "") { patch[key] = null; continue; }
    if (f.type === "bool") {
      if (typeof raw === "boolean") patch[key] = raw;
      else if (raw === "si" || raw === "true") patch[key] = true;
      else if (raw === "no" || raw === "false") patch[key] = false;
      else errors.push(`«${f.label}» es sí o no.`);
    } else if (f.type === "number") {
      const n = typeof raw === "number" ? raw : Number(String(raw).replace(",", "."));
      if (!Number.isFinite(n) || n < (f.min ?? 0) || n > (f.max ?? Number.MAX_SAFE_INTEGER)) errors.push(`«${f.label}» va de ${f.min ?? 0} a ${f.max}.`);
      else patch[key] = Math.round(n * 100) / 100;
    } else if (f.type === "enum") {
      if (f.options!.some((o) => o.value === raw)) patch[key] = raw as string;
      else errors.push(`«${f.label}» no admite ese valor.`);
    } else if (f.type === "url") {
      const s = String(raw).trim();
      if (/^https?:\/\/[^\s]+\.[^\s]+$/i.test(s) && s.length <= 500) patch[key] = s;
      else errors.push(`«${f.label}» tiene que ser un enlace (https://…).`);
    } else {
      const s = String(raw).trim().slice(0, 200);
      patch[key] = s || null;
    }
  }
  return { patch, errors };
}

const usable = (c: ProspectContact) => Boolean(c.address) && !c.invalid && !c.blocked;
/** El WhatsApp al que se le escribiría: el revisado primero. */
export function whatsappOf(a: Pick<ProspectAccount, "contacts">) {
  const list = a.contacts.filter((c) => c.channel === "whatsapp" && usable(c));
  return list.find((c) => !c.needs_review) ?? list[0] ?? null;
}

/** El texto libre de «Confianza del número» de la planilla, llevado a las opciones del catálogo. */
export function confidenceOf(c: Pick<ProspectContact, "confidence" | "verified"> | null): string | null {
  if (!c) return null;
  const t = (c.confidence ?? "").toLowerCase();
  if (c.verified || /^whatsapp verificado/.test(t)) return "verificado";
  if (/web propia/.test(t)) return "link_web_propia";
  if (/directorio|fijo|otros tel|sectorial|alternativ/.test(t)) return "directorio";
  if (/portal|argenprop|mercadolibre/.test(t)) return "portal";
  if (/celular/.test(t)) return "celular_publicado";
  return null;
}

/**
 * Cómo queda escrita la confianza de un WhatsApp relevado (la base admite hasta 60 caracteres).
 * `confidenceOf` la vuelve a leer como la misma opción del catálogo.
 */
export const CONFIDENCE_TEXT: Record<string, string> = {
  verificado: "WhatsApp verificado",
  link_web_propia: "Enlace de WhatsApp en web propia (relevamiento)",
  celular_publicado: "Celular publicado (relevamiento); WhatsApp por confirmar",
  portal: "En un portal (relevamiento); WhatsApp por confirmar",
  directorio: "Directorio (relevamiento); WhatsApp por confirmar",
};

const num = (v: unknown) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

/** El nombre sin tildes, mayúsculas ni signos, para reconocer la misma inmobiliaria. */
export const normalizedName = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** El dominio de una web, sin www. */
export const hostOf = (url: string | null | undefined) => {
  try {
    return url ? new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase() : "";
  } catch {
    return "";
  }
};
/** La cuenta que ya existe con el mismo nombre, web o WhatsApp. Las webs de portales y redes no cuentan como propias. */
export function sameAccount<T extends Pick<ProspectAccount, "name" | "website" | "contacts">>(list: T[], q: { name?: string | null; website?: string | null; whatsapp?: string | null }) {
  const name = q.name ? normalizedName(q.name) : "";
  const shared = /(^|\.)(argenprop\.com|zonaprop\.com\.ar|mercadolibre\.com\.ar|facebook\.com|instagram\.com|tuinmobiliaria\.com\.ar|blogspot\.com)$/;
  const site = hostOf(q.website);
  const ownSite = site && !shared.test(site) ? site : "";
  return (
    list.find((a) =>
      (name && normalizedName(a.name) === name) ||
      (ownSite && hostOf(a.website) === ownSite) ||
      (q.whatsapp && a.contacts.some((c) => c.address === q.whatsapp)),
    ) ?? null
  );
}

export type Extra = { address?: string | null; source?: string | null; source_data?: Record<string, unknown> | null; source_notes?: string | null };

/**
 * Las variables de una inmobiliaria: lo cargado en Prospectos y, donde falta, lo que ya dice la
 * planilla (confianza del número, avisos en Argenprop, Instagram). `inferred` nombra las que
 * salieron de la planilla, para mostrarlas distinto.
 */
export function variables(a: ProspectAccount, profile: Profile, extra: Extra = {}) {
  const v: Profile = { ...profile };
  const inferred: string[] = [];
  const fill = (key: string, value: string | number | boolean | null) => {
    if (v[key] === undefined && value !== null && value !== "") { v[key] = value; inferred.push(key); }
  };
  const sheet = extra.source_data ?? {};
  fill("number_confidence", confidenceOf(whatsappOf(a)));
  fill("listings_total", num(sheet["Propiedades publicadas (Argenprop)"]));
  const ig = typeof sheet.Instagram === "string" ? sheet.Instagram.trim() : "";
  fill("instagram", ig || null);
  if (/argenprop/i.test(String(sheet["Perfil Argenprop"] ?? ""))) fill("source_channel", "argenprop");
  if (!a.website) fill("web_platform", "sin_web");
  return { vars: v, inferred };
}

export type Score = { total: number; contact: number; fit: number; demo: number; parts: Record<string, number>; caps: string[] };

/** El ranking: contactabilidad, encaje y facilidad de armar la demo, de 0 a 100 cada uno. */
export function scoreOf(a: Pick<ProspectAccount, "contacts" | "website">, v: Profile): Score {
  const parts: Record<string, number> = {};
  const caps: string[] = [];
  const wa = whatsappOf(a);

  let contact = 0;
  if (wa) {
    const base: Record<string, number> = { verificado: 90, link_web_propia: 80, celular_publicado: 65, portal: 50, directorio: 35 };
    contact = base[String(v.number_confidence)] ?? 50;
    if (a.website) contact += 10;
    if (v.number_owner === "dueno") contact += 10;
    if (v.number_owner === "recepcion") contact -= 10;
    if (v.auto_reply === true) contact -= 15;
    if (v.line_type === "fijo") { contact = Math.min(contact, 15); caps.push("Línea fija: difícil que tenga WhatsApp."); }
    contact = Math.max(0, Math.min(100, contact));
  }

  const total = num(v.listings_total);
  const empty = num(v.empty_listings);
  const pct = total && empty !== null ? (empty / total) * 100 : null;
  parts.necesidad = empty === null ? 15 : empty === 0 ? 5 : pct !== null ? (pct >= 30 ? 40 : pct >= 10 ? 32 : 24) : empty >= 5 ? 35 : 25;
  parts.cartera = total === null ? 8 : total < 5 ? 4 : total < 20 ? 10 : total <= 250 ? 20 : total <= 500 ? 15 : 10;
  parts.ambientacion = ({ no: 15, renders: 8, video_tour: 8, amoblado_virtual: 0 } as Record<string, number>)[String(v.uses_staging)] ?? 8;
  const res = num(v.pct_residential);
  parts.residencial = res === null ? 5 : res >= 70 ? 10 : res >= 40 ? 6 : 2;
  const fresh = num(v.new_listings_30d);
  parts.actividad = fresh === null ? 5 : fresh >= 5 ? 10 : fresh >= 1 ? 7 : 2;
  parts.decisor = v.decision_confirmed === true ? 5 : 2;
  let fit = parts.necesidad + parts.cartera + parts.ambientacion + parts.residencial + parts.actividad + parts.decisor;
  if (v.uses_staging === "amoblado_virtual" && fit > 45) { fit = 45; caps.push("Ya usa amoblado virtual."); }
  if (typeof v.ai_provider === "string" && v.ai_provider.trim() && fit > 25) { fit = 25; caps.push("Ya tiene un proveedor de IA."); }

  const demo =
    (v.demo_listing_url ? 50 : 0) +
    (({ si: 30, no: 0 } as Record<string, number>)[String(v.demo_photos_importable)] ?? 12) +
    (({ profesional: 20, media: 15, celular: 8 } as Record<string, number>)[String(v.photo_quality)] ?? 8);

  return {
    total: Math.round(WEIGHTS.contact * contact + WEIGHTS.fit * fit + WEIGHTS.demo * demo),
    contact: Math.round(contact),
    fit: Math.round(fit),
    demo: Math.round(Math.min(100, demo)),
    parts,
    caps,
  };
}

/** Cuántos de los datos clave están cargados (de 0 a 1). */
export function completeness(v: Profile) {
  return KEY_FIELDS.filter((f) => v[f.key] !== undefined && v[f.key] !== "").length / KEY_FIELDS.length;
}

/** Lo que falta para entrar a la cola. El cupo de exploración no exige el encaje mínimo. */
export function missingForQueue(a: Pick<ProspectAccount, "contacts" | "suppressed">, v: Profile, s: Score, explore = false) {
  const out: string[] = [];
  if (a.suppressed) out.push("Tiene una baja: no se la contacta.");
  if (!whatsappOf(a)) out.push("Falta un WhatsApp que se pueda usar.");
  if (!v.demo_listing_url) out.push("Falta elegir el aviso para su demo.");
  if (!explore && s.fit < MIN_FIT) out.push(`Encaje ${s.fit}: el mínimo para entrar por ranking es ${MIN_FIT}.`);
  return out;
}

/** El estado que sale de los datos. «En cola» y «Descartado» son decisiones y no se pisan. */
export function autoStatus(current: PoolStatus | null, missing: string[], complete: number): PoolStatus {
  if (current === "en_cola" || current === "descartado") return current;
  if (!missing.length) return "calificado";
  return complete >= 0.5 ? "enriquecido" : "descubierto";
}

export type Candidate = { id: string; score: number; status: PoolStatus; hardReady: boolean };
/**
 * A quién sumar a la cola: los mejores calificados por ranking y, de cada tanda de 5 o más, una
 * parte al azar entre las demás que tienen WhatsApp y aviso para la demo (exploración).
 */
export function pickForQueue(list: Candidate[], count: number, rand: () => number = Math.random, share = EXPLORE_SHARE) {
  const n = Math.max(0, Math.floor(count));
  const ranked = list.filter((c) => c.status === "calificado").sort((x, y) => y.score - x.score || x.id.localeCompare(y.id));
  const others = list.filter((c) => c.status !== "calificado" && c.status !== "en_cola" && c.status !== "descartado" && c.hardReady);
  const exploreWanted = n >= 5 ? Math.max(1, Math.round(n * share)) : 0;
  const pool = [...others];
  const explore: string[] = [];
  while (explore.length < exploreWanted && pool.length) explore.push(pool.splice(Math.floor(rand() * pool.length), 1)[0].id);
  const top = ranked.slice(0, n - explore.length).map((c) => c.id);
  return { top, explore };
}

// ── Aprendizajes ────────────────────────────────────────────────────────────

export type Outcome = { attempted: boolean; valid: boolean; replied: boolean; interested: boolean; engaged: boolean; customer: boolean; firstAt: string | null };

/** Qué pasó con cada cuenta, con las mismas reglas del resto del panel (respuesta humana, interés registrado, demo con interacción). */
export function outcomesOf(ds: Dataset) {
  const sent = new Map<string, string>();
  for (const t of ds.attempts) {
    if (t.status !== "sent" || !t.sent_at) continue;
    const prev = sent.get(t.account_id);
    if (!prev || t.sent_at < prev) sent.set(t.account_id, t.sent_at);
  }
  const flags = new Map<string, Set<string>>();
  for (const e of ds.events) {
    if (e.corrected || (e.type === "reply" && e.human === false)) continue;
    flags.set(e.account_id, (flags.get(e.account_id) ?? new Set()).add(e.type));
  }
  const out = new Map<string, Outcome>();
  for (const a of ds.accounts) {
    const f = flags.get(a.id) ?? new Set<string>();
    const wa = a.contacts.filter((c) => c.channel === "whatsapp");
    const invalid = wa.length > 0 && wa.every((c) => c.invalid);
    const contacted = sent.has(a.id) || (a.stage !== "pending" && a.stage !== "discarded");
    const replied = ["reply", "interest", "not_interested", "meeting"].some((t) => f.has(t));
    out.set(a.id, {
      attempted: contacted || invalid,
      valid: (contacted && !invalid) || replied,
      replied,
      interested: f.has("interest"),
      engaged: (a.demo?.level ?? 0) >= 2,
      customer: f.has("purchased") || a.stage === "customer",
      firstAt: sent.get(a.id) ?? null,
    });
  }
  return out;
}

const band = (n: number | null, cuts: [number, string][], rest: string) => {
  if (n === null) return null;
  for (const [limit, label] of cuts) if (n < limit) return label;
  return rest;
};
const label = (key: string, value: unknown) => {
  if (value === undefined || value === null || value === "") return null;
  const f = FIELD.get(key);
  if (typeof value === "boolean") return value ? "Sí" : "No";
  return f?.options?.find((o) => o.value === value)?.label ?? String(value);
};

export type LearnRow = { account: ProspectAccount; vars: Profile; outcome: Outcome; score: number | null; sheetScore: number | null; explore: boolean; message: string | null };
type Dimension = { key: string; label: string; of: (r: LearnRow) => string | null };

/** Las variables que se cruzan con el resultado. Las numéricas van en tramos. */
export const DIMENSIONS: Dimension[] = [
  { key: "message", label: "Primer mensaje", of: (r) => r.message },
  { key: "score", label: "Ranking al entrar a la cola", of: (r) => band(r.score, [[40, "Menos de 40"], [50, "40 a 49"], [60, "50 a 59"], [70, "60 a 69"]], "70 o más") },
  { key: "sheet_score", label: "Score de la planilla", of: (r) => band(r.sheetScore, [[40, "Menos de 40"], [50, "40 a 49"], [60, "50 a 59"], [70, "60 a 69"]], "70 o más") },
  { key: "explore", label: "Cómo entró a la cola", of: (r) => (r.explore ? "Exploración (al azar)" : r.score === null ? null : "Por ranking") },
  { key: "number_confidence", label: "Confianza del número", of: (r) => label("number_confidence", r.vars.number_confidence) },
  { key: "web", label: "Web propia", of: (r) => (r.account.website ? "Con web" : "Sin web") },
  { key: "zone", label: "Zona", of: (r) => r.account.zone?.trim() || null },
  { key: "decisor", label: "Quién decide (planilla)", of: (r) => r.account.decision_maker?.trim() || null },
  { key: "sdr", label: "SDR", of: (r) => r.account.sdr?.trim() || null },
  { key: "source_channel", label: "Dónde la encontramos", of: (r) => label("source_channel", r.vars.source_channel) },
  { key: "structure", label: "Estructura", of: (r) => label("structure", r.vars.structure) },
  { key: "source_batch", label: "Lote", of: (r) => (typeof r.vars.source_batch === "string" && r.vars.source_batch.trim()) || null },
  { key: "listings_total", label: "Avisos activos", of: (r) => band(num(r.vars.listings_total), [[20, "Menos de 20"], [100, "20 a 99"], [251, "100 a 250"]], "Más de 250") },
  { key: "empty", label: "Avisos vacíos", of: (r) => band(num(r.vars.empty_listings), [[1, "Ninguno"], [5, "1 a 4"], [20, "5 a 19"]], "20 o más") },
  { key: "uses_staging", label: "Ya ambienta sus fotos", of: (r) => label("uses_staging", r.vars.uses_staging) },
  { key: "photo_quality", label: "Calidad de las fotos", of: (r) => label("photo_quality", r.vars.photo_quality) },
  { key: "main_operation", label: "Operación principal", of: (r) => label("main_operation", r.vars.main_operation) },
  { key: "web_platform", label: "Plataforma de su web", of: (r) => label("web_platform", r.vars.web_platform) },
  { key: "instagram", label: "Instagram", of: (r) => (r.vars.instagram ? "Con Instagram" : "Sin Instagram") },
  { key: "ig_followers", label: "Seguidores en Instagram", of: (r) => band(num(r.vars.ig_followers), [[500, "Menos de 500"], [2000, "500 a 1.999"], [10000, "2.000 a 9.999"]], "10.000 o más") },
  { key: "meta_ads", label: "Hace publicidad en Meta", of: (r) => label("meta_ads", r.vars.meta_ads) },
  { key: "auto_reply", label: "Respuesta automática", of: (r) => label("auto_reply", r.vars.auto_reply) },
  { key: "weekday", label: "Día del primer contacto", of: (r) => (r.outcome.firstAt ? ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"][new Date(Date.parse(r.outcome.firstAt) - 3 * 3600_000).getUTCDay()] : null) },
];

export type LearnCell = { value: string; n: number; valid: number; replied: number; interested: number; engaged: number; customers: number; small: boolean };

/**
 * Por cada variable, cuántas se intentaron con cada valor y hasta dónde llegaron. Las tasas se
 * calculan en el panel sobre las de número válido; con menos de `small` intentos, «muestra chica».
 * `message` deja solo las contactadas con ese primer mensaje, para no mezclar lead y mensaje.
 */
export function learnings(rows: LearnRow[], small = 30, message: string | null = null) {
  const base = rows.filter((r) => r.outcome.attempted && (!message || r.message === message));
  const tally = (list: LearnRow[], value: string): LearnCell => ({
    value,
    n: list.length,
    valid: list.filter((r) => r.outcome.valid).length,
    replied: list.filter((r) => r.outcome.replied).length,
    interested: list.filter((r) => r.outcome.interested).length,
    engaged: list.filter((r) => r.outcome.engaged).length,
    customers: list.filter((r) => r.outcome.customer).length,
    small: list.length < small,
  });
  const dimensions = DIMENSIONS.map((d) => {
    const groups = new Map<string, LearnRow[]>();
    for (const r of base) {
      const value = d.of(r);
      if (value) groups.set(value, [...(groups.get(value) ?? []), r]);
    }
    const cells = [...groups].map(([value, list]) => tally(list, value)).sort((x, y) => y.n - x.n).slice(0, 12);
    return { key: d.key, label: d.label, known: cells.reduce((s, c) => s + c.n, 0), rows: cells };
  }).filter((d) => d.rows.length > 0 && (d.key !== "message" || !message));
  return { total: tally(base, "Todas"), dimensions, small };
}
