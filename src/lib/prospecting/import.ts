// Import of the prospecting sheet (CSV/TSV export of each tab). Pure: parse,
// map, normalize and preview without writing; the server applies the same
// rows through habita_prospect_import. Nothing is invented: unknown values
// stay unknown and every original cell is kept in `raw`.
import { isDate } from "./time";

export const IMPORT_FIELDS = {
  external_id: "ID estable de la fila",
  priority: "Prioridad",
  score: "Score",
  name: "Inmobiliaria",
  sdr: "SDR",
  campaign: "Campaña",
  decision_maker: "Quién decide",
  whatsapp_link: "Abrir WhatsApp (link)",
  phone: "Número (sin 0 ni 15)",
  phone_confidence: "Confianza del número",
  phone_source: "Fuente del número",
  status: "Estado",
  sent_date: "Fecha de envío",
  notes: "Notas",
  listings: "Propiedades publicadas",
  sample: "Avisos vistos en muestra",
  pts_contact: "Puntos contacto",
  pts_decision: "Puntos quién decide",
  pts_stock: "Puntos stock",
  pts_activity: "Puntos actividad",
  address: "Dirección",
  zone: "Zona",
  website: "Web",
  instagram: "Instagram",
  email: "Email",
  argenprop: "Perfil Argenprop",
  other_phones: "Otros teléfonos",
} as const;
export type ImportField = keyof typeof IMPORT_FIELDS;
/** Column header → field. Unmapped columns are kept in raw. */
export type Mapping = Partial<Record<ImportField, string>>;

// Order matters: specific patterns before generic ones.
const GUESS: [ImportField, RegExp][] = [
  ["pts_contact", /(puntos?|pts).*contacto/i],
  ["pts_decision", /(puntos?|pts).*(decide|decisor)/i],
  ["pts_stock", /(puntos?|pts).*stock/i],
  ["pts_activity", /(puntos?|pts).*actividad/i],
  ["other_phones", /otros?\s+tel|tel[eé]fonos?\s+alternativ/i],
  ["whatsapp_link", /abrir\s+whatsapp|link.*whatsapp|wa\.me/i],
  ["phone_confidence", /confianza/i],
  ["phone_source", /fuente/i],
  ["external_id", /^(id|clave|row\s*id)$/i],
  ["priority", /prioridad/i],
  ["score", /^(score|puntaje)(\s+total)?$/i],
  ["sdr", /\bsdr\b|responsable/i],
  ["campaign", /campa[nñ]a/i],
  ["decision_maker", /qui[eé]n\s+decide|decisor/i],
  ["phone", /n[uú]mero|tel[eé]fono|celular/i],
  ["status", /^estado/i],
  ["sent_date", /fecha/i],
  ["notes", /^notas?/i],
  ["listings", /propiedades\s+publicadas|^stock$/i],
  ["sample", /avisos?\s+vistos|muestra/i],
  ["address", /direcci[oó]n/i],
  ["zone", /^zona|barrio|localidad/i],
  ["website", /^web|sitio/i],
  ["instagram", /instagram/i],
  ["email", /e-?mail|correo/i],
  ["argenprop", /argenprop/i],
  ["name", /inmobiliaria|^nombre/i],
];

export function guessMapping(headers: string[]): Mapping {
  const out: Mapping = {};
  const used = new Set<string>();
  for (const [field, re] of GUESS)
    for (const h of headers)
      if (!used.has(h) && !out[field] && re.test(h.trim())) {
        out[field] = h;
        used.add(h);
      }
  return out;
}

export const MAX_IMPORT_BYTES = 2_000_000;
export const MAX_IMPORT_ROWS = 5000;

/** RFC 4180 CSV (quotes, escaped quotes, newlines in cells); delimiter detected from the header: , ; or tab. */
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const src = text.replace(/^\uFEFF/, "");
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const delimiter = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ""));
  const [head = [], ...body] = nonEmpty;
  // Repeated or empty headers get a suffix so no column is lost.
  const seen = new Map<string, number>();
  const headers = head.map((h, i) => {
    const base = h.trim() || `Columna ${i + 1}`;
    const k = (seen.get(base) ?? 0) + 1;
    seen.set(base, k);
    return k > 1 ? `${base} (${k})` : base;
  });
  return { headers, rows: body };
}

const digits = (s: string) => s.replace(/\D/g, "");

/**
 * Argentine phone for WhatsApp. A link (wa.me / api.whatsapp.com) is
 * explicit and wins. A bare 10-digit number (area + number, without 0/15)
 * gets the mobile 9 only as a candidate that must be reviewed before use.
 */
export function normalizeWhatsapp(link: string, phone: string): { address: string | null; review: string | null; original: string } {
  const fromLink = link.match(/(?:wa\.me\/|phone=)\+?(\d{8,15})/i)?.[1];
  if (fromLink) {
    const d = fromLink;
    if (d.startsWith("549") && d.length === 13) return { address: `+${d}`, review: null, original: link };
    return { address: `+${d}`, review: "El enlace de WhatsApp no tiene el formato 549 + 10 dígitos: revisalo", original: link };
  }
  const raw = phone.trim();
  if (!raw) return { address: null, review: null, original: "" };
  let d = digits(raw).replace(/^00/, "");
  if (d.startsWith("549") && d.length === 13) return { address: `+${d}`, review: null, original: raw };
  if (d.startsWith("54") && d.length === 12)
    return { address: `+${d}`, review: "Sin el 9 de celular: puede ser un fijo. Confirmá que tenga WhatsApp", original: raw };
  if (d.startsWith("0")) d = d.slice(1);
  if (d.length === 10)
    return { address: `+549${d}`, review: "Se agregó el 9 de celular a un número de 10 dígitos: confirmalo antes de abrir WhatsApp", original: raw };
  return { address: null, review: "Formato no reconocido (¿falta la característica?): corregilo a mano", original: raw };
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const GENERIC_MAILBOX = /^(info|contacto|ventas|hola|admin|administracion|consultas|inmobiliaria|office|mail)@/i;
const domain = (url: string) => {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
};
export const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);

/** "1.234,5", "88", "88.5" → number; anything else → null (the original stays in raw). */
export function parseNumber(s: string) {
  const t = s.trim();
  if (!t) return null;
  const normalized = /,\d{1,2}$/.test(t) ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  return /^-?\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : null;
}

/** dd/mm/yyyy, d/m/yy or yyyy-mm-dd → YYYY-MM-DD (day precision). Anything else → null. */
export function parseDay(s: string) {
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return isDate(t) ? t : null;
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (!m) return null;
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  const out = `${year}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const d = new Date(`${out}T12:00:00-03:00`);
  return isDate(out) && d.getUTCDate() === Number(m[1]) ? out : null;
}

export type LegacyStatus = "pending" | "sent" | "invalid" | "unknown" | null;
export function parseStatus(s: string): LegacyStatus {
  const t = s.trim().toLowerCase();
  if (!t) return null;
  if (/enviad/.test(t)) return "sent";
  if (/pendiente/.test(t)) return "pending";
  if (/incorrect|inv[aá]lid|equivocad/.test(t)) return "invalid";
  return "unknown";
}

export type ImportContact = {
  channel: "whatsapp" | "email" | "phone" | "instagram" | "web" | "other";
  address: string | null;
  address_original: string;
  confidence?: string | null;
  source?: string | null;
  source_url?: string | null;
  needs_review?: boolean;
  review_reason?: string | null;
  invalid?: boolean;
  invalid_reason?: string | null;
  is_primary?: boolean;
  is_decision_maker?: boolean;
};

export type ImportRow = {
  row_number: number;
  source_key: string;
  name: string;
  website: string | null;
  sdr: string | null;
  campaign: string | null;
  priority: string | null;
  score: number | null;
  score_components: Record<string, number | string>;
  zone: string | null;
  address: string | null;
  decision_maker: string | null;
  notes: string | null;
  legacy_status: LegacyStatus;
  sent_date: string | null;
  contacts: ImportContact[];
  raw: Record<string, string>;
  messages: string[];
  error: string | null;
  agency_id?: string | null;
};

export function buildRows(parsed: { headers: string[]; rows: string[][] }, mapping: Mapping): ImportRow[] {
  const col = (field: ImportField) => (mapping[field] ? parsed.headers.indexOf(mapping[field]!) : -1);
  const keys = new Map<string, number>();
  return parsed.rows.map((cells, i) => {
    const row_number = i + 2; // the header is row 1, like in the sheet
    const get = (f: ImportField) => {
      const c = col(f);
      return c >= 0 ? (cells[c] ?? "").trim() : "";
    };
    const raw: Record<string, string> = {};
    parsed.headers.forEach((h, c) => {
      if ((cells[c] ?? "").trim() !== "") raw[h] = (cells[c] ?? "").trim().slice(0, 2000);
    });
    const messages: string[] = [];
    const name = get("name").slice(0, 120);
    const externalId = get("external_id");
    const source_key = externalId ? `id:${externalId}` : name ? `nombre:${slug(name)}` : "";
    let error: string | null = null;
    if (!name) error = "Falta el nombre de la inmobiliaria";
    else if (keys.has(source_key)) error = `Clave repetida: la fila ${keys.get(source_key)} tiene la misma inmobiliaria. Revisá cuál conservar`;
    else keys.set(source_key, row_number);

    const scoreText = get("score");
    const score = parseNumber(scoreText);
    if (scoreText && score == null) messages.push(`Score «${scoreText}» no es numérico: se conserva en los datos originales`);
    const score_components: Record<string, number | string> = {};
    for (const [f, label] of [["pts_contact", "contacto"], ["pts_decision", "decisor"], ["pts_stock", "stock"], ["pts_activity", "actividad"]] as const) {
      const v = get(f);
      if (v) score_components[label] = parseNumber(v) ?? v;
    }
    for (const [f, label] of [["listings", "propiedades_publicadas"], ["sample", "avisos_vistos_en_muestra"]] as const) {
      const v = get(f);
      if (v) score_components[label] = parseNumber(v) ?? v;
    }

    const statusText = get("status");
    const legacy_status = parseStatus(statusText);
    if (legacy_status === "unknown") messages.push(`Estado «${statusText}» no reconocido: no se registra envío`);
    const dateText = get("sent_date");
    const sent_date = dateText ? parseDay(dateText) : null;
    if (dateText && !sent_date) messages.push(`Fecha «${dateText}» no reconocida`);
    if (legacy_status === "sent" && !sent_date) messages.push("Figura como Enviado sin fecha válida: no se registra el envío");
    if (legacy_status === "sent" && sent_date) messages.push("Envío histórico: fecha sin hora, canal y variante desconocidos");

    const contacts: ImportContact[] = [];
    const wa = normalizeWhatsapp(get("whatsapp_link"), get("phone"));
    if (wa.address || wa.original) {
      const invalid = legacy_status === "invalid";
      contacts.push({
        channel: "whatsapp",
        address: wa.address,
        address_original: wa.original,
        confidence: get("phone_confidence") || null,
        source: get("phone_source") || "planilla",
        source_url: /^https?:\/\//i.test(get("phone_source")) ? get("phone_source") : null,
        needs_review: !!wa.review,
        review_reason: wa.review,
        invalid,
        invalid_reason: invalid ? `Planilla: ${statusText}` : null,
        is_primary: !invalid,
      });
      if (wa.review) messages.push(wa.review);
    } else if (legacy_status === "invalid") messages.push("Número incorrecto sin número cargado");
    const email = get("email").toLowerCase();
    if (email) {
      if (EMAIL_RE.test(email))
        contacts.push({ channel: "email", address: email, address_original: get("email"), source: "planilla", is_primary: !contacts.some((c) => c.is_primary) });
      else {
        contacts.push({ channel: "email", address: null, address_original: get("email"), source: "planilla", needs_review: true, review_reason: "Email con formato inválido" });
        messages.push(`Email «${get("email")}» con formato inválido`);
      }
    }
    for (const part of get("other_phones").split(/[/;|,]|\s{2,}/).map((p) => p.trim()).filter(Boolean)) {
      const d = digits(part);
      contacts.push({
        channel: "phone",
        address: d.length >= 8 ? `+54${d.replace(/^54/, "").replace(/^0/, "")}` : null,
        address_original: part,
        source: "planilla",
        needs_review: true,
        review_reason: "Teléfono alternativo sin verificar",
      });
    }
    const website = get("website") || null;
    if (website) contacts.push({ channel: "web", address: website.slice(0, 300), address_original: website, source: "planilla" });
    if (get("instagram")) contacts.push({ channel: "instagram", address: get("instagram").slice(0, 300), address_original: get("instagram"), source: "planilla" });
    if (get("argenprop")) contacts.push({ channel: "other", address: get("argenprop").slice(0, 300), address_original: get("argenprop"), source: "Argenprop" });

    return {
      row_number,
      source_key,
      name,
      website,
      sdr: get("sdr") || null,
      campaign: get("campaign") || null,
      priority: get("priority") || null,
      score,
      score_components,
      zone: get("zone") || null,
      address: get("address") || null,
      decision_maker: get("decision_maker") || null,
      notes: get("notes") || null,
      legacy_status,
      sent_date,
      contacts,
      raw,
      messages,
      error,
    };
  });
}

export type ExistingAgency = { id: string; name: string; website: string | null; account_id: string | null; source: string | null; source_key: string | null };

export type PreviewRow = ImportRow & {
  action: "create" | "update" | "error";
  /** Existing agency that looks like the same one (name or web domain): the team decides. */
  suggestion: { agencyId: string; name: string; reason: string; hasAccount: boolean } | null;
  duplicates: string[];
};

/** Within-file duplicate candidates and matches against the existing base. Never merges. */
export function preview(rows: ImportRow[], source: string, existing: ExistingAgency[]): PreviewRow[] {
  const bySourceKey = new Map(existing.filter((e) => e.source === source && e.source_key).map((e) => [e.source_key!, e]));
  const byName = new Map(existing.map((e) => [slug(e.name), e]));
  const byDomain = new Map(existing.filter((e) => e.website && domain(e.website)).map((e) => [domain(e.website!)!, e]));
  const seen = { domain: new Map<string, number>(), phone: new Map<string, number>(), email: new Map<string, number>() };
  return rows.map((r) => {
    const duplicates: string[] = [];
    const d = r.website ? domain(r.website) : null;
    const note = (kind: keyof typeof seen, key: string | null | undefined, label: string) => {
      if (!key) return;
      const prev = seen[kind].get(key);
      if (prev) duplicates.push(`Posible duplicado de la fila ${prev} (${label})`);
      else seen[kind].set(key, r.row_number);
    };
    note("domain", d, "mismo dominio web");
    for (const c of r.contacts) {
      if (c.channel === "whatsapp") note("phone", c.address, "mismo WhatsApp");
      if (c.channel === "email" && c.address && !GENERIC_MAILBOX.test(c.address)) note("email", c.address, "mismo email");
    }
    if (r.error) return { ...r, action: "error", suggestion: null, duplicates };
    if (bySourceKey.has(r.source_key)) return { ...r, action: "update", suggestion: null, duplicates };
    const match = byName.get(slug(r.name)) ?? (d ? byDomain.get(d) : undefined);
    const suggestion = match
      ? { agencyId: match.id, name: match.name, reason: byName.get(slug(r.name)) ? "mismo nombre" : "mismo dominio web", hasAccount: !!match.account_id }
      : null;
    return { ...r, action: "create", suggestion, duplicates };
  });
}
