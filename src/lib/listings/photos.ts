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

/**
 * Pictures a site draws for the visitor, never photos of the property: QR
 * codes and charts ("llevala en tu celular", chart.apis.google.com?cht=qr…).
 */
export function isSiteGraphic(src: string) {
  try {
    const u = new URL(src);
    if (/^(chart\.apis\.google\.com|chart\.googleapis\.com|api\.qrserver\.com|quickchart\.io)$/i.test(u.hostname)) return true;
    return u.searchParams.get("cht") === "qr" || /(^|[/_.-])qr(code)?([/_.-]|$)/i.test(u.pathname);
  } catch {
    return true;
  }
}

/**
 * The address relative links of the page resolve against: its <base href>
 * when it declares one (Bistolfi: <base href="https://www.bistolfi.com.ar/">
 * with photos at "img/propiedades/…"), otherwise the page itself.
 */
export function baseOf(html: string, pageUrl: string) {
  const href = html.match(/<base\b[^>]*\bhref\s*=\s*["']([^"']+)["']/i)?.[1]?.trim();
  if (!href) return pageUrl;
  try {
    const base = new URL(href.replace(/&amp;/g, "&"), pageUrl);
    return ["http:", "https:"].includes(base.protocol) ? base.toString() : pageUrl;
  } catch {
    return pageUrl;
  }
}

/** The same file on the site with or without "www.": one photo, not two. */
export const sameFileKey = (src: string) => {
  try {
    const u = new URL(src);
    return `${u.hostname.toLowerCase().replace(/^www\./, "")}${u.pathname}${u.search}`;
  } catch {
    return src;
  }
};

/**
 * The full picture when the page only links a platform's thumbnail. Mardel
 * Inmueble (Daneff, Analía Verga…) puts in og:image a 400 px copy under
 * /uploads/inmuebles/thumbnails/; the original, in the same folder without
 * "thumbnails/", is the one that can be staged (600 px minimum).
 */
export function fullSizePhoto(src: string) {
  try {
    const u = new URL(src);
    if (/^api\.mardelinmueble\.com$/i.test(u.hostname) && /^\/uploads\/inmuebles\/thumbnails\//i.test(u.pathname)) {
      u.pathname = u.pathname.replace(/\/thumbnails\//i, "/");
      return u.toString();
    }
  } catch {
    // Not an address: left as is (and dropped later).
  }
  return src;
}

/** The property's own photos among those found: no maps, no QR codes, no other listing's files, no repeats. */
export function ownPhotos(images: string[], pageUrl: string) {
  let pageHost = "";
  try {
    pageHost = new URL(pageUrl).hostname.toLowerCase();
  } catch {
    // Kept as found.
  }
  const onPage = (src: string) => {
    try {
      return new URL(src).hostname.toLowerCase() === pageHost;
    } catch {
      return false;
    }
  };
  // In the order first found; of the same file with and without www, the copy on the listing's own host.
  const kept = new Map<string, string>();
  for (const src of images.map(fullSizePhoto)) {
    if (isMapImage(src) || isSiteGraphic(src)) continue;
    const k = sameFileKey(src);
    const prev = kept.get(k);
    if (prev === undefined || (!onPage(prev) && onPage(src))) kept.set(k, src);
  }
  return keepOwnCode([...kept.values()], pageUrl);
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

/** Removes every element (of these tags) that `remove` picks by its attributes, counting nested tags of the same name. */
function removeElements(html: string, tags: string, remove: (attrs: string) => boolean) {
  let out = html;
  for (let guard = 0; guard < 40; guard++) {
    let found: { start: number; end: number } | null = null;
    for (const m of out.matchAll(new RegExp(`<(${tags})\\b([^>]*)>`, "gi"))) {
      if (!remove(m[2])) continue;
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
const named = (attrs: string, words: RegExp) => [...attrs.matchAll(/\b(?:id|class)\s*=\s*("([^"]*)"|'([^']*)')/gi)].some((a) => words.test(a[2] ?? a[3] ?? ""));

/** Removes every element whose class or id names a list of other properties. */
export function withoutOtherBlocks(html: string) {
  return removeElements(html, "div|section|aside|ul|ol|article|nav", (attrs) => named(attrs, OTHERS_BLOCK));
}

/** A class or id naming the site's logo ("logo", "logo-desktop", "site-logo"). */
const LOGO = /(^|[\s_-])logo(?=[\s_-]|$)/i;
/**
 * The site's own graphics are never the property's photos: the page footer,
 * logo containers (the logo's file name says nothing: "566b083e….png") and
 * <link> icons (apple-touch-icon, favicons).
 */
export function withoutSiteChrome(html: string) {
  const noFooter = removeElements(html, "footer", () => true);
  const noLogo = removeElements(noFooter, "div|a|span|figure|p|picture", (attrs) => named(attrs, LOGO));
  return noLogo.replace(/<link\b[^>]*>/gi, " ");
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
  const blocks = withoutOtherBlocks(withoutSiteChrome(html));
  const at = otherListingsAt(blocks);
  return { withoutBlocks: blocks, own: at >= 0 ? blocks.slice(0, at) : blocks };
}
