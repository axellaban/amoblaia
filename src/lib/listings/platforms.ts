// Listing platforms common among Argentine agencies, detected by a mix of
// signals (CDN hosts, URL shapes, page markers, embedded data), never by the
// agency's hostname alone, and the fields each template publishes in a known
// place. What a template does not give is left to JSON-LD and the generic
// reading. Pure: no network, no code from the page is ever run (embedded
// JSON and Next.js payloads are parsed as data).
import { decode, moneyIn, norm, type Money, type Pair } from "@/lib/demos/listing-details";
import type { Extracted, PlatformId } from "./types";

const squash = (s: string) => decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const meta = (html: string, key: string) =>
  decode(
    html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']`, "i"))?.[1] ??
      html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`, "i"))?.[1] ??
      "",
  ).trim() || null;

/** Inner HTML of the elements whose class attribute has one of these class names (whole tokens). */
export function byClass(html: string, names: string[], limit = 20): string[] {
  const out: string[] = [];
  const wanted = new Set(names.map((n) => n.toLowerCase()));
  for (const m of html.matchAll(/<([a-z][a-z0-9]*)\b[^>]*\bclass\s*=\s*("([^"]*)"|'([^']*)')[^>]*>/gi)) {
    const classes = (m[3] ?? m[4] ?? "").toLowerCase().split(/\s+/);
    if (!classes.some((c) => wanted.has(c))) continue;
    const tag = m[1].toLowerCase();
    const start = (m.index ?? 0) + m[0].length;
    if (/^(img|input|br|meta|link|source)$/.test(tag)) continue;
    let depth = 1;
    let end = html.length;
    for (const t of html.slice(start, start + 200000).matchAll(new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi"))) {
      depth += t[1] ? -1 : 1;
      if (!depth) {
        end = start + (t.index ?? 0);
        break;
      }
    }
    out.push(html.slice(start, end));
    if (out.length >= limit) break;
  }
  return out;
}

/** Where the property ends and the lists of other properties begin (their prices and photos are not this one's). */
const SIMILAR = /<h[1-6][^>]*>\s*(?:<[^>]+>\s*)*(propiedades similares|similares|te puede interesar|tambi[eé]n te pueden? interesar|otras propiedades|propiedades relacionadas|propiedades destacadas)/i;
export function ownPart(html: string) {
  const m = SIMILAR.exec(html);
  return m ? html.slice(0, m.index) : html;
}

const onRequest = (text: string) => /\b(consultar precio|precio a consultar|consulte (el )?precio|precio: ?consultar|valor a consultar)\b/i.test(text);
const firstMoney = (texts: string[]): Money | null => {
  for (const t of texts) {
    const [m] = moneyIn(squash(t));
    if (m) return m;
  }
  return null;
};
const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s);
/** "AV. LIBERTAD 3301" → "Av. Libertad 3301"; text with lower case letters is kept as published. */
export const tidyCaps = (s: string) =>
  s === s.toUpperCase() && /[A-ZÁÉÍÓÚÑ]{3}/.test(s)
    ? s.toLowerCase().replace(/(^|[\s.(/-])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase())
    : s;
const joinPlace = (...parts: (string | null | undefined)[]) => {
  const seen: string[] = [];
  for (const p of parts) {
    const v = p?.replace(/\s+/g, " ").trim();
    if (v && !seen.some((s) => norm(s) === norm(v))) seen.push(v);
  }
  return seen.length ? seen.join(", ") : null;
};
const uniqueBy = <T,>(items: T[], key: (t: T) => string) => {
  const seen = new Set<string>();
  return items.filter((i) => {
    const k = key(i);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};
/** "Departamento en Venta en Plaza Mitre - Bolivar al 2600" → kind, operation, neighbourhood, street. */
function kindOpPlace(title: string | null) {
  const m = title?.match(/^(.+?) en (Venta|Alquiler(?: temporario| por d[ií]a| temporal)?) en (.+?)(?:\s+-\s+(.+))?$/i);
  return m ? { kind: m[1].trim(), operation: capitalize(m[2].split(" ")[0]), place: m[3].trim(), street: m[4]?.trim() ?? null } : null;
}

// ---------------------------------------------------------------- detection

export type Detection = { platform: PlatformId; signals: string[] };

export function detectPlatform(html: string, pageUrl: string): Detection {
  const url = new URL(pageUrl);
  const host = url.hostname.replace(/^www\./, "");
  const signals: string[] = [];
  const has = (re: RegExp, signal: string) => {
    const ok = re.test(html);
    if (ok) signals.push(signal);
    return ok;
  };
  if (/(^|\.)argenprop\.com$/.test(host)) return { platform: "argenprop", signals: ["host:argenprop"] };
  if (/(^|\.)zonaprop\.com\.ar$/.test(host)) return { platform: "zonaprop", signals: ["host:zonaprop"] };
  const next = has(/self\.__next_f\.push|id="__NEXT_DATA__"/, "nextjs");
  const tokkoCdn = has(/static\.tokkobroker\.com/, "cdn:tokko");
  if (next && tokkoCdn) return { platform: "next_tokko", signals };
  if (tokkoCdn) {
    if (/--\d{6,}\/?$/.test(url.pathname) || /original_pictures\//.test(html)) return { platform: "tokko_api", signals: [...signals, "url:--id"] };
    if (/^\/p\/\d+/.test(url.pathname) || has(/data-external_id=|tokkobroker\.com\/(w_pics|pictures)\/\d+_/, "tokko:template"))
      return { platform: "tokko", signals };
  }
  if (has(/imagenes\.inmobiliaticaweb\.com|inmobiliatica/i, "inmobiliatica") || /_\d+_propiedad-inmobiliaria\.html$/.test(url.pathname))
    return { platform: "inmobiliatica", signals };
  if (has(/image\.wasi\.co|images\.wasi\.co/, "cdn:wasi")) return { platform: "wasi", signals };
  if (has(/cdn\.tecnogestion\.com\.ar|tecnogestion/i, "tecnogestion")) return { platform: "tecnogestion", signals };
  const wp = has(/\/wp-content\//, "wordpress");
  if (wp && has(/houzez/i, "houzez")) return { platform: "houzez", signals };
  if (has(/<meta[^>]+generator[^>]+Elementor/i, "elementor")) return { platform: "elementor", signals };
  if (wp) return { platform: "wordpress", signals };
  if (next) return { platform: "next_rsc", signals };
  return { platform: "generic", signals };
}

// ---------------------------------------------------------------- photos

/** Tokko serves each photo in several sizes; /pictures/ (or /original_pictures/) is the original. */
function tokkoPhotos(html: string, id: string | null) {
  const text = html.replace(/%2F/gi, "/").replace(/%3A/gi, ":");
  const out: string[] = [];
  for (const m of text.matchAll(/static\.tokkobroker\.com\/(pictures|w_pics|original_pictures|thumbs|sm_pics)\/((\d+)_[A-Za-z0-9]+|\d{20,})(_thumb|_og)?\.(jpe?g|png|webp)/gi)) {
    // "_og" is the cropped sharing picture; "_thumb" stands for the original next to it.
    if ((id && m[3] !== id) || m[4]?.toLowerCase() === "_og") continue;
    const dir = m[1].toLowerCase() === "original_pictures" ? "original_pictures" : "pictures";
    out.push(`https://static.tokkobroker.com/${dir}/${m[2]}.${m[5]}`);
  }
  return uniqueBy(out, (u) => u.split("/").pop()!);
}

/** WordPress uploads in the property's part of the page, without size suffixes and without the site's graphics. */
function wordpressPhotos(html: string, pageUrl: string) {
  const own = ownPart(html);
  const site = new URL(pageUrl).hostname.replace(/^www\./, "");
  const out: string[] = [];
  for (const m of own.matchAll(/https?:\/\/[^"'\s()<>]+?\/wp-content\/uploads\/[^"'\s()<>]+?\.(?:jpe?g|png|webp)/gi)) {
    const url = m[0].replace(/-\d{2,4}x\d{2,4}(?=\.\w+$)/, "").replace(/-scaled(?=\.\w+$)/, "");
    const u = new URL(url);
    if (!u.hostname.replace(/^www\./, "").endsWith(site)) continue;
    // Site graphics, not photos ("WhatsApp-Image-…" uploads are photos and stay).
    if (/(logo|icon|favicon|placeholder|banner|avatar|marca|firma)/i.test(u.pathname.split("/").pop() ?? "")) continue;
    out.push(u.toString());
  }
  return uniqueBy(out, (u) => u.toLowerCase());
}

// ---------------------------------------------------------------- platforms

function tokko(html: string, pageUrl: string): Extracted {
  const url = new URL(pageUrl);
  let data: Record<string, unknown> | null = null;
  const raw = html.match(/data-property="([^"]+)"/)?.[1];
  if (raw)
    try {
      data = JSON.parse(decode(raw));
    } catch {
      data = null;
    }
  const id = url.pathname.match(/^\/p\/(\d+)/)?.[1] ?? html.match(/data-external_id="(\d+)"/)?.[1] ?? (data?.external_id as string | undefined) ?? null;
  const ogTitle = meta(html, "og:title");
  const brandless = ogTitle?.includes("::") ? ogTitle.split("::").slice(1).join("::").trim() : ogTitle;
  const parsed = kindOpPlace(brandless);
  const op = (data?.operations as { operation_type?: string; prices?: { currency?: string; price?: number }[] }[] | undefined)?.[0];
  const dataPrice = op?.prices?.[0]?.price ? moneyIn(`${op.prices[0].currency === "USD" ? "USD" : "$"} ${op.prices[0].price.toLocaleString("es-AR")}`)[0] : null;
  const price = dataPrice ?? firstMoney([...byClass(html, ["operation-val", "price-number", "prop-detail-price-list"]), ...byClass(html, ["fz40"])]);
  const street = (data?.fake_address as string | undefined) ?? parsed?.street ?? squash(byClass(html, ["title-address"])[0] ?? "") ?? null;
  const neighbourhood = (data?.location as string | undefined) ?? parsed?.place ?? null;
  // The photo captions name the city: "Foto … en Venta en Sarmiento, Mar Del Plata Mexico al 1400".
  const city = street && neighbourhood ? html.match(new RegExp(`en ${neighbourhood.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}, ([^"<]{3,40}?) ${street.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"))?.[1] ?? null : null;
  const kind = parsed?.kind ?? null;
  const publication = (data?.publication_title as string | undefined) ?? null;
  // The "rounded" template shows the figures as chips: "119 m² cub.", "4 amb.", "3 dorm.".
  const pairs: Pair[] = [];
  for (const block of byClass(html, ["property-meta"], 2))
    for (const chip of block.matchAll(/<span\b[^>]*>\s*([^<]{2,30})\s*<\/span>/gi)) {
      const t = decode(chip[1]).trim();
      const m = t.match(/^([\d.,]+)\s*(m²|m2)?\s*(cub|tot|semi|amb|dorm|bañ|ban|toil|coch)/i);
      if (!m) continue;
      const label = { cub: "Superficie cubierta", tot: "Superficie total", semi: "Superficie semicubierta", amb: "Ambientes", dorm: "Dormitorios", bañ: "Baños", ban: "Baños", toil: "Toilettes", coch: "Cocheras" }[m[3].toLowerCase()];
      if (label) pairs.push({ label, value: m[2] ? `${m[1]} m²` : m[1], section: "plantilla" });
    }
  return {
    pairs,
    agencyName: ogTitle?.includes("::") ? ogTitle.split("::")[0].trim() || null : null,
    title: kind && neighbourhood ? `${kind} en ${neighbourhood}` : (publication ?? brandless),
    location: joinPlace(street ? tidyCaps(street) : null, neighbourhood, city ? tidyCaps(city) : null),
    price,
    priceOnRequest: !price && (/<[^>]+id=["']ask_for_price["']/i.test(html) || onRequest(squash(ownPart(html)))),
    operation: op?.operation_type ?? parsed?.operation ?? null,
    propertyKind: kind,
    images: tokkoPhotos(html, id),
  };
}

/** Agency sites on Tokko's data: the title opens with the operation ("Venta- Departamento…"). */
function tokkoApi(html: string): Extracted {
  const ogTitle = meta(html, "og:title");
  const op = ogTitle?.match(/^(Venta|Alquiler(?: temporario)?)\s*-\s*/i);
  return {
    title: op && ogTitle ? capitalize(ogTitle.slice(op[0].length).trim()) : null,
    operation: op ? capitalize(op[1].split(" ")[0]) : null,
    images: tokkoPhotos(ownPart(html), null),
  };
}

function nextTokko(html: string): Extracted {
  const ogTitle = meta(html, "og:title");
  // "Departamento en venta en Chauvin, 2 ambientes | Corrientes 3130 | Agency"
  const parts = ogTitle?.split(" | ") ?? [];
  const m = parts[0]?.match(/^(.+?) en (venta|alquiler) en ([^,]+)/i);
  return {
    title: m ? `${capitalize(m[1])} en ${m[3].trim()}` : (parts[0] ?? null),
    operation: m ? capitalize(m[2]) : null,
    propertyKind: m ? capitalize(m[1]) : null,
    location: m && parts[1] ? joinPlace(parts[1], m[3]) : null,
    agencyName: parts.length >= 3 ? parts[parts.length - 1] : null,
    images: tokkoPhotos(ownPart(html), null),
  };
}

function inmobiliatica(html: string): Extracted {
  const own = ownPart(html);
  const price = firstMoney(byClass(own, ["precioDeFicha"], 1));
  // <title>: "Departamento en Venta en La Perla, Mar del Plata - U$S 143.640 | Agency"
  const docTitle = squash(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const head = docTitle.split(/\s+\|\s+/)[0].replace(/\s+-\s+(U\$S|USD|\$).*$/i, "");
  const parsed = kindOpPlace(head.replace(/,\s*([^,]+)$/, "")) ?? null;
  const city = head.match(/,\s*([^,]+)$/)?.[1]?.trim() ?? null;
  const pair = (label: RegExp) => {
    const m = own.match(new RegExp(`<strong>\\s*${label.source}\\s*:?\\s*</strong>\\s*<span[^>]*>([^<]+)</span>`, "i"));
    return m ? decode(m[1]).trim() : null;
  };
  const address = pair(/Direcci(?:ó|&#xF3;|&oacute;)n(?: Aprox\.)?/);
  const zone = pair(/Zona/) ?? parsed?.place ?? null;
  let images: string[] = [];
  const fotos = html.match(/data-fotos='([^']+)'/)?.[1];
  if (fotos)
    try {
      images = (JSON.parse(decode(fotos)) as unknown[]).filter((u): u is string => typeof u === "string" && /^https?:\/\//.test(u));
    } catch {
      images = [];
    }
  if (!images.length)
    images = uniqueBy(
      [...own.matchAll(/https?:\/\/imagenes\.inmobiliaticaweb\.com\/imagenes-propiedades\/Files\/\d+\/(?:medium\/|small\/|thumb\/)?\d+_[^"'\s)]+\.(?:jpe?g|png|webp)/gi)].map((m) =>
        m[0].replace(/\/(medium|small|thumb)\//i, "/"),
      ),
      (u) => u,
    );
  return {
    title: parsed ? `${parsed.kind} en ${zone ?? parsed.place}` : head || null,
    location: joinPlace(address ? tidyCaps(address) : null, zone, city),
    price,
    priceOnRequest: !price && onRequest(squash(byClass(own, ["precioDeFicha"], 1)[0] ?? "")),
    operation: pair(/Tipo de Operaci(?:ó|&#xF3;|&oacute;)n/) ?? parsed?.operation ?? null,
    propertyKind: parsed?.kind ?? null,
    images,
  };
}

function wasi(html: string): Extracted {
  const own = ownPart(html);
  const pair = (label: string) => {
    const m = own.match(new RegExp(`<strong>\\s*${label}\\s*:\\s*</strong>\\s*([^<]+)<`, "i"));
    return m ? decode(m[1]).trim() : null;
  };
  // image.wasi.co/<base64 of {"bucket","key","edits":{resize}}>: the key without edits is the original.
  const keys: string[] = [];
  for (const m of own.matchAll(/https?:\/\/image\.wasi\.co\/([A-Za-z0-9+/=_-]{40,})/g)) {
    try {
      const data = JSON.parse(Buffer.from(m[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as { key?: string };
      if (data.key && /^inmuebles\/[\w.-]+\.(jpe?g|png|webp)$/i.test(data.key)) keys.push(data.key);
    } catch {
      // Not one of Wasi's encoded addresses.
    }
  }
  for (const m of own.matchAll(/https?:\/\/images\.wasi\.co\/(inmuebles\/[\w.-]+\.(?:jpe?g|png|webp))/gi)) keys.push(m[1]);
  // The same photo in two sizes: "b1090031…" and "g1090031…".
  const images = uniqueBy(keys, (k) => k.replace(/^inmuebles\/[a-z]*/i, "")).map((k) => `https://images.wasi.co/${k}`);
  const kind = pair("Tipo de inmueble");
  const city = pair("Ciudad");
  return {
    title: kind && city ? `${capitalize(kind)} en ${city}` : null,
    location: joinPlace(pair("Zona") ?? pair("Barrio"), city, pair("Regi(?:ó|&oacute;)n")),
    operation: pair("Tipo de negocio"),
    propertyKind: kind,
    reference: pair("C(?:ó|&oacute;)digo"),
    images,
  };
}

function tecnogestion(html: string): Extracted {
  const own = ownPart(html);
  const price = firstMoney(byClass(own, ["price"], 3));
  const street = squash(byClass(own, ["direccion"], 1)[0] ?? "") || null;
  const city = street ? squash(own.match(/<h1 class="direccion">[\s\S]*?<\/h1>\s*<p>([^<]{2,60})<\/p>/i)?.[1] ?? "") || null : null;
  const li = (label: string) => {
    const m = own.match(new RegExp(`<li>\\s*${label}\\s*<span>([^<]+)</span>`, "i"));
    return m ? decode(m[1]).trim() : null;
  };
  const kind = li("Producto");
  const barrio = li("Barrio");
  const images = uniqueBy(
    [...own.matchAll(/https?:\/\/cdn\.tecnogestion\.com\.ar\/multimedia\/[^"'\s?)]+\.(?:jpe?g|png|webp)/gi)].map((m) => m[0]),
    (u) => u.toLowerCase(),
  );
  const op = li("Operaci(?:ó|&oacute;|&#243;)n") ?? squash(byClass(own, ["forSale"], 1)[0] ?? "");
  const desc = byClass(own, ["contenido-observaciones"], 1)[0];
  return {
    title: kind ? `${kind} en ${barrio ?? city ?? street ?? ""}`.replace(/ en $/, "") : null,
    location: joinPlace(street, barrio, city),
    price,
    operation: op ? capitalize(op) : null,
    propertyKind: kind,
    description: desc ? decode(desc.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")).replace(/[ \t]+/g, " ").trim() : null,
    images,
  };
}

/** Headings like "Departamento | Centro | U$S 57.900": kind, zone and price of the listing. */
function pipeHeading(html: string) {
  for (const m of html.matchAll(/<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>/gi)) {
    const text = squash(m[1]);
    const parts = text.split(/\s+\|\s+/);
    const [money] = moneyIn(text);
    if (parts.length >= 2 && money) return { kind: parts[0], zone: parts.length >= 3 ? parts[1] : null, price: money };
  }
  return null;
}

function wordpress(html: string, pageUrl: string, flavor: "houzez" | "elementor" | "wordpress"): Extracted {
  const own = ownPart(html);
  const head = flavor === "houzez" ? null : pipeHeading(own);
  const h1 = squash(own.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "") || null;
  const ogTitle = meta(html, "og:title")?.replace(/\s+[-–|]\s+[^-–|]+$/, "") ?? null;
  const address = h1 ?? ogTitle;
  // Elementor sites title the page with the address ("Santa Fe 1624"): the heading gives kind and zone.
  const titleIsAddress = Boolean(address && /^[\p{L} .]+ \d{2,5}$/u.test(address));
  return {
    title: head && titleIsAddress ? `${head.kind} en ${head.zone ?? address}` : null,
    location: head && titleIsAddress ? joinPlace(address, head.zone) : null,
    price: head?.price ?? null,
    propertyKind: head?.kind ?? null,
    images: wordpressPhotos(html, pageUrl),
  };
}

/** Next.js pages: the rendered heading block and the photos in the page's data (read as JSON, never run). */
function nextRsc(html: string): Extracted {
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>([\s\S]{0,1500})/i);
  let price: Money | null = null;
  let location: string | null = null;
  if (h1) {
    const after = h1[2].split(/<h[1-6]\b/i)[0];
    price = firstMoney([after]);
    // The first short text right after the title, before the price: the address.
    const firstText = [...after.matchAll(/<(span|p)\b[^>]*>([^<]{3,80})<\/\1>/gi)].map((m) => decode(m[2]).trim()).find((t) => !moneyIn(t).length);
    if (firstText && /\d/.test(firstText)) location = firstText;
  }
  const images: string[] = [];
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)) {
    let chunk: string;
    try {
      chunk = JSON.parse(`"${m[1]}"`) as string;
    } catch {
      continue;
    }
    for (const arr of chunk.matchAll(/"images":\[((?:"[^"]+",?)+)\]/g))
      for (const u of arr[1].matchAll(/"(https?:\/\/[^"]+\.(?:jpe?g|png|webp)(?:\?[^"]*)?)"/gi)) images.push(u[1]);
  }
  return { price, location, images: uniqueBy(images, (u) => u) };
}

const KIND_WORDS = /\b(departamento|depto|casa|chalet|ph|d[uú]plex|tr[ií]plex|monoambiente|local|oficina|terreno|lote|cochera|galp[oó]n|quinta|caba[nñ]a|semipiso|piso)\b/i;

/** Sites of their own: a property title in the H1, and galleries kept as data in an inline script ({"full": "/fotos/…"}). */
function generic(html: string, pageUrl: string): Extracted {
  const own = ownPart(html);
  const h1 = squash(own.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "");
  const images: string[] = [];
  for (const script of own.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (!/galer|gallery|foto|photo|images?/i.test(script[1])) continue;
    for (const m of script[1].matchAll(/"(?:full|original|large|big|zoom|fullsize)"\s*:\s*"([^"]+?\.(?:jpe?g|png|webp)(?:\?[^"]*)?)"/gi)) {
      try {
        images.push(new URL(m[1].replace(/\\\//g, "/"), pageUrl).toString());
      } catch {
        // Not an address.
      }
    }
  }
  return {
    title: h1.length >= 10 && h1.length <= 120 && KIND_WORDS.test(h1) ? h1 : null,
    images: uniqueBy(images, (u) => u),
  };
}

/** The fields this platform's template publishes in known places. */
export function extractPlatform(platform: PlatformId, html: string, pageUrl: string): Extracted {
  switch (platform) {
    case "tokko":
      return tokko(html, pageUrl);
    case "tokko_api":
      return tokkoApi(html);
    case "next_tokko":
      return nextTokko(html);
    case "inmobiliatica":
      return inmobiliatica(html);
    case "wasi":
      return wasi(html);
    case "tecnogestion":
      return tecnogestion(html);
    case "houzez":
    case "elementor":
    case "wordpress":
      return wordpress(html, pageUrl, platform);
    case "next_rsc":
      return nextRsc(html);
    default:
      return generic(html, pageUrl);
  }
}

/** Extra label/value pairs some templates publish without a colon ("Cocheras <span>1</span>", "<strong>Precio</strong> <span>…</span>"). */
export function templatePairs(html: string): Pair[] {
  const own = ownPart(html);
  const out: Pair[] = [];
  const push = (label: string, value: string) => {
    const l = decode(label).replace(/:\s*$/, "").trim();
    const v = decode(value).trim();
    if (l.length >= 2 && l.length <= 40 && v && v.length <= 60) out.push({ label: l, value: v, section: "plantilla" });
  };
  for (const m of own.matchAll(/<li\b[^>]*>\s*([^<>:]{2,40}?)\s*<span[^>]*>([^<]{1,60})<\/span>\s*<\/li>/gi)) push(m[1], m[2]);
  for (const m of own.matchAll(/<strong>\s*([^<>]{2,40}?)\s*<\/strong>\s*<span[^>]*>([^<]{1,60})<\/span>/gi)) push(m[1], m[2]);
  // Icon cards: <p>Dormitorios</p><p>1</p>.
  for (const m of own.matchAll(/<p\b[^>]*>\s*(Ambientes|Dormitorios|Ba(?:ñ|&ntilde;)os|Superficie(?: total| cubierta)?|Cocheras?)\s*<\/p>\s*<p\b[^>]*>\s*([\d.,]+(?:\s*m(?:²|2))?)\s*<\/p>/gi))
    push(m[1], m[2]);
  return out;
}
