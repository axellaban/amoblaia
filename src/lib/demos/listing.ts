// Reads a property listing on an agency's website (the "ficha") so a demo can
// be created from its URL alone: title, location, description, agency and
// photos. parseListing is pure and covered by tests; fetchPublic downloads
// only from public internet addresses.
import "server-only";
import { HttpError } from "@/lib/commerce/http";
import { analyzeListing, type ReadMeta } from "@/lib/listings/analyze";
import { decodeHtml } from "@/lib/listings/charset";
import { FetchFailure, publicAddress, safeFetch, type FetchErrorCode } from "@/lib/listings/fetch";
import { renderProvider } from "@/lib/listings/render";
import { cleanText, cleanUrl } from "./shared";
import { toDemo, type ImportedDemo } from "./import";

export { publicAddress };
export const MAX_LISTING_PHOTOS = 30;

export type Listing = {
  title: string;
  location: string | null;
  description: string | null;
  /** The longest description block on the page, as published (up to 6000 characters). */
  fullDescription: string | null;
  /** Every amount the page shows, in order and without repeats (extras and fees included). */
  prices: string[];
  /** Amounts inside the page's price elements only. */
  headlinePrices: string[];
  listingUrl: string;
  agency: { name: string; website: string };
  images: string[];
};

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  aacute: "á",
  eacute: "é",
  iacute: "í",
  oacute: "ó",
  uacute: "ú",
  ntilde: "ñ",
  Aacute: "Á",
  Eacute: "É",
  Iacute: "Í",
  Oacute: "Ó",
  Uacute: "Ú",
  Ntilde: "Ñ",
  uuml: "ü",
  deg: "°",
  sup2: "²",
};
export function decodeEntities(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (all, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : all;
    }
    return ENTITIES[code] ?? all;
  });
}
const stripTags = (html: string) =>
  decodeEntities(html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " "));

/** Attributes of every tag with this name, as lower-case keys and decoded values. */
function tags(html: string, name: string) {
  const out: Record<string, string>[] = [];
  const re = new RegExp(`<${name}\\b([^>]*)>`, "gi");
  for (const m of html.matchAll(re)) {
    const attrs: Record<string, string> = {};
    for (const a of m[1].matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g))
      attrs[a[1].toLowerCase()] = decodeEntities(a[3] ?? a[4] ?? a[5] ?? "");
    out.push(attrs);
  }
  return out;
}

function metaValues(html: string, ...keys: string[]) {
  const values: string[] = [];
  for (const m of tags(html, "meta")) {
    const key = (m.property || m.name || m.itemprop || "").toLowerCase();
    if (keys.includes(key) && m.content?.trim()) values.push(m.content.trim());
  }
  return values;
}

/** Every object found in the JSON-LD blocks, flattening @graph and arrays. */
function jsonLd(html: string) {
  const found: Record<string, unknown>[] = [];
  const visit = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      found.push(o);
      if (o["@graph"]) visit(o["@graph"]);
      for (const k of ["mainEntity", "itemOffered", "offers", "about"]) if (o[k]) visit(o[k]);
    }
  };
  for (const m of html.matchAll(
    /<script[^>]+type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      visit(JSON.parse(m[1].trim()));
    } catch {
      // Malformed blocks are common; the other sources still apply.
    }
  }
  return found;
}
const types = (o: Record<string, unknown>) =>
  ([] as unknown[]).concat(o["@type"] ?? []).map((t) => String(t).toLowerCase());
const AGENCY_TYPES = ["realestateagent", "organization", "localbusiness", "website"];

function ldImages(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(ldImages);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return ldImages(o.contentUrl ?? o.url);
  }
  return [];
}
function ldAddress(v: unknown) {
  if (typeof v === "string") return v;
  if (!v || typeof v !== "object") return null;
  const a = v as Record<string, unknown>;
  const parts = [a.streetAddress, a.addressLocality, a.addressRegion]
    .filter((p): p is string => typeof p === "string" && Boolean(p.trim()))
    .map((p) => p.trim());
  return parts.length ? [...new Set(parts)].join(", ") : null;
}

/** Pictures that are part of the site, not of the property. */
const NOT_A_PHOTO =
  /(^|[/_.-])(logos?|icons?|favicons?|sprites?|avatars?|banners?|placeholder|loading|spinner|whatsapp|facebook|instagram|twitter|youtube|tiktok|linkedin|flags?|markers?|pins?|maps?|emoji|badges?|watermark|qr|blank|pixel)(?=[/_.-]|\d|$)/i;
const PHOTO_EXTENSION = /\.(jpe?g|png|webp|avif)(\?|#|$)/i;

function absolute(src: string, base: string) {
  try {
    const url = new URL(src.trim(), base);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}
/** The largest candidate of a srcset. */
function largest(srcset: string) {
  let best = "";
  let bestSize = -1;
  for (const part of srcset.split(",")) {
    const [src, size = "1x"] = part.trim().split(/\s+/);
    const n = parseFloat(size) * (size.endsWith("x") ? 1000 : 1);
    if (src && n > bestSize) [best, bestSize] = [src, n];
  }
  return best;
}

/** Tokko Broker (common among Argentine agencies) serves "_thumb" copies next to the full photo. */
const fullSize = (url: string) => url.replace(/_thumb(\.\w+)(\?|$)/i, "$1$2");
/** Resized copies (WordPress "-300x200", "_small"…) share the key of the original. */
const SIZED = /[-_](\d{2,4}x\d{2,4}|thumb|small|medium|large|scaled)(?=\.\w+$)/i;
const photoKey = (url: string) => url.replace(/[?#].*$/, "").replace(SIZED, "").toLowerCase();

function siteName(host: string) {
  const base = host.replace(/^www\./, "").split(".")[0];
  const spaced = base.replace(/[-_]+/g, " ").replace(/(inmobiliaria|propiedades)/gi, " $1 ");
  return spaced
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/** Removes " | Agency" or " - Agency" suffixes (or a "Agency :: " prefix) that sites add to every title. */
function trimTitle(title: string, agency: string) {
  if (title.includes("::")) title = title.split("::").slice(1).join("::").trim() || title;
  const parts = title.split(/\s+[|–—-]\s+/);
  if (parts.length > 1) {
    const kept = parts.filter((p) => p.toLowerCase() !== agency.toLowerCase());
    if (kept.length && kept.length < parts.length) return kept.join(" - ");
    if (parts[0].length >= 12) return parts[0];
  }
  return title;
}

/** Text of an element, keeping its paragraphs and line breaks. */
const blockText = (html: string) =>
  decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h\d)>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "\n- ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** Inner HTML of every element whose id or class mentions one of the words (no nesting tricks: good enough for listings). */
function blocksNamed(html: string, words: RegExp) {
  const out: string[] = [];
  const open = /<(div|section|p|span|article|ul|h\d)\b([^>]*)>/gi;
  for (const m of html.matchAll(open)) {
    const attrs = m[2];
    const name = /\b(?:id|class)\s*=\s*("[^"]*"|'[^']*')/gi;
    if (![...attrs.matchAll(name)].some((a) => words.test(a[1]))) continue;
    const tag = m[1].toLowerCase();
    const start = (m.index ?? 0) + m[0].length;
    // The matching close tag, counting nested tags of the same name.
    let depth = 1;
    let end = html.length;
    for (const t of html.slice(start).matchAll(new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi"))) {
      depth += t[1] ? -1 : 1;
      if (!depth) {
        end = start + (t.index ?? 0);
        break;
      }
    }
    out.push(html.slice(start, end));
  }
  return out;
}

const MONEY = /(USD|U\$S|US\$|\$)\s?(\d{1,3}(?:[.,]\d{3})+|\d{4,})(?![\d.,]*\d)/gi;
/** Amounts as published ("$ 1.100.000", "USD 95.000"), without repeats. */
export function moneyMentions(text: string) {
  const seen = new Map<string, string>();
  for (const m of text.matchAll(MONEY)) {
    const currency = /^\$$/.test(m[1]) ? "$" : "USD";
    const amount = m[2].replace(/[.,]/g, "");
    const key = `${currency}${amount}`;
    if (!seen.has(key)) seen.set(key, `${currency} ${Number(amount).toLocaleString("es-AR")}`);
  }
  return [...seen.values()];
}

export function parseListing(html: string, pageUrl: string): Listing {
  const page = new URL(pageUrl);
  const ld = jsonLd(html);
  const property = ld.find(
    (o) =>
      !types(o).some((t) => AGENCY_TYPES.includes(t)) &&
      (o.image || o.address || o.floorSize || o.numberOfRooms),
  );
  const agencyLd = ld.find((o) => types(o).some((t) => t === "realestateagent")) ??
    ld.find((o) => types(o).some((t) => t === "organization" || t === "localbusiness"));
  const agencyName =
    cleanText(metaValues(html, "og:site_name")[0], 120) ||
    cleanText(typeof agencyLd?.name === "string" ? agencyLd.name : null, 120) ||
    siteName(page.hostname);

  const pageTitle = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const rawTitle =
    (typeof property?.name === "string" && property.name) ||
    metaValues(html, "og:title", "twitter:title")[0] ||
    (h1 && stripTags(h1)) ||
    (pageTitle && stripTags(pageTitle)) ||
    "";
  const title =
    cleanText(trimTitle(decodeEntities(rawTitle).replace(/\s+/g, " ").trim(), agencyName), 160) ||
    "Propiedad";

  const rawDescription =
    (typeof property?.description === "string" && property.description) ||
    metaValues(html, "og:description", "description", "twitter:description")[0] ||
    null;
  const description = rawDescription
    ? cleanText(stripTags(rawDescription).replace(/\n{3,}/g, "\n\n"), 1000, true)
    : null;

  const location = cleanText(
    ldAddress(property?.address) ??
      metaValues(
        html,
        "og:street-address",
        "og:locality",
        "place:location:address",
        "geo.placename",
      )[0] ??
      null,
    160,
  );

  const candidates = [
    ...ldImages(property?.image),
    ...metaValues(html, "og:image", "og:image:url", "og:image:secure_url", "twitter:image"),
  ];
  for (const img of tags(html, "img")) {
    const src =
      img["data-zoom-image"] ||
      img["data-full"] ||
      img["data-large"] ||
      img["data-lazy-src"] ||
      img["data-original"] ||
      img["data-src"] ||
      (img["data-srcset"] && largest(img["data-srcset"])) ||
      (img.srcset && largest(img.srcset)) ||
      img.src;
    const w = Number(img.width || 0);
    const h = Number(img.height || 0);
    if (!src || (w && w < 300) || (h && h < 200)) continue;
    candidates.push(src);
  }
  // Galleries often link each thumbnail to the full picture.
  for (const a of tags(html, "a")) if (a.href && PHOTO_EXTENSION.test(a.href)) candidates.push(a.href);
  for (const s of tags(html, "source")) if (s.srcset) candidates.push(largest(s.srcset));
  // Background images and JSON blobs in scripts (SPA galleries).
  // Tags already read above are left out, so their thumbnails and small variants stay skipped.
  const rest = html.replace(/<(img|source|a)\b[^>]*>/gi, " ");
  for (const m of rest.matchAll(/https?:\\?\/\\?\/[^"'\s()<>]+?\.(?:jpe?g|png|webp)(?:\?[^"'\s()<>]*)?/gi))
    candidates.push(m[0].replace(/\\\//g, "/"));

  const seen = new Map<string, number>();
  const images: string[] = [];
  for (const raw of candidates) {
    const url = absolute(raw, page.toString());
    if (!url || /^data:/i.test(raw) || /\.(svg|gif|ico)(\?|$)/i.test(url)) continue;
    const full = fullSize(url);
    if (NOT_A_PHOTO.test(new URL(full).pathname)) continue;
    const key = photoKey(full);
    const at = seen.get(key);
    if (at !== undefined) {
      // The original wins over a resized copy found first.
      if (SIZED.test(new URL(images[at]).pathname) && !SIZED.test(new URL(full).pathname))
        images[at] = full;
      continue;
    }
    if (images.length >= MAX_LISTING_PHOTOS) continue;
    seen.set(key, images.length);
    images.push(full);
  }

  const longest = blocksNamed(html, /descrip/i)
    .map(blockText)
    .sort((a, b) => b.length - a.length)[0];
  const fullDescription = cleanText(
    longest && longest.length > (description?.length ?? 0) ? longest : description,
    6000,
    true,
  );
  const priceText = blocksNamed(html, /(price|precio|valor)/i).map(blockText).join("\n");
  const prices = moneyMentions(`${priceText}\n${title}\n${fullDescription ?? ""}`);
  const headlinePrices = moneyMentions(priceText);

  return {
    title,
    location,
    description,
    fullDescription,
    prices,
    headlinePrices,
    listingUrl: page.toString(),
    agency: { name: agencyName, website: `${page.protocol}//${page.host}/` },
    images,
  };
}

/** What the visitor reads when a fetch fails: actionable, without technical detail. */
const PAGE_ERRORS: Record<FetchErrorCode, [number, string]> = {
  invalid_url: [400, "Usá la dirección pública de la publicación (http o https)."],
  not_public: [400, "Esa dirección no es un sitio público."],
  dns: [400, "No encontramos ese sitio. Revisá la URL."],
  network: [502, "No pudimos abrir la publicación."],
  timeout: [504, "La publicación tardó demasiado en responder. Probá de nuevo en un rato o cargá las fotos a mano."],
  too_large: [413, "La página es demasiado grande."],
  too_many_redirects: [502, "La publicación redirige demasiadas veces."],
  blocked: [502, "El sitio de la inmobiliaria no deja leer la publicación desde nuestros servidores. Probá con el enlace de la misma propiedad en Zonaprop o Argenprop, o cargá las fotos a mano."],
  challenge: [502, "El sitio pide una verificación anti-robots que no salteamos. Probá con el enlace de la misma propiedad en Zonaprop o Argenprop, o cargá las fotos a mano."],
  http_error: [502, "La publicación respondió con un error. Revisá la URL."],
};

/** The failure as the API answers it, keeping the code for diagnostics and analytics. */
export class ListingFetchError extends HttpError {
  constructor(
    readonly code: FetchErrorCode,
    readonly upstreamStatus: number | null,
    kind: "page" | "image",
  ) {
    const [status, message] = kind === "page" ? PAGE_ERRORS[code] : code === "too_large" ? [413, "La foto es demasiado grande."] : PAGE_ERRORS[code][0] === 400 ? PAGE_ERRORS[code] : [502, "No pudimos descargar la foto."];
    super(status, code === "http_error" && kind === "page" && upstreamStatus ? `La publicación respondió con error ${upstreamStatus}. Revisá la URL.` : message);
  }
}

/** GET from the public internet only (see safeFetch: checked on connect, redirects re-checked, size and time caps). */
export async function fetchPublic(raw: string, kind: "page" | "image") {
  try {
    const res = await safeFetch(raw, kind);
    return { url: res.url, type: res.type, body: res.body, durationMs: res.durationMs };
  } catch (e) {
    if (e instanceof FetchFailure) throw new ListingFetchError(e.code, e.status, kind);
    throw e;
  }
}

/** A page drawn by JavaScript: almost no text, no title and no photos in the HTML. */
export function looksEmpty(html: string) {
  const text = html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text.length < 200 && !/<h1\b/i.test(html) && !/og:image/i.test(html);
}

/**
 * Everything the demo needs from the listing page, with the state of each
 * field and how it was read. The platform's template wins, then JSON-LD,
 * then the generic reading (Open Graph, labels, photos anywhere on the page),
 * which only fills what the others could not find.
 */
export function importListing(html: string, pageUrl: string, meta: ReadMeta = { strategy: "direct_http" }): ImportedDemo {
  const listing = parseListing(html, pageUrl);
  const { details, diagnostics } = analyzeListing(html, pageUrl, meta, {
    title: listing.title,
    images: listing.images,
    agencyName: listing.agency.name,
  });
  return toDemo(
    details,
    {
      title: listing.title,
      location: listing.location,
      description: listing.fullDescription ?? listing.description,
      prices: listing.headlinePrices,
      images: listing.images,
      agencyName: listing.agency.name,
      website: listing.agency.website,
    },
    diagnostics,
  );
}

/**
 * Reads the page: a direct request first; when the site refuses it (403/503,
 * bot check), times out or only sends an empty shell drawn by JavaScript, the
 * render provider if one is configured and approved. Without one, the
 * failure says what happened and offers the manual or portal alternative.
 */
async function readPage(address: string): Promise<{ html: string; url: string; meta: ReadMeta }> {
  const provider = renderProvider();
  let direct: Awaited<ReturnType<typeof fetchPublic>> | null = null;
  let failure: ListingFetchError | null = null;
  try {
    direct = await fetchPublic(address, "page");
  } catch (e) {
    if (!(e instanceof ListingFetchError)) throw e;
    failure = e;
  }
  if (direct) {
    if (direct.type && !/html|xml/i.test(direct.type))
      throw new HttpError(400, "Esa URL no es una página web. Pegá la URL de la ficha.");
    const { text, charset } = decodeHtml(direct.body, direct.type);
    if (!provider || !looksEmpty(text))
      return { html: text, url: direct.url, meta: { strategy: "direct_http", durationMs: direct.durationMs, charset } };
  }
  const retry = !failure || ["blocked", "challenge", "timeout", "http_error"].includes(failure.code);
  if (provider && retry) {
    const started = Date.now();
    // Only addresses that pass the same public-internet check are handed to the provider.
    const checked = new URL(direct?.url ?? address);
    const rendered = await provider.render(checked, { timeoutMs: 45000 }).catch(() => null);
    if (rendered && rendered.status >= 200 && rendered.status < 300 && rendered.html)
      return { html: rendered.html, url: checked.toString(), meta: { strategy: "render_provider", provider: provider.id, durationMs: Date.now() - started, charset: "utf-8" } };
  }
  if (failure) throw failure;
  throw new HttpError(422, "La publicación se arma con JavaScript y no trae los datos en la página. Cargá las fotos a mano o usá el enlace de Zonaprop o Argenprop.");
}

export async function readListing(raw: unknown) {
  const address = cleanUrl(raw);
  if (!address) throw new HttpError(400, "Pegá la URL de la ficha de la propiedad.");
  const page = await readPage(address);
  const listing = parseListing(page.html, page.url);
  // Keep the address the admin pasted (the redirect target may be a tracking URL).
  return { ...listing, listingUrl: address, imported: importListing(page.html, page.url, page.meta) };
}
