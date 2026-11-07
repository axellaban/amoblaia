// Listing platforms common among Argentine agencies, detected by a mix of
// signals (CDN hosts, URL shapes, page markers, embedded data), never by the
// agency's hostname alone, and the fields each template publishes in a known
// place. What a template does not give is left to JSON-LD and the generic
// reading. Pure: no network, no code from the page is ever run (embedded
// JSON and Next.js payloads are parsed as data).
import { decode, moneyIn, norm, type Money, type Pair } from "@/lib/demos/listing-details";
import type { Extracted, PlatformId } from "./types";
import { baseOf } from "./photos";

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
const SIMILAR = /<h[1-6][^>]*>\s*(?:<[^>]+>\s*)*(?:(?:ventas|alquileres)\s+(?:<[^>]+>\s*)*relacionad[oa]s|propiedades similares|similares|te puede interesar|tambi[eé]n te pueden? interesar|otras propiedades|propiedades relacionadas|propiedades destacadas)/i;
/** Containers of other properties named as such (Argenprop: id="similarPropertyContainer"). */
const SIMILAR_BOX = /<(?:div|section|aside|ul)\b[^>]*\b(?:id|class)\s*=\s*["'][^"']*\bsimilar-?propert(?:y|ies)[^"']*["']/i;
export function ownPart(html: string) {
  const ends = [SIMILAR.exec(html)?.index, SIMILAR_BOX.exec(html)?.index].filter((i): i is number => i !== undefined);
  return ends.length ? html.slice(0, Math.min(...ends)) : html;
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
  // Classic ASP sites (ver-propiedad-venta.asp?…&codigo=N): the address, or the page linking its own fichas that way.
  if (/\/ver-propiedad-(venta|alquiler)[\w-]*\.asp$/i.test(url.pathname) || (has(/class=["']portfolio-title["']/, "portfolio-title") && has(/href=["'][^"']*ver-propiedad-(venta|alquiler)[\w-]*\.asp\?/i, "asp:ficha")))
    return { platform: "asp_ficha", signals: [...signals, "url:ver-propiedad.asp"] };
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

/**
 * Classic ASP listing sites (ver-propiedad-venta.asp?…&codigo=N): the heading
 * "Casa en Venta en La Baliza, Miramar. u$s 65000" holds kind, operation,
 * place and price; the features, the description and the gallery (swipebox
 * links) follow in the same column. "Publicado… Visto N veces" and the form's
 * security code change on every visit and are never read.
 */
function aspFicha(html: string, pageUrl: string): Extracted {
  const own = ownPart(html);
  const head = squash(byClass(own, ["portfolio-title"])[0]?.match(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/i)?.[1] ?? "");
  const docTitle = squash(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  // "Casa en Venta en La Baliza, Miramar. u$s 65000" → the title before the price;
  // "… Miramar. ID: #7904" or "… (Cód. 7904)" → before the code.
  const bare = (t: string) =>
    t.split(/\.?\s+(?=(?:u\$s|us\$|usd|\$|consultar)\b)/i)[0].replace(/\.?\s*(?:ID:\s*#?\d+|\(C[oó]d\.?\s*\d+\))\s*$/i, "").replace(/\.$/, "").trim();
  // Another variant of the same platform (Gordin) has no portfolio-title and a <title> that only names
  // the site ("Venta de Propiedades - Inmobiliaria Gordin"): the first text that reads
  // "<kind> en Venta en <place>" — a heading, the breadcrumb, the inquiry's subject, the photos' alt.
  const candidates = [
    head,
    docTitle.split(/\s+\|\s+/)[0],
    ...[...own.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)].map((m) => squash(m[1])),
    ...[...own.matchAll(/<li\b[^>]*class=["'][^"']*pull-left[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi)].map((m) => squash(m[1])),
    ...[...own.matchAll(/<input\b[^>]*name=["']asunto2["'][^>]*value=["']([^"']+)["']/gi)].map((m) => decode(m[1])),
    ...[...own.matchAll(/<img\b[^>]*class=["'][^"']*imagen_principal[^"']*["'][^>]*alt=["']([^"']+)["']/gi)].map((m) => decode(m[1])),
  ].map(bare);
  const title = candidates.find((t) => kindOpPlace(t)) ?? (bare(head || docTitle.split(/\s+\|\s+/)[0]) || null);
  const k = kindOpPlace(title);
  // The price in the heading, or in the template's price tag (<span class="sale-tag price">u$s 92000</span>).
  const priceTag = squash(byClass(own, ["price"])[0] ?? "");
  const [price] = [...moneyIn(head), ...moneyIn(priceTag)];
  const pairs: Pair[] = [];
  const pair = (label: string, value: string | undefined | null) => {
    const v = value?.trim();
    if (v) pairs.push({ label, value: v, section: "plantilla" });
  };
  // "Sup. Total 170 m2", "3 Ambientes", "2 Habitaciones", "1 Baños".
  for (const li of (byClass(own, ["property-main-features"])[0] ?? "").matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
    const t = squash(li[1]);
    const area = t.match(/^sup\.?\s*(total|cubierta|construida)\s+(.+)$/i);
    if (area) pair(/total/i.test(area[1]) ? "Superficie total" : "Superficie cubierta", area[2]);
    const count = t.match(/^(\d+)\s+(ambientes?|habitaciones?|dormitorios?|ba(?:ñ|n)os?|cocheras?)$/i);
    if (count) {
      const what = norm(count[2]);
      pair(/^amb/.test(what) ? "Ambientes" : /^(hab|dorm)/.test(what) ? "Dormitorios" : /^ba/.test(what) ? "Baños" : "Cocheras", count[1]);
    }
  }
  // "Sup Construida: <span>80 m2</span>", "Estado: <span>Muy Bueno</span>".
  for (const li of own.matchAll(/<li\b[^>]*>\s*([^<>:]{2,40}):\s*<span[^>]*>([^<]{1,60})<\/span>/gi)) {
    const label = norm(li[1]);
    if (/^sup(erficie)? (construida|cubierta)$/.test(label)) pair("Superficie cubierta", squash(li[2]));
    else if (/^estado$/.test(label)) pair("Estado", squash(li[2]));
  }
  // The text right after the features: the description, without an empty "Notas Adicionales:".
  const descHtml = own.match(/property-main-features[\s\S]*?<\/ul>\s*(?:<\/div>\s*)+<div\b[^>]*class=["']row["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "";
  const description =
    decode(descHtml.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " "))
      .replace(/[ \t]+/g, " ")
      .replace(/\s*Notas Adicionales:\s*$/i, "")
      .trim() || null;
  // The listing's photos are the files named after its code in the photos folder
  // (fotos/ventas/7904_….webp), whichever gallery shows them: swipebox links
  // (Freijo), a Swiper of <img class="imagen_principal"> (Gordin) or mfp-gallery
  // links (Paradiso). The site's logo, the QR code and other listings' files never match.
  const base = baseOf(html, pageUrl);
  const code = new URL(pageUrl).searchParams.get("codigo")?.trim() ?? "";
  const images: string[] = [];
  const add = (raw: string) => {
    try {
      images.push(new URL(decode(raw), base).toString());
    } catch {
      // Not an address.
    }
  };
  if (/^\d{2,12}$/.test(code))
    for (const m of own.matchAll(new RegExp(`(?:href|src|data-background-image|content)\\s*=\\s*["']([^"']*\\bfotos\\/[\\w-]+\\/${code}_[^"'/]+\\.(?:jpe?g|png|webp))["']`, "gi")))
      add(m[1]);
  if (!images.length)
    for (const m of own.matchAll(/<a\b[^>]*href=["']([^"']+\.(?:jpe?g|png|webp))["'][^>]*class=["'][^"']*\bswipebox\b/gi)) add(m[1]);
  const agencyName = docTitle.split(/\s+\|\s+/)[1]?.trim() || null;
  return {
    title,
    location: k?.place ?? null,
    price: price ?? null,
    priceOnRequest: !price && /consultar/i.test(`${head} ${priceTag}`),
    operation: k?.operation ?? null,
    propertyKind: k?.kind ?? null,
    description,
    pairs,
    images: uniqueBy(images, (u) => u),
    agencyName,
  };
}

/** Where the reader appends Argenprop's gallery, which the ficha loads apart (/aviso/gallerypartial). */
export const ARGENPROP_GALLERY_MARK = "<!-- habita:argenprop-gallery -->";

/** The gallery's address on the ficha (data-url-get-gallery), only on Argenprop itself. */
export function argenpropGalleryUrl(html: string, pageUrl: string): string | null {
  const raw = html.match(/data-url-get-gallery\s*=\s*["']([^"']+)["']/i)?.[1];
  if (!raw) return null;
  try {
    const page = new URL(pageUrl);
    const url = new URL(decode(raw), page);
    return url.host === page.host && /^\/aviso\/gallerypartial$/i.test(url.pathname) ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Argenprop's ficha: the address and price in the title bar ("Beruti 3300",
 * "USD 300.000", "Venta en Palermo, CABA"), the title as the description's
 * H1, the features as "Label: <strong>value</strong>" and the advertiser in
 * the contact box. The page shows only 5 photos; the gallery (all of them,
 * "_u_large", 1920 px) comes from its own request and is appended after
 * ARGENPROP_GALLERY_MARK. Other listings ("similares", the advertiser's) never count.
 */
function argenprop(html: string, pageUrl: string): Extracted {
  const [page, gallery = ""] = html.split(ARGENPROP_GALLERY_MARK);
  const own = page.split(/<div\b[^>]*\bid=["']similarPropertyContainer["']/i)[0];
  const first = (names: string[]) => squash(byClass(own, names, 1)[0] ?? "") || null;
  const title = first(["section-description--title"]);
  const street = first(["titlebar__address"]);
  const bar = first(["titlebar__title"]);
  const place = squash(byClass(own, ["location-label"], 1)[0] ?? "") || null;
  // "Venta en Palermo, CABA" → operation and neighbourhood.
  const opPlace = bar?.match(/^(Venta|Alquiler(?: temporario)?)\s+en\s+(.+)$/i);
  const priceText = first(["titlebar__price"]) ?? "";
  const [price] = moneyIn(priceText);
  const pairs: Pair[] = [];
  for (const m of own.matchAll(/<h3\b[^>]*>\s*([^<>:]{2,40}):\s*<strong>\s*([^<]{1,80}?)\s*<\/strong>/gi))
    pairs.push({ label: decode(m[1]).trim(), value: decode(m[2]).replace(/\s+/g, " ").trim(), section: "plantilla" });
  const expenses = first(["titlebar__expenses"])?.replace(/^\+\s*/, "");
  if (expenses) pairs.push({ label: "Expensas", value: expenses.replace(/\s*expensas$/i, ""), section: "plantilla" });
  const descHtml = byClass(own, ["section-description--content"], 1)[0] ?? "";
  const description =
    decode(descHtml.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " "))
      .split("\n")
      .map((l) => l.replace(/[ \t]+/g, " ").trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim() || null;
  // The property's photos live in one folder (static-content/<folder>/<uuid>_u_*.jpg): the
  // gallery's large ones, or else the hero's, enlarged. The advertiser's logo and other
  // listings are in other folders.
  const photo = /https?:\/\/[^"'\s()]*\/static-content\/(\d+)\/([0-9a-f-]{36})(?:_u_[a-z]+)?\.(?:jpe?g|png|webp)/gi;
  const hero = byClass(own, ["hero-image"], 1)[0] ?? "";
  const folder = [...hero.matchAll(photo)][0]?.[1] ?? [...gallery.matchAll(photo)][0]?.[1] ?? null;
  const images: string[] = [];
  for (const source of [gallery, hero])
    for (const m of source.matchAll(photo)) {
      if (m[1] !== folder) continue;
      images.push(`${new URL(pageUrl).origin}/static-content/${m[1]}/${m[2]}_u_large.jpg`);
    }
  const advertiser = squash(byClass(own, ["form-details-heading"], 1)[0] ?? "") || null;
  return {
    title,
    location: joinPlace(place?.replace(/,\s*Capital Federal$/i, "") ?? null) ?? joinPlace(street, opPlace?.[2]),
    price: price ?? null,
    priceOnRequest: !price && onRequest(priceText),
    operation: opPlace ? capitalize(opPlace[1].split(" ")[0]) : null,
    propertyKind: title?.match(KIND_WORDS)?.[1] ?? null,
    description,
    pairs,
    images: uniqueBy(images, (u) => u.split("/").pop()!),
    agencyName: advertiser ? tidyCaps(advertiser) : null,
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
    case "asp_ficha":
      return aspFicha(html, pageUrl);
    case "next_rsc":
      return nextRsc(html);
    case "argenprop":
      return argenprop(html, pageUrl);
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
