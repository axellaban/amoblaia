// Possible duplicates of an agency about to be created: the same site, the
// same contact e-mail or the same name once the generic words are left out
// ("Inmobiliaria", "Propiedades", "S.A."…). They are shown to the team to
// decide; nothing is ever merged. Pure: covered by tests, shared with the
// browser.

const GENERIC = new Set([
  "inmobiliaria",
  "inmobiliarias",
  "propiedades",
  "propiedad",
  "bienes",
  "raices",
  "negocios",
  "servicios",
  "inmobiliarios",
  "inmobiliario",
  "estudio",
  "grupo",
  "real",
  "estate",
  "sa",
  "srl",
  "sas",
  "y",
  "de",
  "del",
  "la",
  "las",
  "los",
  "el",
]);

/** "GM Servicios Inmobiliarios S.R.L." → "gm". Empty when only generic words remain. */
export function nameKey(name: string) {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " y ")
    // "S.R.L." and "S.A." read as one word.
    .replace(/\./g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !GENERIC.has(w))
    .join(" ");
}

/** "https://www.Sur.com.ar/propiedades" → "sur.com.ar"; null for nothing or something that is not an address. */
export function siteKey(website: string | null | undefined) {
  if (!website?.trim()) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(website.trim()) ? website.trim() : `https://${website.trim()}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return host.includes(".") ? host : null;
  } catch {
    return null;
  }
}

export type DuplicateCandidate = { id: string; name: string; website: string | null; contact_email?: string | null };
export type DuplicateMatch = { id: string; name: string; website: string | null; reasons: ("nombre" | "sitio" | "email")[] };

/** Agencies that may be the same one, with why; the newest list wins ties (input order is kept). */
export function findDuplicates(
  input: { name: string; website?: string | null; contactEmail?: string | null },
  agencies: DuplicateCandidate[],
  limit = 5,
): DuplicateMatch[] {
  const name = nameKey(input.name);
  const site = siteKey(input.website);
  const email = input.contactEmail?.trim().toLowerCase() || null;
  const out: DuplicateMatch[] = [];
  for (const a of agencies) {
    const reasons: DuplicateMatch["reasons"] = [];
    const other = nameKey(a.name);
    if (name && other && (name === other || (name.length >= 4 && other.length >= 4 && (other.includes(name) || name.includes(other)))))
      reasons.push("nombre");
    if (site && siteKey(a.website) === site) reasons.push("sitio");
    if (email && a.contact_email?.trim().toLowerCase() === email) reasons.push("email");
    if (reasons.length) out.push({ id: a.id, name: a.name, website: a.website, reasons });
    if (out.length >= limit) break;
  }
  return out;
}

export const REASON_LABEL: Record<DuplicateMatch["reasons"][number], string> = {
  nombre: "nombre parecido",
  sitio: "mismo sitio web",
  email: "mismo email de contacto",
};
