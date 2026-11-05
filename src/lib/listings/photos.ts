// Which pictures of a listing page are the property's own photos. Shared by
// every reading of the page (the platform's template, the generic reading and
// parseListing), so a map tile or another listing's thumbnail never reaches
// the preview, whichever source found it. Pure: no network.

/** A map URL template ({s}.tile…/{z}/{x}/{y}.png), raw or percent-encoded: never an image that loads. */
const TEMPLATE = /\{[sxyz]\}|%7B[sxyz]%7D/i;

/** Hosts (and paths) that serve map tiles or rendered maps, not photos of the property. */
const MAP_SOURCES: [RegExp, RegExp?][] = [
  [/(^|\.)tile\.(openstreetmap|osm)\.[a-z.]+$/i],
  [/(^|\.)tiles?\.openstreetmap\.[a-z.]+$/i],
  [/(^|\.)tile\.osm\.org$/i],
  [/(^|\.)tiles?\.mapbox\.com$/i],
  [/^api\.mapbox\.com$/i, /^\/(styles|v4)\//i],
  [/(^|\.)basemaps\.cartocdn\.com$/i],
  [/(^|\.)tile\.thunderforest\.com$/i],
  [/(^|\.)tiles\.stadiamaps\.com$/i],
  [/(^|\.)arcgisonline\.com$/i, /\/tile\//i],
  [/^maps\.gstatic\.com$/i],
  [/^mts?\d*\.google(apis)?\.com$/i, /^\/(vt|maps\/vt)/i],
  [/^maps\.googleapis\.com$/i, /^\/maps\/api\/staticmap/i],
];

/** Not a photo: a map template or a tile/rendered map from a map provider. */
export function isMapImage(src: string) {
  if (TEMPLATE.test(src)) return true;
  try {
    const u = new URL(src);
    return MAP_SOURCES.some(([host, path]) => host.test(u.hostname) && (!path || path.test(u.pathname)));
  } catch {
    return true;
  }
}

/**
 * Numbers in the listing's own address that may name its photos: the code in
 * the path (/p/8634397-…, /propiedad/239169_…) or the query (?codigo=7674).
 */
export function listingCodes(pageUrl: string) {
  try {
    const u = new URL(pageUrl);
    const parts = [u.pathname, ...u.searchParams.values()];
    const codes = new Set<string>();
    for (const p of parts) for (const m of p.matchAll(/(?<!\d)\d{3,12}(?!\d)/g)) codes.add(m[0]);
    return [...codes];
  } catch {
    return [];
  }
}

const segments = (src: string) => {
  try {
    return decodeURIComponent(new URL(src).pathname).split("/");
  } catch {
    return [];
  }
};
/** "7674_2026….webp" → "7674": the code a file name starts with. */
const fileCode = (src: string) => segments(src).pop()?.match(/^(\d{3,12})[_-]/)?.[1] ?? null;

/**
 * When most photos are named after the listing's code (7674_….webp) or live
 * in its folder (/fotos/920/…), the ones named after another code (5642_….jpg)
 * belong to other listings of the same site and are left out. Photos without
 * a code in that place are kept: nothing is decided for sites that do not
 * name their files this way.
 */
export function keepOwnCode(images: string[], pageUrl: string) {
  if (images.length < 3) return images;
  for (const code of listingCodes(pageUrl)) {
    const byFile = images.filter((s) => fileCode(s) === code).length;
    if (byFile >= 2 && byFile * 2 > images.length)
      return images.filter((s) => {
        const c = fileCode(s);
        return c === null || c === code;
      });
    const sample = images.find((s) => segments(s).slice(0, -1).includes(code));
    if (!sample) continue;
    const at = segments(sample).indexOf(code);
    const inFolder = images.filter((s) => segments(s)[at] === code).length;
    if (inFolder >= 2 && inFolder * 2 > images.length)
      return images.filter((s) => {
        const seg = segments(s)[at];
        return seg === code || !/^\d{3,12}$/.test(seg ?? "");
      });
  }
  return images;
}

/** The property's own photos among those found: no maps, no other listing's files. */
export function ownPhotos(images: string[], pageUrl: string) {
  return keepOwnCode(
    images.filter((s) => !isMapImage(s)),
    pageUrl,
  );
}

/**
 * Class or id of a block that lists other properties. Whole words only:
 * "label-featured" (a badge on the property itself) is not a list of others,
 * so "destacada/featured" only counts as a section heading.
 */
const OTHERS_BLOCK = /(^|[\s_-])(related|relacionad[oa]s?|similar|similares|otras[-_]propiedades|te[-_]puede[-_]interesar|recomendad[oa]s)(?=[\s_-]|$)/i;
/** A heading that opens the list of other properties ("Ventas Relacionadas", "Te puede interesar"). */
const OTHERS_HEADING =
  /^(?:(?:ventas|alquileres|propiedades|inmuebles|avisos)\s+)?(relacionad[oa]s|similares|propiedades similares|te puede interesar|tambi[eé]n te puede(?:n)? interesar|otras propiedades|propiedades destacadas|destacadas|recomendad[oa]s|propiedades relacionadas|propiedades recomendadas)\b/i;

/** Removes every element whose class or id names a list of other properties (counting nested tags of the same name). */
export function withoutOtherBlocks(html: string) {
  let out = html;
  for (let guard = 0; guard < 20; guard++) {
    let found: { start: number; end: number } | null = null;
    for (const m of out.matchAll(/<(div|section|aside|ul|ol|article|nav)\b([^>]*)>/gi)) {
      const named = [...m[2].matchAll(/\b(?:id|class)\s*=\s*("([^"]*)"|'([^']*)')/gi)].some((a) => OTHERS_BLOCK.test(a[2] ?? a[3] ?? ""));
      if (!named) continue;
      const tag = m[1].toLowerCase();
      const start = m.index ?? 0;
      const from = start + m[0].length;
      let depth = 1;
      let end = out.length;
      for (const t of out.slice(from).matchAll(new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi"))) {
        depth += t[1] ? -1 : 1;
        if (!depth) {
          end = from + (t.index ?? 0) + t[0].length;
          break;
        }
      }
      found = { start, end };
      break;
    }
    if (!found) return out;
    out = out.slice(0, found.start) + out.slice(found.end);
  }
  return out;
}

/** Where a heading opens the list of other properties, or -1. */
export function otherListingsAt(html: string) {
  for (const m of html.matchAll(/<h[1-6]\b[^>]*>([\s\S]{0,300}?)<\/h[1-6]>/gi)) {
    const text = m[1].replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
    if (OTHERS_HEADING.test(text)) return m.index ?? -1;
  }
  return -1;
}

/** The page without the blocks of other properties, and cut where their heading starts. */
export function propertyPart(html: string) {
  const blocks = withoutOtherBlocks(html);
  const at = otherListingsAt(blocks);
  return { withoutBlocks: blocks, own: at >= 0 ? blocks.slice(0, at) : blocks };
}
