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
  { key: "source_channel", label: "Dónde la encontramos", group: "fuente", type: "enum", key_data: true, options: opts(["argenprop", "Argenprop"], ["zonaprop", "Zonaprop"], ["mercadolibre", "MercadoLibre"], ["directorio", "Directorio"], ["google_maps", "Google Maps"], ["instagram", "Instagram"], ["referido", "Referido"], ["relevamiento", "Relevamiento propio"], ["otro", "Otro"]) },
  { key: "source_batch", label: "Lote", group: "fuente", type: "text", help: "La tanda en que se cargó, para comparar fuentes." },
  { key: "portal_url", label: "Perfil en el portal", group: "fuente", type: "url", help: "Su página de inmobiliaria en Argenprop, Zonaprop u otro portal." },

  { key: "number_confidence", label: "Confianza del número", group: "contacto", type: "enum", key_data: true, options: opts(["verificado", "WhatsApp verificado"], ["link_web_propia", "Enlace de WhatsApp en su web"], ["celular_publicado", "Celular publicado"], ["portal", "Publicado en un portal"], ["directorio", "Directorio o fuente vieja"]) },
  { key: "line_type", label: "Tipo de línea", group: "contacto", type: "enum", key_data: true, options: opts(["celular", "Celular"], ["fijo", "Fijo"]) },
  { key: "number_owner", label: "De quién es el número", group: "contacto", type: "enum", options: opts(["dueno", "Dueño/a"], ["agente", "Un agente"], ["recepcion", "Recepción"]) },
  { key: "wa_business", label: "Usa WhatsApp Business", group: "contacto", type: "bool" },
  { key: "auto_reply", label: "Tiene respuesta automática", group: "contacto", type: "bool" },

  { key: "structure", label: "Estructura", group: "decisor", type: "enum", key_data: true, options: opts(["unipersonal", "Una persona"], ["familiar", "Familiar"], ["equipo", "Equipo"], ["franquicia", "Franquicia"]) },
  { key: "decision_confirmed", label: "Decisor confirmado", group: "decisor", type: "bool" },
  { key: "agents", label: "Agentes", group: "decisor", type: "number", min: 0, max: 500 },

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
  { key: "demo_listing_reference", label: "Cómo mencionar este inmueble en WhatsApp", group: "visual", type: "text", help: "Usá el artículo, tipo de inmueble y calle o barrio del aviso. Ej.: el PH de tres ambientes en San Bernardo." },
  { key: "demo_listing_note", label: "Nota del aviso para la demo", group: "visual", type: "text", help: "Qué tiene el aviso elegido (ambientes vacíos, fotos) o por qué falta." },
  { key: "demo_preload_url_2", label: "Precarga 2", group: "visual", type: "url", help: "Otro aviso individual de la misma inmobiliaria, de su web propia: queda en su panel listo para importar con un clic." },
  { key: "demo_preload_url_3", label: "Precarga 3", group: "visual", type: "url", help: "Un tercer aviso de la misma inmobiliaria, distinto de los otros dos. Mejor si muestra otro ambiente." },
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

const num = (v: unknown) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

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

/**
 * Los portales que no dejan leer el aviso desde nuestros servidores (Zonaprop y MercadoLibre piden
 * verificación anti-robots; Argenprop la pide a veces): la demo se arma con el aviso de la web de la
 * inmobiliaria. Devuelve el nombre del portal, o `null` si el link es de otra web.
 */
const PORTALS: [RegExp, string][] = [
  [/(^|\.)argenprop\.com$/, "Argenprop"],
  [/(^|\.)zonaprop\.com\.ar$/, "Zonaprop"],
  [/(^|\.)mercadolibre\.com\.ar$/, "MercadoLibre"],
];
export function portalOfListing(url: unknown): string | null {
  if (typeof url !== "string" || !url.trim()) return null;
  try {
    const host = new URL(/^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`).hostname.toLowerCase();
    return PORTALS.find(([re]) => re.test(host))?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Tiene el aviso para la demo como lo pide la cola: de su web propia y con su referencia para WhatsApp. */
export function demoReady(v: Profile) {
  return Boolean(v.demo_listing_url && v.demo_listing_reference && !portalOfListing(v.demo_listing_url));
}

// ── Avisos de la demo: el principal y las dos precargas ────────────────────

/** Los tres avisos que usa «Crear demo»: el de la demo publicada y los dos que quedan precargados. */
export const LISTING_KEYS = ["demo_listing_url", "demo_preload_url_2", "demo_preload_url_3"] as const;
export type ListingKey = (typeof LISTING_KEYS)[number];
export const LISTING_LABEL: Record<ListingKey, string> = { demo_listing_url: "Aviso para la demo", demo_preload_url_2: "Precarga 2", demo_preload_url_3: "Precarga 3" };
/** La lectura de prueba de un aviso: si se importa, con cuántas fotos, o por qué no. */
export type ListingCheck = { ok: boolean; photos: number; title: string | null; error: string | null; at: string };
export type ListingChecks = Record<string, ListingCheck>;
/** Cada aviso importado a su panel al pasar a Interesado: la propiedad queda «Lista para importar». */
export type DemoPrepItem = { key: ListingKey; url: string; ok: boolean; demoId: string | null; photos: number; error: string | null };
export type DemoPrep = { at: string; attempts: number; by: string; items: DemoPrepItem[] };

/** Si hay que (volver a) preparar: nunca preparada, un aviso nuevo, o un intento fallido viejo (hasta 3). */
export function prepDue(v: Profile, prep: DemoPrep | null | undefined, now = Date.now()) {
  const listings = listingsOf(v);
  if (!listings.length) return false;
  if (!prep) return true;
  const missing = listings.some((l) => !prep.items.some((i) => i.ok && sameListing(i.url, l.url)));
  if (!missing) return false;
  const fresh = listings.some((l) => !prep.items.some((i) => sameListing(i.url, l.url)));
  return fresh || (prep.attempts < 3 && now - Date.parse(prep.at) > 6 * 3600_000);
}

/** La misma publicación escrita distinto (mayúsculas, «www», barra final, parámetros de campaña) cuenta como una. */
export function sameListing(a: unknown, b: unknown) {
  const norm = (u: unknown) => {
    if (typeof u !== "string" || !u.trim()) return null;
    try {
      const x = new URL(/^https?:\/\//i.test(u.trim()) ? u.trim() : `https://${u.trim()}`);
      for (const k of [...x.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/i.test(k)) x.searchParams.delete(k);
      return `${x.hostname.replace(/^www\./, "").toLowerCase()}${x.pathname.replace(/\/+$/, "")}${x.search}`;
    } catch {
      return u.trim().toLowerCase();
    }
  };
  const x = norm(a);
  return x !== null && x === norm(b);
}

/** Los avisos cargados, en orden, sin repetidos. */
export function listingsOf(v: Profile) {
  const out: { key: ListingKey; url: string }[] = [];
  for (const key of LISTING_KEYS) {
    const url = v[key];
    if (typeof url === "string" && url.trim() && !out.some((o) => sameListing(o.url, url))) out.push({ key, url: url.trim() });
  }
  return out;
}

/** Dos avisos iguales entre el principal y las precargas: se avisa al guardar, no se guarda. */
export function repeatedListings(v: Profile) {
  const set = LISTING_KEYS.map((k) => [k, v[k]] as const).filter(([, u]) => typeof u === "string" && u);
  for (let i = 0; i < set.length; i++)
    for (let j = i + 1; j < set.length; j++)
      if (sameListing(set[i][1], set[j][1])) return `«${LISTING_LABEL[set[j][0]]}» es el mismo aviso que «${LISTING_LABEL[set[i][0]]}»: elegí otro.`;
  return null;
}

/** La lectura de prueba de ese aviso, si se hizo. */
export function checkOf(checks: ListingChecks | null | undefined, url: unknown): ListingCheck | null {
  if (!checks || typeof url !== "string") return null;
  const hit = Object.entries(checks).find(([u]) => sameListing(u, url));
  return hit ? hit[1] : null;
}

/** Los avisos que todavía no se leyeron (o cambiaron desde la última lectura). */
export function uncheckedListings(v: Profile, checks: ListingChecks | null | undefined) {
  return listingsOf(v).filter((l) => !checkOf(checks, l.url));
}

/**
 * Lo que «Crear demo» va a encontrar listo: los avisos cargados, cuáles se leyeron bien y qué falta.
 * Las precargas no son obligatorias para la cola: si faltan, la extensión las busca como antes.
 */
export function demoKit(v: Profile, checks: ListingChecks | null | undefined) {
  const items = LISTING_KEYS.map((key) => {
    const url = typeof v[key] === "string" && String(v[key]).trim() ? String(v[key]).trim() : null;
    return { key, label: LISTING_LABEL[key], url, check: url ? checkOf(checks, url) : null };
  });
  const preloads = items.filter((i) => i.key !== "demo_listing_url" && i.url && i.check?.ok).length;
  const notes: string[] = [];
  for (const i of items) {
    if (!i.url) { if (i.key !== "demo_listing_url") notes.push(`Falta «${i.label}».`); continue; }
    if (!i.check) notes.push(`«${i.label}»: todavía no se comprobó que se pueda importar.`);
    else if (!i.check.ok) notes.push(`«${i.label}» no se puede importar: ${i.check.error ?? "no se pudo leer"}`);
  }
  return { items, preloads, notes };
}

/** Lo que falta para entrar a la cola. El cupo de exploración no exige el encaje mínimo. */
export function missingForQueue(a: Pick<ProspectAccount, "contacts" | "suppressed">, v: Profile, s: Score, explore = false, checks?: ListingChecks | null) {
  const out: string[] = [];
  if (a.suppressed) out.push("Tiene una baja: no se la contacta.");
  if (!whatsappOf(a)) out.push("Falta un WhatsApp que se pueda usar.");
  if (!v.demo_listing_url) out.push("Falta elegir el aviso para su demo.");
  else if (portalOfListing(v.demo_listing_url)) out.push(`El aviso para la demo es de ${portalOfListing(v.demo_listing_url)}: elegí el mismo u otro en su web propia.`);
  else {
    // Leído y sin poder importarse: mejor cambiarlo ahora que descubrirlo al armar la demo.
    const check = checkOf(checks, v.demo_listing_url);
    if (check && !check.ok) out.push(`El aviso para la demo no se puede importar (${check.error ?? "no se pudo leer"}): elegí otro.`);
  }
  if (!v.demo_listing_reference) out.push("Completar inmueble candidato: falta su referencia para WhatsApp.");
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
  const ranked = list.filter((c) => c.status === "calificado" && c.hardReady).sort((x, y) => y.score - x.score || x.id.localeCompare(y.id));
  const others = list.filter((c) => c.status !== "calificado" && c.status !== "en_cola" && c.status !== "descartado" && c.hardReady);
  const exploreWanted = n >= 5 ? Math.max(1, Math.round(n * share)) : 0;
  const pool = [...others];
  const explore: string[] = [];
  while (explore.length < exploreWanted && pool.length) explore.push(pool.splice(Math.floor(rand() * pool.length), 1)[0].id);
  const top = ranked.slice(0, n - explore.length).map((c) => c.id);
  return { top, explore };
}

/** Lo más que suma por vez «Sumar las mejores» (y el llenado automático). */
export const FILL_MAX = 100;

/**
 * Cuántas sumar en el llenado automático: las que faltan para que la cola tenga `target` primeros
 * saludos listos o esperando cupo. Nunca negativo ni más de `FILL_MAX`.
 */
export function autofillNeed(target: number, waiting: number) {
  const t = Number.isFinite(target) ? Math.floor(target) : 0;
  const w = Number.isFinite(waiting) ? Math.max(0, Math.floor(waiting)) : 0;
  return Math.max(0, Math.min(FILL_MAX, t - w));
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

// ── Ya trabajadas ───────────────────────────────────────────────────────────

/** En qué quedó una inmobiliaria que ya se trabajó, de lo más avanzado a lo menos. */
export const HISTORY_SITUATIONS = [
  { key: "cliente", label: "Cliente" },
  { key: "demo", label: "Demo con interacción" },
  { key: "interesada", label: "Interesada" },
  { key: "respondio", label: "Respondió" },
  { key: "contactada", label: "Contactada, sin respuesta" },
  { key: "en_cola", label: "En cola, sin contactar" },
  { key: "numero_invalido", label: "Número inválido" },
  { key: "perdida", label: "Perdida" },
  { key: "baja", label: "Pidió no ser contactada" },
  { key: "descartada", label: "Descartada" },
] as const;
export type HistorySituation = (typeof HISTORY_SITUATIONS)[number]["key"];

/**
 * La situación de una inmobiliaria para la lista «Ya trabajadas», o `null` si todavía se está
 * prospectando (Descubierto, Enriquecido o Calificado, sin contactar). Una baja o una pérdida pesan
 * más que lo que haya respondido antes: es lo último que dijo. Ser cliente pesa más que todo.
 */
export function historySituation(a: Pick<ProspectAccount, "stage" | "suppressed" | "contacts">, o: Outcome, pool: PoolStatus | null, contacted: boolean): HistorySituation | null {
  const wa = a.contacts.filter((c) => c.channel === "whatsapp");
  if (o.customer) return "cliente";
  if (a.suppressed) return "baja";
  if (a.stage === "lost") return "perdida";
  if (a.stage === "discarded" || pool === "descartado") return "descartada";
  if (o.engaged) return "demo";
  if (o.interested) return "interesada";
  if (o.replied) return "respondio";
  if (contacted) return "contactada";
  if (wa.length > 0 && wa.every((c) => c.invalid)) return "numero_invalido";
  if (pool === "en_cola") return "en_cola";
  return null;
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
