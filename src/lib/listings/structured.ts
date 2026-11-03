// What a listing declares for search engines in JSON-LD (schema.org
// RealEstateListing, Product, Accommodation, House…): name, address, rooms,
// area, offer price and currency, seller. Often the cleanest data on the
// page, and independent of its visual template. Pure: no network.
import { decode, moneyIn, type Money, type Pair } from "@/lib/demos/listing-details";
import type { Extracted } from "./types";

type Obj = Record<string, unknown>;
const LISTING_TYPES = /^(realestatelisting|product|accommodation|apartment|house|singlefamilyresidence|residence|place|offer|room|suite)$/;
const AGENCY_TYPES = /^(realestateagent|organization|localbusiness)$/;

/** Every JSON-LD object of the page, flattening @graph and arrays (malformed blocks are skipped). */
export function jsonLdObjects(html: string): Obj[] {
  const found: Obj[] = [];
  const visit = (v: unknown, depth = 0) => {
    if (depth > 6) return;
    if (Array.isArray(v)) v.forEach((x) => visit(x, depth + 1));
    else if (v && typeof v === "object") {
      found.push(v as Obj);
      if ((v as Obj)["@graph"]) visit((v as Obj)["@graph"], depth + 1);
    }
  };
  for (const m of html.matchAll(/<script[^>]+type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      visit(JSON.parse(m[1].trim()));
    } catch {
      // Malformed blocks are common; the other sources still apply.
    }
  }
  return found;
}

const typesOf = (o: Obj) => ([] as unknown[]).concat(o["@type"] ?? []).map((t) => String(t).toLowerCase());
const str = (v: unknown) => (typeof v === "string" && v.trim() ? decode(v).replace(/\s+/g, " ").trim() : null);
const num = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[^\d.]/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

function addressOf(v: unknown): string | null {
  if (typeof v === "string") return str(v);
  if (!v || typeof v !== "object") return null;
  const a = v as Obj;
  const street = str(a.streetAddress);
  const locality = str(a.addressLocality);
  // Some sites put the whole geocoded address in streetAddress ("2619, General Roca, San José, Mar del Plata, …").
  if (street && street.split(",").length >= 4) {
    const parts = street.split(",").map((s) => s.trim());
    const num = /^\d+$/.test(parts[0]) ? parts.shift() : null;
    return [num ? `${parts[0]} ${num}` : parts[0], parts[1], locality ?? parts[2]].filter(Boolean).join(", ");
  }
  const parts = [street, locality].filter((p): p is string => Boolean(p));
  return parts.length ? [...new Set(parts)].join(", ") : null;
}

function offerOf(o: Obj): { price: Money | null; currencyKnown: boolean } {
  const offers = ([] as unknown[]).concat(o.offers ?? []).filter((x): x is Obj => Boolean(x && typeof x === "object"));
  for (const offer of offers) {
    const amount = num(offer.price);
    const currency = String(offer.priceCurrency ?? "").toUpperCase();
    if (!amount || !/^(USD|ARS)$/.test(currency)) continue;
    const [money] = moneyIn(`${currency === "USD" ? "USD" : "$"} ${Math.round(amount).toLocaleString("es-AR")}`);
    if (money) return { price: money, currencyKnown: true };
  }
  return { price: null, currencyKnown: false };
}

/** The listing's own structured data, as fields the merge can use. */
export function extractStructured(html: string): Extracted & { sellerName: string | null } {
  const all = jsonLdObjects(html);
  const listing = all.find(
    (o) => typesOf(o).some((t) => LISTING_TYPES.test(t)) && !typesOf(o).some((t) => AGENCY_TYPES.test(t)) && (o.offers || o.address || o.about || o.floorSize || o.numberOfRooms),
  );
  if (!listing) return { sellerName: null };
  const about = (listing.about && typeof listing.about === "object" ? listing.about : {}) as Obj;
  const pick = (k: string) => listing[k] ?? about[k];
  const pairs: Pair[] = [];
  const add = (label: string, v: unknown, unit = "") => {
    const n = num(typeof v === "object" && v ? (v as Obj).value : v);
    if (n) pairs.push({ label, value: `${n}${unit}`, section: "JSON-LD" });
  };
  add("Ambientes", pick("numberOfRooms"));
  add("Dormitorios", pick("numberOfBedrooms"));
  add("Baños", pick("numberOfBathroomsTotal") ?? pick("numberOfFullBathrooms"));
  add("Superficie total", pick("floorSize"), " m²");
  for (const p of ([] as unknown[]).concat(listing.additionalProperty ?? [])) {
    const x = p as Obj;
    const label = str(x?.name);
    const value = typeof x?.value === "number" ? String(x.value) : str(x?.value);
    if (label && value && !pairs.some((q) => q.label.toLowerCase() === label.toLowerCase())) pairs.push({ label, value, section: "JSON-LD" });
  }
  const { price } = offerOf(listing);
  const offers = ([] as unknown[]).concat(listing.offers ?? []) as Obj[];
  const seller = offers.map((o) => (o?.seller as Obj | undefined)?.name).find(Boolean) ?? (listing.brand as Obj | undefined)?.name;
  const agency = all.find((o) => typesOf(o).some((t) => t === "realestateagent"));
  const description = str(listing.description);
  const images = ([] as unknown[])
    .concat(listing.image ?? [])
    .map((i) => (typeof i === "string" ? i : typeof i === "object" && i ? ((i as Obj).contentUrl ?? (i as Obj).url) : null))
    .filter((i): i is string => typeof i === "string" && /^https?:\/\//.test(i));
  return {
    title: str(listing.name),
    location: addressOf(pick("address")),
    price,
    pairs,
    description: description && description.length > 40 ? description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : null,
    images,
    agencyName: str(agency?.name) ?? str(seller),
    sellerName: str(seller),
  };
}
