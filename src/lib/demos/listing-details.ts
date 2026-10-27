// Reads everything a listing page publishes about one property, from its
// rendered HTML: identification, price, labelled data ("Ambientes: 3"),
// feature lists under each heading, description, map, assigned agent, the
// agency's identity and the property's own photos. Generic (headings, label
// and value pairs, lists), with rules that fit Tokko Broker sites, common
// among Argentine agencies. Pure: no network.

export type Money = { text: string; currency: "USD" | "$"; amount: number };
export type Pair = { label: string; value: string; section: string };
export type FeatureGroup = { title: string; items: string[] };
import { extractLocation, type GeoMap, type GeoResult } from "./geo";

export type MapData = GeoMap;
export type Person = {
  name: string | null;
  photoUrl: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
};
export type ListingDetails = {
  propertyId: string | null;
  /** The listing's own heading ("VENTA | A ESTRENAR | DEPTO 3 AMB…"). */
  commercialTitle: string | null;
  /** A short, clear title ("Departamento en La Perla"), when the page allows it. */
  shortTitle: string | null;
  reference: string | null;
  propertyKind: string | null;
  operation: string | null;
  price: Money | null;
  /** Only when the page itself disagrees about the main price, with both sources. */
  priceConflict: string | null;
  /** The main price and the other amount the page gives for it, when they conflict. */
  priceOptions: string[];
  location: string | null;
  pairs: Pair[];
  features: FeatureGroup[];
  description: string | null;
  map: MapData | null;
  /** How the map was found: one clear place, something to review, or nothing. */
  geo: GeoResult;
  agent: Person | null;
  agency: Person & { logoUrl: string | null; address: string | null };
  images: string[];
  /** Section headings found, to tell "not published" from "not extracted". */
  headings: string[];
};

const ENTITY: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", aacute: "á", eacute: "é", iacute: "í",
  oacute: "ó", uacute: "ú", ntilde: "ñ", Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú",
  Ntilde: "Ñ", uuml: "ü", deg: "°", sup2: "²", ordm: "º", ordf: "ª",
};
export const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (all, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : all;
    }
    return ENTITY[code] ?? all;
  });
const squash = (s: string) => decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
/** Lowercase, no accents: for comparing labels. */
export const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[:\s]+$/g, "").trim();

/** The page as lines; headings are marked so sections can be told apart. */
type Line = { text: string; heading: boolean; item: boolean };
function lines(html: string): Line[] {
  const marked = html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    // Definition lists (<dt>Ambientes</dt><dd>3</dd>) are labelled data, like "Ambientes: 3".
    .replace(
      /<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi,
      (_m, label: string, value: string) => `\n${squash(label).replace(/:$/, "")}: ${squash(value)}\n`,
    )
    .replace(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi, (_m, t: string) => `\n\u0001${squash(t)}\n`)
    .replace(/<li\b[^>]*>/gi, "\n\u0002")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|ul|ol|section|article|tr|td|th|dd|dt|span|a|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const out: Line[] = [];
  // A list item's text may come after an icon element: the mark waits for it.
  let pendingItem = false;
  for (const raw of decode(marked).split("\n")) {
    // eslint-disable-next-line no-control-regex -- the section and item marks set above
    const text = raw.replace(/[\u0001\u0002]/g, "").replace(/\s+/g, " ").trim();
    const item = raw.includes("\u0002") || pendingItem;
    if (!text) {
      if (raw.includes("\u0002")) pendingItem = true;
      continue;
    }
    pendingItem = false;
    out.push({ text, heading: raw.includes("\u0001"), item });
  }
  return out;
}

const PAGE_TABS = /^(categor[ií]a|videos?|fotos|planos?|mapa|ubicaci[oó]n|tour( 360)?|descripci[oó]n)$/i;
/** Where the property ends: lists of other properties and the site footer come after. */
const OTHERS = /^(propiedades similares|similares|te puede interesar|otras propiedades|propiedades relacionadas|propiedades cercanas|tambi[eé]n te puede)/i;

type Section = { title: string; lines: Line[] };
function sections(all: Line[]) {
  const out: Section[] = [{ title: "", lines: [] }];
  for (const l of all) {
    if (l.heading) out.push({ title: l.text, lines: [] });
    else out[out.length - 1].lines.push(l);
  }
  return out;
}

/** "Ambientes:" followed by "3", or "Ambientes: 3" on one line. */
function pairsOf(section: Section): Pair[] {
  const out: Pair[] = [];
  const ls = section.lines;
  for (let i = 0; i < ls.length; i++) {
    const t = ls[i].text;
    const inline = t.match(/^([^:]{2,40}):\s*(.{1,60})$/);
    if (/:$/.test(t) && t.length <= 42 && ls[i + 1] && !/:$/.test(ls[i + 1].text) && ls[i + 1].text.length <= 60) {
      out.push({ label: t.slice(0, -1).trim(), value: ls[i + 1].text, section: section.title });
      i++;
    } else if (inline && !/https?:/i.test(t)) {
      out.push({ label: inline[1].trim(), value: inline[2].trim(), section: section.title });
    }
  }
  return out;
}

const MONEY = /(USD|U\$S|US\$|u\$d|\$)\s?(\d{1,3}(?:[.,]\d{3})+|\d{4,})(?![\d.,]*\d)/gi;
export function moneyIn(text: string): Money[] {
  return [...text.matchAll(MONEY)].map((m) => {
    const currency = m[1] === "$" ? "$" : "USD";
    const amount = Number(m[2].replace(/[.,]/g, ""));
    return { currency, amount, text: `${currency} ${amount.toLocaleString("es-AR")}` } as Money;
  });
}
/** Amounts that are not the property's price: extras, fees and taxes named right before them. */
const NOT_THE_PRICE = /(cochera|baulera|expensa|opcional|seña|reserva|honorario|abl|impuesto|tasa|amenities|gastos|comisi[oó]n|dep[oó]sito)[^\n$\d]{0,30}$/i;

/** Inner HTML of elements whose class or id matches. */
function blocks(html: string, words: RegExp) {
  const out: string[] = [];
  for (const m of html.matchAll(/<(div|section|p|span|article|ul|h\d|a)\b([^>]*)>/gi)) {
    const named = [...m[2].matchAll(/\b(?:id|class)\s*=\s*("[^"]*"|'[^']*')/gi)].some((a) => words.test(a[1]));
    if (!named) continue;
    const tag = m[1].toLowerCase();
    const start = (m.index ?? 0) + m[0].length;
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
const textOf = (html: string) =>
  lines(html)
    .map((l) => (l.item ? `- ${l.text}` : l.text))
    .join("\n");

function absolute(src: string, base: string) {
  try {
    const u = new URL(decode(src.trim()), base);
    return ["http:", "https:"].includes(u.protocol) ? u.toString() : null;
  } catch {
    return null;
  }
}
const digits = (s: string) => s.replace(/\D/g, "");

/** A person's contact block: a name heading, then mail, phone and WhatsApp links (a photo just before). */
function personNear(html: string, at: number, base: string): Person {
  const before = html.slice(Math.max(0, at - 700), at);
  // The block ends at the next contact block or heading.
  const rest = html.slice(at, at + 1500);
  const stop = rest.slice(20).search(/class="media\b|<h[1-6]\b/i);
  const after = stop > 0 ? rest.slice(0, stop + 20) : rest;
  const imgs = [...before.matchAll(/<img\b[^>]*\bsrc\s*=\s*"([^"]+)"/gi)];
  const name = after.match(/<h[3-6]\b[^>]*>([\s\S]*?)<\/h[3-6]>/i);
  const wa = after.match(/(?:api\.whatsapp\.com\/send\?phone=|wa\.me\/)(\d{8,15})/i);
  const tel = after.match(/href\s*=\s*"tel:([^"]+)"/i);
  const mail = after.match(/href\s*=\s*"mailto:([^"?]+)/i);
  return {
    name: name ? squash(name[1]) || null : null,
    photoUrl: imgs.length ? absolute(imgs[imgs.length - 1][1], base) : null,
    email: mail ? decode(mail[1]).trim() : null,
    phone: tel && digits(tel[1]).length >= 6 ? `+${digits(tel[1])}` : null,
    whatsapp: wa ? `+${wa[1]}` : null,
  };
}

/**
 * The price the page declares for search engines (JSON-LD Offer: price and
 * currency) when no price element is marked as such. Only the page's own
 * item: lists of other properties are not read.
 */
function offerPrice(html: string): Money | null {
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1]);
    } catch {
      continue;
    }
    const items = (Array.isArray(data) ? data : [data]) as Record<string, unknown>[];
    for (const item of items) {
      if (!item || typeof item !== "object" || item["@type"] === "ItemList") continue;
      const offers = (Array.isArray(item.offers) ? item.offers[0] : item.offers) as Record<string, unknown> | undefined;
      const amount = Number(offers?.price);
      const currency = String(offers?.priceCurrency ?? "").toUpperCase();
      if (!Number.isFinite(amount) || amount <= 0 || !/^(USD|ARS)$/.test(currency)) continue;
      const text = `${currency === "USD" ? "USD" : "$"} ${Math.round(amount).toLocaleString("es-AR")}`;
      return moneyIn(text)[0] ?? null;
    }
  }
  return null;
}

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s);

export function extractDetails(html: string, pageUrl: string): ListingDetails {
  const page = new URL(pageUrl);
  const propertyId = page.pathname.match(/\/p(?:ropiedad)?\/(\d{4,})/i)?.[1] ?? null;
  const all = lines(html);
  const secs = sections(all);
  const cut = secs.findIndex((s) => OTHERS.test(s.title));
  const own = cut > 0 ? secs.slice(0, cut) : secs;
  const after = cut > 0 ? secs.slice(cut) : [];
  // The same cut in the HTML, for links and images.
  const ownHtmlEnd = (() => {
    if (cut <= 0) return html.length;
    const m = html.match(new RegExp(`<h[1-6][^>]*>\\s*${secs[cut].title.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"));
    return m?.index ?? html.length;
  })();
  const ownHtml = html.slice(0, ownHtmlEnd);
  const meta = (key: string) =>
    decode(html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']`, "i"))?.[1] ?? "").trim() || null;
  const ogTitle = meta("og:title");
  const docTitle = squash(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "") || null;

  // Identification: "RAP12025427 | Departamento" and the operation tag.
  const refBlock = blocks(ownHtml, /(ref|codigo|code)/i).map(squash).find((t) => /\b[A-Z]{2,6}\d{4,}\b/.test(t)) ?? null;
  const reference = refBlock?.match(/\b([A-Z]{2,6}\d{4,})\b/)?.[1] ?? null;
  const kindFromRef = refBlock?.split("|").map((s) => s.trim()).find((s) => s && !/\d{4,}/.test(s)) ?? null;
  const og = ogTitle?.match(/^(.+?) en (Venta|Alquiler(?: temporario)?|Alquiler temporal) en (.+?)(?: - |$)/i);
  const propertyKind = kindFromRef ?? og?.[1]?.trim() ?? null;
  const opTag = blocks(ownHtml, /(op-tag|operation|operacion)/i).map(squash).find((t) => /^(venta|alquiler)/i.test(t));
  // Else the operation the title opens with ("VENTA DEPARTAMENTO…") or the page's path (/venta/, /alquiler/).
  const opWord =
    docTitle?.match(/^(venta|alquiler)\b/i)?.[1] ?? page.pathname.match(/\/(venta|alquiler)(?:\/|-)/i)?.[1] ?? null;
  const operation = opTag ? capitalize(opTag.split(/\s/)[0]) : og ? capitalize(og[2].split(" ")[0]) : opWord ? capitalize(opWord) : null;
  const neighbourhood = og?.[3]?.trim() ?? null;
  const shortTitle = propertyKind && neighbourhood ? `${propertyKind} en ${neighbourhood}` : null;
  const titleH = own.find((s) => s.title && s.title.length > 8 && !/^(detalles|informaci|superficie|descripci|servicios|ambientes|adicionales|ubicaci|contacto|videos?)/i.test(s.title));
  const commercialTitle = titleH?.title ?? null;
  // The line after the title: "TITLE | La Perla | Mar Del Plata | Costa Atlantica".
  let location: string | null = null;
  if (commercialTitle) {
    const sub = titleH!.lines.find((l) => l.text.startsWith(commercialTitle) && l.text.length > commercialTitle.length + 3);
    if (sub) location = sub.text.slice(commercialTitle.length).replace(/^\s*\|\s*/, "").trim() || null;
  }

  // Price: the price element, not amounts mentioned in the text.
  const priceTexts = blocks(ownHtml, /(price|precio)/i).map(squash).filter((t) => moneyIn(t).length);
  const headline = priceTexts.length ? moneyIn(priceTexts.sort((a, b) => a.length - b.length)[0])[0] : null;
  const pairs = own.flatMap(pairsOf);
  const pricePair = pairs.find((p) => /^(precio|valor)$/i.test(norm(p.label)) && moneyIn(p.value).length);
  const price = headline ?? offerPrice(html) ?? (pricePair ? moneyIn(pricePair.value)[0] : null);

  // Description.
  const descHtml = blocks(ownHtml, /(full-description|description|descripcion)/i).sort((a, b) => b.length - a.length)[0];
  let description = descHtml ? textOf(descHtml) : null;
  if (!description) {
    const s = own.find((x) => /^descripci/i.test(x.title));
    description = s ? s.lines.map((l) => (l.item ? `- ${l.text}` : l.text)).join("\n") : meta("og:description");
  }
  description = description
    ?.split("\n")
    .filter((l) => !/^(mostrar|ver) (m[aá]s|menos)$/i.test(l.trim()))
    .join("\n")
    .trim() || null;
  // A conflict needs two prices for the property itself, not extras or fees.
  let priceConflict: string | null = null;
  const priceOptions: string[] = [];
  if (price && description) {
    for (const m of description.matchAll(MONEY)) {
      const lead = description.slice(Math.max(0, (m.index ?? 0) - 40), m.index ?? 0);
      if (NOT_THE_PRICE.test(lead)) continue;
      const [found] = moneyIn(m[0]);
      if (found && found.currency === price.currency && found.amount !== price.amount) {
        priceConflict = `la cabecera muestra ${price.text} y la descripción ${found.text}`;
        priceOptions.push(price.text, found.text);
        break;
      }
    }
  }

  // Feature lists: a heading followed by short list items, no "label:" lines.
  const features: FeatureGroup[] = own
    .filter((s) => s.title && !/^(contacto|descripci|ubicaci|videos?)/i.test(s.title) && !pairsOf(s).length)
    .map((s) => ({
      title: s.title,
      items: s.lines
        // Page tabs ("Videos", "Categoría") are list items too, not features.
        .filter((l) => l.item && l.text.length <= 60 && !/:/.test(l.text) && !PAGE_TABS.test(l.text))
        // Bare figures ("134 m²", "3") are the headline's data, not features.
        .filter((l) => !/^[\d.,]+\s*(m²|m2|mts2?)?$/i.test(l.text))
        .map((l) => l.text),
    }))
    // The listing's own title is not a list of features.
    .filter((g) => g.items.length >= 2 && norm(g.title) !== norm(docTitle ?? ""));

  // Map: every location the page gives, with its context; the office's
  // (footer, "Sucursal" sections) and other listings' are left out.
  const geo = extractLocation(html, ownHtmlEnd);
  const map: MapData | null = geo.map;

  // Agent: the first named contact block of the property (before other listings).
  let agent: Person | null = null;
  for (const m of ownHtml.matchAll(/<h[3-6]\b[^>]*>([^<]{3,60})<\/h[3-6]>/gi)) {
    const p = personNear(ownHtml, m.index ?? 0, page.toString());
    if (p.name && (p.email || p.phone || p.whatsapp)) {
      agent = p;
      break;
    }
  }

  // Agency: its name, logo and the contact in the page's footer.
  const logo = [...html.matchAll(/<img\b[^>]*>/gi)]
    .map((m) => m[0])
    // The agency's own file, even when served by its platform's CDN (static.tokkobroker.com): not the platform's or a network's badge.
    .find((t) => {
      const file = (t.match(/src\s*=\s*"([^"]+)"/i)?.[1] ?? "").split(/[?#]/)[0].split("/").pop() ?? "";
      return /logo/i.test(t) && Boolean(file) && !/(tokko|whatsapp|facebook|instagram|mercado|zonaprop|argenprop)/i.test(file);
    });
  const logoUrl = logo ? absolute(logo.match(/src\s*=\s*"([^"]+)"/i)?.[1] ?? "", page.toString()) : null;
  const footerHtml = html.slice(ownHtmlEnd);
  const used = new Set([agent?.email, agent?.phone, agent?.whatsapp].filter(Boolean));
  const fMail = [...html.matchAll(/mailto:([^"?]+)/gi)].map((m) => decode(m[1]).trim()).find((e) => !used.has(e)) ?? null;
  const fWa = [...html.matchAll(/(?:api\.whatsapp\.com\/send\?phone=|wa\.me\/)(\d{8,15})/gi)].map((m) => `+${m[1]}`).find((w) => !used.has(w)) ?? null;
  const fTel = [...html.matchAll(/href\s*=\s*"tel:([^"]+)"/gi)].map((m) => `+${digits(m[1])}`).find((t) => t.length > 7 && !used.has(t)) ?? null;
  const afterText = after.flatMap((s) => s.lines.map((l) => l.text));
  const address = afterText.find((t) => /^[A-ZÁÉÍÓÚ][\wáéíóúñ. ]+ \d{2,5}\b.*(buenos aires|mar del plata|caba|argentina|\.)/i.test(t)) ?? null;
  const siteName = meta("og:site_name") ?? docTitle?.split(" - ")[0]?.trim() ?? null;
  void footerHtml;

  // Photos: on Tokko sites the property's own files start with its id.
  const urls = [...html.matchAll(/(?:href|src|data-src|data-pswp-src|data-full|data-large|content)\s*=\s*"([^"]+\.(?:jpe?g|png|webp)(?:\?[^"]*)?)"/gi)].map((m) => m[1]);
  const seen = new Set<string>();
  const images: string[] = [];
  if (propertyId) {
    for (const raw of urls) {
      const url = absolute(raw, page.toString());
      if (!url) continue;
      const file = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
      if (!file.startsWith(`${propertyId}_`) || /_(thumb|og)\./i.test(file)) continue;
      if (seen.has(file)) continue;
      seen.add(file);
      images.push(url);
    }
  }

  return {
    propertyId,
    commercialTitle,
    shortTitle,
    reference,
    propertyKind,
    operation,
    price,
    priceConflict,
    priceOptions,
    location,
    pairs,
    features,
    description,
    map,
    geo,
    agent,
    agency: {
      name: siteName,
      logoUrl,
      address,
      email: fMail,
      phone: fTel,
      whatsapp: fWa,
      photoUrl: null,
    },
    images,
    headings: secs.map((s) => s.title).filter(Boolean),
  };
}
