// Avisos individuales en el sitio de una inmobiliaria: los enlaces de su portada (o de su página de
// propiedades) que parecen la ficha de una propiedad. Lógica pura: el HTML entra, los enlaces salen.

const LISTING_PATH = /(propiedad|propiedades|property|properties|inmueble|inmuebles|ficha|detalle|aviso|departamento|casa|ph|venta|alquiler|listing|prop)\b/i;
/** Páginas que nunca son una ficha: búsquedas, listados, contacto, institucional, redes. */
const NOT_LISTING = /(\/(contacto|contact|nosotros|about|empresa|tasaciones?|servicios|blog|noticias|novedades|login|ingresar|registro|favoritos|buscar|busqueda|search|resultados|mapa|politica|privacidad|terminos|emprendimientos?\/?$)\b|\.(pdf|jpe?g|png|webp|gif|svg|zip)$)/i;
/** Un listado de propiedades (para seguir un nivel si la portada no tiene fichas). */
const INDEX_PATH = /^\/(propiedades|properties|inmuebles|venta|ventas|alquiler|alquileres|comprar|alquilar|busqueda|search|listado)\/?$/i;

const decode = (s: string) => s.replace(/&amp;/gi, "&").replace(/&#x2F;/gi, "/").replace(/&#47;/g, "/").trim();

function sameSite(a: string, b: string) {
  const strip = (h: string) => h.toLowerCase().replace(/^www\./, "");
  return strip(a) === strip(b);
}

/** Qué tan probable es que la ruta sea la ficha de una propiedad (0: no lo es). */
export function listingScore(path: string) {
  if (!path || path === "/" || NOT_LISTING.test(path) || INDEX_PATH.test(path)) return 0;
  const parts = path.split("/").filter(Boolean);
  const last = parts[parts.length - 1] ?? "";
  let score = 0;
  if (LISTING_PATH.test(path)) score += 2;
  if (/\d{3,}/.test(path)) score += 2;
  if (/[a-z]+-[a-z0-9]+-[a-z0-9]+/i.test(last)) score += 1;
  if (parts.length >= 2) score += 1;
  return score >= 3 ? score : 0;
}

/**
 * Los enlaces del mismo sitio que parecen fichas de propiedades, sin repetidos y en el orden de la
 * página (las destacadas suelen ir primero), sin los de `exclude`. También devuelve los listados
 * de propiedades encontrados, por si hace falta seguir un nivel.
 */
export function listingLinks(html: string, pageUrl: string, exclude: string[] = []) {
  let base: URL;
  try {
    base = new URL(pageUrl);
  } catch {
    return { listings: [] as string[], indexes: [] as string[] };
  }
  const key = (u: URL) => `${u.hostname.toLowerCase().replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}${u.search}`;
  const skip = new Set(
    exclude.flatMap((e) => {
      try {
        return [key(new URL(e))];
      } catch {
        return [];
      }
    }),
  );
  const seen = new Set<string>();
  const listings: { url: string; score: number; at: number }[] = [];
  const indexes: string[] = [];
  for (const m of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*["']([^"'#]+)["']/gi)) {
    let u: URL;
    try {
      u = new URL(decode(m[1]), base);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(u.protocol) || !sameSite(u.hostname, base.hostname)) continue;
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/i.test(k)) u.searchParams.delete(k);
    u.hash = "";
    const k = key(u);
    if (seen.has(k) || skip.has(k)) continue;
    seen.add(k);
    if (INDEX_PATH.test(u.pathname)) {
      indexes.push(u.toString());
      continue;
    }
    const score = listingScore(u.pathname);
    if (score) listings.push({ url: u.toString(), score, at: m.index ?? 0 });
  }
  return { listings: listings.sort((a, b) => b.score - a.score || a.at - b.at).map((l) => l.url), indexes };
}
