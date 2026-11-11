// What the site's search and filters read from each property's card:
// operation, type, rooms and price, taken from the texts the listing
// already publishes (title, features, price). Pure.
import type { SiteProperty } from "@/lib/agency/site";

export type Operation = "venta" | "alquiler" | "temporario";
export type PropertyKind = "departamento" | "casa" | "ph" | "local" | "oficina" | "terreno" | "cochera" | "galpon" | "campo";
export const KIND_LABELS: Record<PropertyKind, string> = {
  departamento: "Departamento",
  casa: "Casa",
  ph: "PH",
  local: "Local",
  oficina: "Oficina",
  terreno: "Terreno / lote",
  cochera: "Cochera",
  galpon: "Galpón / depósito",
  campo: "Campo / chacra",
};
export const OPERATION_LABELS: Record<Operation, string> = { venta: "Venta", alquiler: "Alquiler", temporario: "Alquiler temporario" };

export type Facets = {
  operation: Operation | null;
  kind: PropertyKind | null;
  rooms: number | null;
  currency: "USD" | "ARS" | null;
  amount: number | null;
  text: string;
};

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function operationOf(v: string | null | undefined): Operation | null {
  const s = fold(v ?? "");
  if (!s) return null;
  if (/temporar|temporal/.test(s)) return "temporario";
  if (/alquil|renta|locaci/.test(s)) return "alquiler";
  if (/venta|vende/.test(s)) return "venta";
  return null;
}

export function kindOf(text: string): PropertyKind | null {
  const s = fold(text);
  if (/\bph\b/.test(s)) return "ph";
  if (/depart|depto|dpto|monoambiente|loft|duplex|semipiso|piso\b/.test(s)) return "departamento";
  if (/\bcasa|chalet|quinta|cabana/.test(s)) return "casa";
  if (/\blocal|comercial/.test(s)) return "local";
  if (/oficina|consultorio/.test(s)) return "oficina";
  if (/terreno|\blote/.test(s)) return "terreno";
  if (/cochera|garage|garaje/.test(s)) return "cochera";
  if (/galpon|deposito|nave/.test(s)) return "galpon";
  if (/campo|chacra|hectarea/.test(s)) return "campo";
  return null;
}

export function priceOf(v: string | null | undefined): { currency: "USD" | "ARS" | null; amount: number | null } {
  const s = (v ?? "").replace(/\s+/g, " ");
  const m = /(u\$s|us\$|usd|u\$d|dolares|\$|ars|pesos)?\s*([\d][\d.,]*)\s*(usd|u\$s|dolares|ars|pesos)?/i.exec(s);
  if (!m) return { currency: null, amount: null };
  const tag = fold(`${m[1] ?? ""}${m[3] ?? ""}`);
  const currency = /u|d/.test(tag) && !/pesos|ars/.test(tag) ? "USD" : tag ? "ARS" : null;
  // 120.000 / 120,000 / 1.250.000,50 → whole units.
  const digits = m[2]!.replace(/[.,](\d{1,2})$/, "").replace(/[.,]/g, "");
  const amount = Number(digits);
  return { currency, amount: Number.isFinite(amount) && amount > 0 ? amount : null };
}

export function facetsOf(p: SiteProperty): Facets {
  const all = `${p.title} ${p.features ?? ""}`;
  const amb = /(\d{1,2})\s*amb/i.exec(all);
  const dorms = /(\d{1,2})\s*dorm/i.exec(all);
  return {
    operation: operationOf(p.operation),
    kind: kindOf(all),
    // Ambientes; with only bedrooms, one more (the living).
    rooms: amb ? Number(amb[1]) : dorms ? Number(dorms[1]) + 1 : /monoambiente/i.test(all) ? 1 : null,
    ...priceOf(p.price),
    text: fold(`${p.title} ${p.location ?? ""} ${p.features ?? ""} ${p.operation ?? ""}`),
  };
}

export type ListingFilters = {
  q: string;
  op: Operation | "";
  kind: PropertyKind | "";
  rooms: number;
  currency: "USD" | "ARS" | "";
  min: number | null;
  max: number | null;
  sort: "recent" | "price-asc" | "price-desc";
};
export const NO_FILTERS: ListingFilters = { q: "", op: "", kind: "", rooms: 0, currency: "", min: null, max: null, sort: "recent" };

export function filterProperties(list: SiteProperty[], f: ListingFilters): SiteProperty[] {
  const words = fold(f.q).split(/\s+/).filter(Boolean);
  const rows = list
    .map((p, i) => ({ p, i, x: facetsOf(p) }))
    .filter(({ x }) => !f.op || x.operation === f.op)
    .filter(({ x }) => !f.kind || x.kind === f.kind)
    .filter(({ x }) => !f.rooms || (x.rooms !== null && (f.rooms >= 4 ? x.rooms >= 4 : x.rooms === f.rooms)))
    .filter(({ x }) => !f.currency || x.currency === f.currency)
    .filter(({ x }) => f.min === null || (x.amount !== null && x.amount >= f.min))
    .filter(({ x }) => f.max === null || (x.amount !== null && x.amount <= f.max))
    .filter(({ x }) => words.every((w) => x.text.includes(w)));
  if (f.sort !== "recent")
    rows.sort((a, b) => {
      // Without a price, last.
      if (a.x.amount === null) return 1;
      if (b.x.amount === null) return -1;
      return f.sort === "price-asc" ? a.x.amount - b.x.amount : b.x.amount - a.x.amount;
    });
  return rows.map((r) => r.p);
}

/** The filters in the address (?q=&op=&tipo=&amb=), as the site's search sends them. */
export function filtersFromQuery(params: URLSearchParams): ListingFilters {
  const op = params.get("op");
  const kind = params.get("tipo");
  const rooms = Number(params.get("amb") ?? 0);
  return {
    ...NO_FILTERS,
    q: (params.get("q") ?? "").slice(0, 80),
    op: op === "venta" || op === "alquiler" || op === "temporario" ? op : "",
    kind: kind && kind in KIND_LABELS ? (kind as PropertyKind) : "",
    rooms: Number.isInteger(rooms) && rooms > 0 && rooms <= 4 ? rooms : 0,
  };
}
export function queryOf(f: Partial<ListingFilters>): string {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.op) p.set("op", f.op);
  if (f.kind) p.set("tipo", f.kind);
  if (f.rooms) p.set("amb", String(f.rooms));
  const s = p.toString();
  return s ? `?${s}` : "";
}
