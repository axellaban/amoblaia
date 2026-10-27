// Where a listing places its property on a map, read from the page's own
// HTML: structured data, map links and embeds, and the map scripts sites
// write (Leaflet, Google Maps, plain lat/lng objects). Each finding is a
// candidate with its source and context; the property's location is chosen
// among them, never the agency's office or other listings', and only with
// the certainty the page supports. Pure: no network, no script is run.

export type GeoSource =
  | "json-ld"
  | "meta"
  | "leaflet-circle"
  | "leaflet-marker"
  | "google-latlng"
  | "data-attribute"
  | "lat-lng-object"
  | "map-link"
  | "map-view"
  | "manual";
/** Whose location it is, as far as the page tells. */
export type GeoScope = "property" | "office" | "related" | "unknown";
export type GeoCandidate = {
  lat: number;
  lng: number;
  source: GeoSource;
  /** Meters, when the page draws an area (Leaflet circle). */
  radius: number | null;
  scope: GeoScope;
  /** How much it says about the property itself (0–1), before its scope. */
  weight: number;
  /** Position in the HTML, for context. */
  at: number;
};
export type PublicPrecision = "zone" | "approx" | "exact";
export type GeoMap = {
  lat: number;
  lng: number;
  /** What the page may show by default: never more precise than the listing suggests. */
  precision: PublicPrecision;
  radius: number | null;
  source: GeoSource;
  confidence: "high" | "medium" | "low";
};
export type GeoResult = {
  /** found: one clear location. review: contradictory or only a map view. none: nothing usable. */
  status: "found" | "review" | "none";
  map: GeoMap | null;
  candidates: GeoCandidate[];
  /** Why it needs a look, or why there is nothing. */
  note: string | null;
};

/** A real pair of coordinates: finite, in range, and not the 0,0 placeholder. */
export function validPair(lat: unknown, lng: unknown): boolean {
  const a = typeof lat === "string" ? Number(lat) : lat;
  const b = typeof lng === "string" ? Number(lng) : lng;
  return (
    typeof a === "number" &&
    typeof b === "number" &&
    Number.isFinite(a) &&
    Number.isFinite(b) &&
    Math.abs(a) <= 90 &&
    Math.abs(b) <= 180 &&
    !(a === 0 && b === 0)
  );
}

/** Meters between two points. */
export function distance(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(r(b.lat - a.lat) / 2) ** 2 +
    Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

const clampRadius = (m: number | null) => (m && Number.isFinite(m) && m > 0 ? Math.min(5000, Math.max(50, Math.round(m))) : null);

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : all;
    }
    return ENTITY[code.toLowerCase()] ?? all;
  });
const safeDecodeURI = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** "lat,lng" (with optional spaces, %2C or "+"), as maps write it in their parameters. */
function pairIn(text: string | null | undefined) {
  if (!text) return null;
  const m = safeDecodeURI(text).match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,+ ]\s*\+?(-?\d{1,3}(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return validPair(lat, lng) ? { lat, lng } : null;
}

export type MapLink = { lat: number; lng: number; kind: "pin" | "view"; zoom: number | null };

/**
 * Coordinates written in a link of a known map provider (Google Maps,
 * OpenStreetMap, Waze, Apple Maps, Bing, geo: URIs). A pin marks a place;
 * a view is only where the map was centered. Short links (maps.app.goo.gl)
 * and place names need the provider and are not resolved.
 */
export function parseMapLink(raw: string | null | undefined): MapLink | null {
  if (!raw || raw.length > 4000) return null;
  const text = decode(raw.trim());
  const geo = text.match(/^geo:(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/i);
  if (geo) return validPair(Number(geo[1]), Number(geo[2])) ? { lat: Number(geo[1]), lng: Number(geo[2]), kind: "pin", zoom: null } : null;
  let url: URL;
  try {
    url = new URL(/^\/\//.test(text) ? `https:${text}` : text);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(url.protocol)) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const q = url.searchParams;
  const pin = (p: { lat: number; lng: number } | null, zoom: number | null = null): MapLink | null =>
    p ? { ...p, kind: "pin", zoom } : null;
  const view = (lat: number, lng: number, zoom: number | null): MapLink | null =>
    validPair(lat, lng) ? { lat, lng, kind: "view", zoom } : null;

  if (/^(maps\.)?google\.[a-z.]+$/.test(host) && (host.startsWith("maps.") || url.pathname.startsWith("/maps"))) {
    for (const key of ["q", "query", "ll", "destination", "daddr", "center"]) {
      const p = pairIn(q.get(key));
      if (p) return key === "center" || key === "ll" ? view(p.lat, p.lng, Number(q.get("z")) || null) : pin(p, Number(q.get("z")) || null);
    }
    const place = url.pathname.match(/\/place\/(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/);
    if (place && validPair(Number(place[1]), Number(place[2]))) return pin({ lat: Number(place[1]), lng: Number(place[2]) });
    // A dropped pin inside the data part: !3d<lat>!4d<lng>.
    const dropped = safeDecodeURI(url.pathname + url.search).match(/!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/);
    if (dropped && validPair(Number(dropped[1]), Number(dropped[2]))) return pin({ lat: Number(dropped[1]), lng: Number(dropped[2]) });
    const at = url.pathname.match(/@(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)(?:,(\d+(?:\.\d+)?)z)?/);
    if (at) return view(Number(at[1]), Number(at[2]), at[3] ? Number(at[3]) : null);
    // Embed API: the viewport's center (!2d<lng>!3d<lat>), not necessarily the property.
    const pb = q.get("pb")?.match(/!2d(-?\d{1,3}\.\d+)!3d(-?\d{1,2}\.\d+)/);
    if (pb) return view(Number(pb[2]), Number(pb[1]), null);
    return null;
  }
  if (host === "openstreetmap.org" || host.endsWith(".openstreetmap.org")) {
    const mlat = q.get("mlat");
    const mlon = q.get("mlon");
    if (mlat && mlon && validPair(Number(mlat), Number(mlon))) return pin({ lat: Number(mlat), lng: Number(mlon) });
    const marker = pairIn(q.get("marker"));
    if (marker) return pin(marker);
    const hash = url.hash.match(/map=(\d+)\/(-?\d{1,2}(?:\.\d+)?)\/(-?\d{1,3}(?:\.\d+)?)/);
    if (hash) return view(Number(hash[2]), Number(hash[3]), Number(hash[1]));
    const bbox = q.get("bbox")?.split(",").map(Number);
    if (bbox?.length === 4 && bbox.every(Number.isFinite)) return view((bbox[1] + bbox[3]) / 2, (bbox[0] + bbox[2]) / 2, null);
    return null;
  }
  if (host.endsWith("waze.com")) return pin(pairIn(q.get("ll")));
  if (host === "maps.apple.com") return pin(pairIn(q.get("ll")) ?? pairIn(q.get("q")) ?? pairIn(q.get("daddr")));
  if (host === "bing.com" && url.pathname.startsWith("/maps")) {
    const cp = q.get("cp")?.split("~").map(Number);
    if (cp?.length === 2) return view(cp[0], cp[1], Number(q.get("lvl")) || null);
  }
  return null;
}

const PROPERTY_TYPES = /^(apartment|house|singlefamilyresidence|residence|accommodation|room|suite|place|landform|realestatelisting|product|offer|gatedresidencecommunity|apartmentcomplex)$/i;
const AGENCY_TYPES = /^(organization|realestateagent|localbusiness|corporation|website|webpage|store|professionalservice)$/i;
const typesOf = (o: Record<string, unknown>) => ([] as unknown[]).concat(o["@type"] ?? []).map((t) => String(t));

/** Coordinates in the page's JSON-LD, with the kind of thing they belong to. */
function jsonLdCandidates(html: string): GeoCandidate[] {
  const out: GeoCandidate[] = [];
  for (const m of html.matchAll(/<script[^>]+type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const at = m.index ?? 0;
    const visit = (v: unknown, owner: GeoScope, depth: number) => {
      if (depth > 8 || !v || typeof v !== "object") return;
      if (Array.isArray(v)) return v.forEach((x) => visit(x, owner, depth + 1));
      const o = v as Record<string, unknown>;
      const types = typesOf(o);
      const scope: GeoScope = types.some((t) => AGENCY_TYPES.test(t))
        ? "office"
        : types.some((t) => PROPERTY_TYPES.test(t))
          ? "property"
          : owner;
      const point = (g: unknown) => {
        if (!g || typeof g !== "object") return;
        const p = g as Record<string, unknown>;
        const lat = Number(p.latitude ?? p.lat);
        const lng = Number(p.longitude ?? p.lng ?? p.lon);
        if ((p.latitude ?? p.lat) != null && validPair(lat, lng))
          out.push({ lat, lng, source: "json-ld", radius: null, scope, weight: 0.95, at });
      };
      point(o.geo);
      if (!types.some((t) => /geocoordinates/i.test(t))) point(o);
      for (const [k, child] of Object.entries(o))
        if (k !== "geo" && child && typeof child === "object") visit(child, k === "seller" || k === "provider" || k === "offeredBy" || k === "publisher" ? "office" : scope, depth + 1);
    };
    visit(data, "unknown", 0);
  }
  return out;
}

const NUM = "(-?\\d{1,3}(?:\\.\\d+)?)";
const OFFICE_WORDS = /(sucursal|oficinas?\b|casa central|d[oó]nde estamos|vis[ií]tanos|nuestras? (direcci[oó]n|ubicaci[oó]n)|c[oó]mo llegar)/i;

/**
 * Every location the page gives, with its context. `ownEnd` is where the
 * listing ends and other listings or the footer begin.
 */
export function geoCandidates(rawHtml: string, ownEnd = rawHtml.length): GeoCandidate[] {
  // JSON-LD is read on its own, with its types; the other readers skip it
  // (blanked with spaces so positions stay the same).
  const html = rawHtml.replace(/(<script[^>]+application\/ld\+json[^>]*>)([\s\S]*?)(<\/script>)/gi, (_m, a: string, body: string, b: string) => a + " ".repeat(body.length) + b);
  const lower = html.toLowerCase();
  const inside = (open: string, close: string, at: number) => lower.lastIndexOf(open, at) > lower.lastIndexOf(close, at);
  const scopeAt = (at: number): GeoScope => {
    if (inside("<footer", "</footer", at)) return "office";
    // The agency's offices: under a heading that says so, or in a container
    // named like one. A description saying "apto oficina" does not count.
    const heading = [...html.slice(0, at).matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi)].pop();
    if (heading && OFFICE_WORDS.test(decode(heading[1].replace(/<[^>]+>/g, " ")))) return "office";
    if (insideNamed(html, at, /(footer|office|oficina|sucursal|branch)/i)) return "office";
    if (at >= ownEnd) return inside("<script", "</script", at) ? "unknown" : "related";
    return "property";
  };
  const out: GeoCandidate[] = jsonLdCandidates(rawHtml);
  const add = (lat: number, lng: number, source: GeoSource, weight: number, at: number, radius: number | null = null) => {
    if (validPair(lat, lng)) out.push({ lat, lng, source, weight, at, radius: clampRadius(radius), scope: scopeAt(at) });
  };
  const re = (src: string) => new RegExp(src, "g");

  // Leaflet: circles (an area), markers (a point), and the camera.
  for (const m of html.matchAll(re(`L\\.circle\\(\\s*\\[\\s*${NUM}\\s*,\\s*${NUM}\\s*\\]\\s*(?:,\\s*(\\d+(?:\\.\\d+)?)|,\\s*\\{[^}]{0,300}?\\bradius\\s*:\\s*(\\d+(?:\\.\\d+)?))?`)))
    add(Number(m[1]), Number(m[2]), "leaflet-circle", 0.85, m.index ?? 0, Number(m[3] ?? m[4]) || null);
  for (const m of html.matchAll(re(`L\\.(?:marker|circleMarker)\\(\\s*\\[\\s*${NUM}\\s*,\\s*${NUM}\\s*\\]`)))
    add(Number(m[1]), Number(m[2]), "leaflet-marker", 0.8, m.index ?? 0);
  for (const m of html.matchAll(re(`L\\.(?:marker|circleMarker)\\(\\s*L\\.latLng\\(\\s*${NUM}\\s*,\\s*${NUM}`)))
    add(Number(m[1]), Number(m[2]), "leaflet-marker", 0.8, m.index ?? 0);
  for (const m of html.matchAll(re(`(?:setView|flyTo|panTo)\\(\\s*\\[\\s*${NUM}\\s*,\\s*${NUM}\\s*\\]`)))
    add(Number(m[1]), Number(m[2]), "map-view", 0.4, m.index ?? 0);
  for (const m of html.matchAll(re(`\\bcenter\\s*:\\s*\\[\\s*${NUM}\\s*,\\s*${NUM}\\s*\\]`)))
    add(Number(m[1]), Number(m[2]), "map-view", 0.4, m.index ?? 0);
  // Google Maps JavaScript API.
  for (const m of html.matchAll(re(`google\\.maps\\.LatLng\\(\\s*${NUM}\\s*,\\s*${NUM}\\s*\\)`)))
    add(Number(m[1]), Number(m[2]), "google-latlng", 0.7, m.index ?? 0);
  // Object literals in scripts and JSON state: {lat: …, lng: …} in either order, quoted or not.
  const KEY_LAT = `["']?(?:lat|latitude|latitud)["']?\\s*:\\s*["']?${NUM}["']?`;
  const KEY_LNG = `["']?(?:lng|lon|long|longitude|longitud)["']?\\s*:\\s*["']?${NUM}["']?`;
  for (const m of html.matchAll(re(`${KEY_LAT}\\s*,\\s*${KEY_LNG}`))) add(Number(m[1]), Number(m[2]), "lat-lng-object", 0.6, m.index ?? 0);
  for (const m of html.matchAll(re(`${KEY_LNG}\\s*,\\s*${KEY_LAT}`))) add(Number(m[2]), Number(m[1]), "lat-lng-object", 0.6, m.index ?? 0);
  // Data attributes of one element.
  for (const m of html.matchAll(/<[a-z][^>]*\bdata-(?:lat|latitude)\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    const lng = m[0].match(/\bdata-(?:lng|lon|long|longitude)\s*=\s*["']([^"']+)["']/i);
    if (lng) add(Number(m[1]), Number(lng[1]), "data-attribute", 0.75, m.index ?? 0);
  }
  // Meta tags about the page itself.
  const meta = (name: string) =>
    html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']+)["']`, "i"))?.[1] ?? null;
  const metaLat = meta("place:location:latitude") ?? meta("og:latitude");
  const metaLng = meta("place:location:longitude") ?? meta("og:longitude");
  if (metaLat && metaLng && validPair(Number(metaLat), Number(metaLng)))
    out.push({ lat: Number(metaLat), lng: Number(metaLng), source: "meta", weight: 0.8, at: 0, radius: null, scope: "property" });
  const position = (meta("geo.position") ?? "").split(/[;,]/).map(Number);
  if (position.length === 2 && validPair(position[0], position[1]))
    out.push({ lat: position[0], lng: position[1], source: "meta", weight: 0.8, at: 0, radius: null, scope: "property" });
  // Links and embeds of known map providers.
  for (const m of html.matchAll(/\b(?:href|src|data-src)\s*=\s*["']([^"']{10,4000})["']/gi)) {
    const link = parseMapLink(m[1]);
    if (link) add(link.lat, link.lng, link.kind === "pin" ? "map-link" : "map-view", link.kind === "pin" ? 0.75 : 0.45, m.index ?? 0);
  }
  return out;
}

const SOURCE_NAMES: Record<GeoSource, string> = {
  "json-ld": "datos estructurados de la página",
  meta: "metadatos de la página",
  "leaflet-circle": "área marcada en el mapa de la ficha",
  "leaflet-marker": "marcador del mapa de la ficha",
  "google-latlng": "mapa de Google de la ficha",
  "data-attribute": "datos del mapa de la ficha",
  "lat-lng-object": "coordenadas en el código de la ficha",
  "map-link": "enlace de mapa de la ficha",
  "map-view": "centro del mapa de la ficha",
  manual: "cargada a mano",
};
export const sourceName = (s: GeoSource) => SOURCE_NAMES[s];

/**
 * The property's location among the candidates. Offices and other listings
 * are left out; candidates closer than 300 m are the same place. Two strong,
 * distant places, or only a map's center, ask for a review instead of
 * picking one with false certainty.
 */
export function chooseLocation(all: GeoCandidate[]): GeoResult {
  let candidates = all.filter((c) => c.scope !== "office" && c.scope !== "related");
  // A script with many different points after the listing is a map of other listings.
  const unknown = candidates.filter((c) => c.scope === "unknown");
  const unknownPlaces = groupsOf(unknown);
  if (unknownPlaces.length > 2) candidates = candidates.filter((c) => c.scope !== "unknown");
  if (!candidates.length)
    return {
      status: "none",
      map: null,
      candidates: all,
      note: all.length ? "La página solo muestra la ubicación de la oficina o de otras propiedades." : null,
    };
  const score = (c: GeoCandidate) => c.weight - (c.scope === "unknown" ? 0.15 : 0);
  const groups = groupsOf(candidates)
    .map((g) => ({ g, score: Math.max(...g.map(score)) + 0.05 * (new Set(g.map((c) => c.source)).size - 1) }))
    .sort((a, b) => b.score - a.score);
  const best = groups[0];
  const lead = [...best.g].sort((a, b) => score(b) - score(a))[0];
  const circle = best.g.find((c) => c.source === "leaflet-circle" && c.radius);
  const onlyView = best.g.every((c) => c.source === "map-view");
  const radius = circle?.radius ?? null;
  const precision: PublicPrecision = onlyView ? "zone" : circle ? (radius! > 600 ? "zone" : "approx") : "approx";
  const sources = new Set(best.g.map((c) => c.source)).size;
  const confidence = onlyView ? "low" : lead.weight >= 0.8 || sources > 1 ? "high" : lead.weight >= 0.7 ? "medium" : "low";
  const map: GeoMap = { lat: lead.lat, lng: lead.lng, precision, radius, source: lead.source, confidence };
  const rival = groups.slice(1).find((x) => x.score >= best.score - 0.1 && !x.g.every((c) => c.source === "map-view"));
  if (rival)
    return {
      status: "review",
      map,
      candidates: all,
      note: `La página tiene dos ubicaciones distintas (a ${Math.round(distance(lead, rival.g[0]) / 100) / 10} km). Confirmá cuál es la de la propiedad.`,
    };
  if (onlyView)
    return { status: "review", map, candidates: all, note: "Solo encontramos dónde está centrado el mapa, no la propiedad. Revisalo." };
  return { status: "found", map, candidates: all, note: null };
}

/** Whether `at` lies inside an element whose class or id matches (counting nested tags of its name). */
function insideNamed(html: string, at: number, words: RegExp) {
  const opens = [...html.slice(0, at).matchAll(/<(div|section|aside|footer|address|article|ul|li)\b([^>]*)>/gi)].filter((m) =>
    [...m[2].matchAll(/\b(?:class|id)\s*=\s*("[^"]*"|'[^']*')/gi)].some((a) => words.test(a[1])),
  );
  for (const m of opens.reverse()) {
    const tag = m[1].toLowerCase();
    const between = html.slice((m.index ?? 0) + m[0].length, at);
    let depth = 1;
    for (const t of between.matchAll(new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi"))) depth += t[1] ? -1 : 1;
    if (depth > 0) return true;
  }
  return false;
}

function groupsOf(list: GeoCandidate[]) {
  const groups: GeoCandidate[][] = [];
  for (const c of list) {
    const g = groups.find((x) => distance(x[0], c) < 300);
    if (g) g.push(c);
    else groups.push([c]);
  }
  return groups;
}

/** The location of a listing page. */
export function extractLocation(html: string, ownEnd?: number): GeoResult {
  return chooseLocation(geoCandidates(html, ownEnd));
}

/** The distinct places a person may choose from when the map needs a review (best first, at most 3). */
export function placesOf(result: GeoResult) {
  const usable = result.candidates.filter((c) => c.scope === "property" || c.scope === "unknown");
  return groupsOf(usable)
    .map((g) => [...g].sort((a, b) => b.weight - a.weight)[0])
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map((c) => ({ lat: c.lat, lng: c.lng, source: c.source, radius: c.radius }));
}
