// Reads a property listing on an agency's website (the "ficha") so a demo can
// be created from its URL alone: title, location, description, agency and
// photos. parseListing is pure and covered by tests; fetchPublic downloads
// only from public internet addresses.
import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { HttpError } from "@/lib/commerce/http";
import { cleanText, cleanUrl } from "./shared";

export const MAX_LISTING_PHOTOS = 30;
const MAX_HTML_BYTES = 3 * 1024 * 1024;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const USER_AGENT =
  "Mozilla/5.0 (compatible; amoblaIA-demos/1.0; +https://amoblaia.vercel.app)";

export type Listing = {
  title: string;
  location: string | null;
  description: string | null;
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

/** Removes " | Agency" or " - Agency" suffixes that sites append to every title. */
function trimTitle(title: string, agency: string) {
  const parts = title.split(/\s+[|–—-]\s+/);
  if (parts.length > 1) {
    const kept = parts.filter((p) => p.toLowerCase() !== agency.toLowerCase());
    if (kept.length && kept.length < parts.length) return kept.join(" - ");
    if (parts[0].length >= 12) return parts[0];
  }
  return title;
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

  return {
    title,
    location,
    description,
    listingUrl: page.toString(),
    agency: { name: agencyName, website: `${page.protocol}//${page.host}/` },
    images,
  };
}

/** True for addresses on the public internet; private, local and metadata ranges are refused. */
export function publicAddress(ip: string) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return publicAddress(mapped[1]);
    return !(
      v === "::" ||
      v === "::1" ||
      v.startsWith("fc") ||
      v.startsWith("fd") ||
      v.startsWith("fe8") ||
      v.startsWith("fe9") ||
      v.startsWith("fea") ||
      v.startsWith("feb") ||
      v.startsWith("ff")
    );
  }
  return false;
}

async function assertPublic(url: URL) {
  if (!["http:", "https:"].includes(url.protocol) || (url.port && !["80", "443"].includes(url.port)))
    throw new HttpError(400, "Usá la dirección pública de la publicación (http o https).");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host)
    ? [host]
    : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (!addresses.length) throw new HttpError(400, "No encontramos ese sitio. Revisá la URL.");
  if (!addresses.every(publicAddress))
    throw new HttpError(400, "Esa dirección no es un sitio público.");
}

/** GET from the public internet only, following up to 4 redirects, with a size cap. */
export async function fetchPublic(raw: string, kind: "page" | "image") {
  let url = new URL(raw);
  for (let hop = 0; hop < 5; hop++) {
    await assertPublic(url);
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(kind === "page" ? 15000 : 20000),
      headers: {
        "User-Agent": USER_AGENT,
        Accept: kind === "page" ? "text/html,application/xhtml+xml" : "image/*",
        "Accept-Language": "es-AR,es;q=0.9",
      },
    }).catch(() => {
      throw new HttpError(502, kind === "page" ? "No pudimos abrir la publicación." : "No pudimos descargar la foto.");
    });
    const next = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && next) {
      url = new URL(next, url);
      continue;
    }
    if (!response.ok)
      throw new HttpError(
        502,
        kind === "page"
          ? `La publicación respondió con error ${response.status}. Revisá la URL.`
          : "No pudimos descargar la foto.",
      );
    const max = kind === "page" ? MAX_HTML_BYTES : MAX_IMAGE_BYTES;
    if (Number(response.headers.get("content-length") || 0) > max)
      throw new HttpError(413, kind === "page" ? "La página es demasiado grande." : "La foto es demasiado grande.");
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) {
        await reader.cancel();
        throw new HttpError(413, kind === "page" ? "La página es demasiado grande." : "La foto es demasiado grande.");
      }
      chunks.push(value);
    }
    return { url: url.toString(), type: response.headers.get("content-type") || "", body: Buffer.concat(chunks) };
  }
  throw new HttpError(502, "La publicación redirige demasiadas veces.");
}

export async function readListing(raw: unknown) {
  const address = cleanUrl(raw);
  if (!address) throw new HttpError(400, "Pegá la URL de la ficha de la propiedad.");
  const page = await fetchPublic(address, "page");
  if (page.type && !/html|xml/i.test(page.type))
    throw new HttpError(400, "Esa URL no es una página web. Pegá la URL de la ficha.");
  const listing = parseListing(page.body.toString("utf8"), page.url);
  // Keep the address the admin pasted (the redirect target may be a tracking URL).
  return { ...listing, listingUrl: address };
}
