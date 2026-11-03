// One reading of a listing page from three sources, most specific first:
// the platform's template, the page's JSON-LD, then the generic reading
// (labels, headings, Open Graph). A less specific source only fills what the
// others did not find; when they disagree on price or location the more
// specific value is kept and the disagreement is noted for the preview.
// Pure: no network.
import { extractDetails, norm, type ListingDetails, type Money } from "@/lib/demos/listing-details";
import { detectPlatform, extractPlatform, ownPart, templatePairs, tidyCaps } from "./platforms";
import { extractStructured } from "./structured";
import { PLATFORM_NAMES, type Extracted, type ImportDiagnostics, type Strategy } from "./types";

export type ReadMeta = { strategy: Strategy; provider?: string | null; durationMs?: number | null; charset?: string | null };

/** Titles written in capitals ("CASA DE 4 AMBIENTES…") read as a sentence. */
export function sentenceCase(title: string) {
  const letters = title.replace(/[^\p{L}]/gu, "");
  if (letters.length < 6 || letters !== letters.toUpperCase()) return title;
  const lower = title.toLowerCase();
  return lower.replace(/^(\P{L}*)(\p{L})/u, (_m, a: string, b: string) => a + b.toUpperCase());
}

/** "Agency :: Title", "Agency - Title" (Tokko) or "Title | Agency": the property's part only. */
export function cleanTitle(title: string, agency: string | null) {
  let t = title.replace(/\s+/g, " ").trim();
  if (t.includes("::")) t = t.split("::").slice(1).join("::").trim() || t;
  if (agency) {
    const a = norm(agency);
    const parts = t.split(/\s+[|–—]\s+|\s+-\s+/);
    const kept = parts.filter((p) => norm(p) !== a);
    if (kept.length && kept.length < parts.length) t = kept.join(" - ");
  }
  return sentenceCase(t);
}

const meta_title = (html: string) =>
  (html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']*)["']/i)?.[1] ?? "").trim();
const looksLikeDomain = (name: string | null | undefined) => Boolean(name && /^[\w-]+(\.[\w-]+)+$/.test(name.trim()));
const same = (a: Money | null | undefined, b: Money | null | undefined) => Boolean(a && b && a.amount === b.amount && a.currency === b.currency);

type Source = "platform" | "structured" | "generic";
function pick<T>(values: [Source, T | null | undefined][]): [Source, T] | null {
  for (const [s, v] of values) if (v !== null && v !== undefined && (typeof v !== "string" || v.trim())) return [s, v];
  return null;
}

/**
 * The listing's details with every source merged, and how they were found.
 * `fallbackTitle` and `fallbackImages` come from the generic page reading
 * (Open Graph, photos anywhere on the page) and are the last resort.
 */
export function analyzeListing(
  html: string,
  pageUrl: string,
  meta: ReadMeta,
  fallback: { title: string; images: string[]; agencyName: string },
): { details: ListingDetails; diagnostics: ImportDiagnostics } {
  const generic = extractDetails(html, pageUrl);
  const { platform } = detectPlatform(html, pageUrl);
  const p: Extracted = extractPlatform(platform, html, pageUrl);
  const s = extractStructured(html);
  const conflicts: string[] = [];
  const notes: string[] = [];
  const sources: ImportDiagnostics["sources"] = {};

  // Price: a "$" on the page with the same amount declared in USD in JSON-LD is in dollars.
  let genericPrice = generic.price;
  if (genericPrice && s.price && genericPrice.amount === s.price.amount && genericPrice.currency !== s.price.currency) {
    notes.push(`La página muestra el precio con «$» y declara ${s.price.currency === "USD" ? "dólares" : "pesos"}: se usa ${s.price.text}.`);
    genericPrice = s.price;
  }
  const price = pick<Money>([["platform", p.price], ["structured", s.price], ["generic", genericPrice]]);
  if (price) {
    sources.price = price[0];
    for (const [name, other] of [["datos estructurados", s.price], ["lectura genérica", genericPrice]] as const)
      if (other && !same(other, price[1])) conflicts.push(`Precio: ${price[1].text} en la plantilla, ${other.text} en ${name}.`);
  }
  const priceOnRequest = !price && Boolean(p.priceOnRequest || /\b(consultar precio|precio a consultar|consulte precio)\b/i.test(ownPart(html).replace(/<[^>]+>/g, " ")));

  // Tokko's generic reading takes the agency from "Agency - Title"; a template whose title ends with the agency gives the title instead.
  const genericAgency = generic.agency.name && !looksLikeDomain(generic.agency.name) && norm(generic.agency.name) !== norm(meta_title(html)) ? generic.agency.name : null;
  const agency = pick<string>([["platform", p.agencyName], ["structured", s.agencyName], ["generic", genericAgency], ["generic", fallback.agencyName]]);
  const agencyName = agency && !looksLikeDomain(agency[1]) ? tidyCaps(agency[1]) : null;

  const title = pick<string>([["platform", p.title], ["generic", generic.shortTitle], ["structured", s.title], ["generic", fallback.title]]);
  if (title) sources.title = title[0];
  const location = pick<string>([["platform", p.location], ["structured", s.location], ["generic", generic.location]]);
  if (location) {
    sources.location = location[0];
    if (location[0] === "platform" && s.location && !norm(location[1]).includes(norm(s.location).split(",")[0]))
      conflicts.push(`Ubicación: «${location[1]}» en la plantilla, «${s.location}» en datos estructurados.`);
  }
  // "Estado de la propiedad: Venta" (Houzez), "Tipo de negocio: Venta" (Wasi).
  const opPair = [...(p.pairs ?? []), ...templatePairs(html), ...generic.pairs].find(
    (x) => /^(operacion|tipo de operacion|estado de la propiedad|tipo de negocio|status)$/.test(norm(x.label)) && /^(venta|alquiler)/i.test(x.value.trim()),
  );
  const operation = pick<string>([["platform", p.operation], ["generic", generic.operation], ["generic", opPair?.value.trim() ?? null]]);
  if (operation) sources.operation = operation[0];
  const description = pick<string>([["platform", p.description], ["generic", generic.description], ["structured", s.description]]);
  if (description) sources.description = description[0];
  const images = pick<string[]>([
    ["platform", p.images?.length ? p.images : null],
    ["generic", generic.images.length ? generic.images : null],
    ["structured", s.images?.length ? s.images : null],
    ["generic", fallback.images.length ? fallback.images : null],
  ]);
  if (images) sources.images = images[0];

  const details: ListingDetails = {
    ...generic,
    shortTitle: title ? cleanTitle(title[1], agencyName) : generic.shortTitle,
    location: location?.[1] ?? null,
    price: price?.[1] ?? null,
    // A conflict inside the page's own text (header vs description) stays the generic reading's.
    priceConflict: price && generic.price && same(price[1], generic.price) ? generic.priceConflict : null,
    priceOptions: price && generic.price && same(price[1], generic.price) ? generic.priceOptions : [],
    operation: operation?.[1] ?? null,
    propertyKind: p.propertyKind ?? generic.propertyKind,
    reference: p.reference ?? generic.reference,
    description: description?.[1] ?? null,
    // First match per label wins in toDemo: the template's and JSON-LD's labels come first.
    pairs: [...(p.pairs ?? []), ...templatePairs(html), ...(s.pairs ?? []), ...generic.pairs],
    images: images?.[1] ?? [],
    agency: { ...generic.agency, name: agencyName },
  };

  const missing = [
    !details.price && !priceOnRequest && "precio",
    !details.location && "ubicación",
    !details.description && "descripción",
    !details.images.length && "fotos",
    !details.operation && "operación",
  ].filter((x): x is string => Boolean(x));
  if (priceOnRequest) notes.push("La publicación dice «Consultar precio».");

  return {
    details,
    diagnostics: {
      platform,
      platformName: PLATFORM_NAMES[platform],
      strategy: meta.strategy,
      provider: meta.provider ?? null,
      durationMs: meta.durationMs ?? null,
      charset: meta.charset ?? null,
      photosFound: details.images.length,
      sources,
      missing,
      conflicts,
      priceStatus: details.price ? "published" : priceOnRequest ? "on_request" : "not_found",
      notes,
    },
  };
}
