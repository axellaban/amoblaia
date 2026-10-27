// From what a listing page publishes to the demo's data, with the state of
// each field: found, not published, not extracted (the page has the section
// but nothing could be read) or contradictory. Pure: no network, no database.
import { DEFAULT_SETTINGS, type AmenityGroup, type DemoSettings, type Fact, type FactIcon, type MapSettings } from "./branding";
import { placesOf, sourceName } from "./geo";
import { norm, type ListingDetails } from "./listing-details";

export type FieldStatus = "found" | "missing" | "error" | "conflict";
export type ReportRow = {
  field: string;
  status: FieldStatus;
  value: string | null;
  /** Where it was read, or why it is missing. */
  note: string | null;
  /** Without it the demo cannot be shared: asks for intervention. */
  required: boolean;
};
export type ImportedDemo = {
  /** The property's id on the agency's site; its own photo files start with it. */
  propertyId: string | null;
  title: string;
  location: string | null;
  propertyType: "residential" | "office";
  operation: string | null;
  reference: string | null;
  price: string | null;
  priceConflict: string | null;
  /** When the price conflicts: the amounts to choose from, as published. */
  priceOptions: string[];
  /** Monthly expenses as published (a bare amount is in pesos). */
  expenses: string | null;
  features: string | null;
  facts: Fact[];
  description: string | null;
  amenities: AmenityGroup[];
  map: MapSettings | null;
  /** found: saved as is. review: shown, saved only once confirmed. none: not on the page. */
  mapStatus: "found" | "review" | "none";
  /** Why the map needs a look, or why it was not found. */
  mapNote: string | null;
  /** Places to choose from when the map needs a review. */
  mapPlaces: { lat: number; lng: number; source: MapSettings["source"]; radius: number | null }[];
  agent: { name: string; role: null; whatsapp: string | null; phone: string | null; email: string | null; photoUrl: string | null } | null;
  agency: {
    name: string | null;
    website: string;
    logoUrl: string | null;
    whatsapp: string | null;
    phone: string | null;
    email: string | null;
  };
  images: string[];
  report: ReportRow[];
};

/** Labels as sites publish them → the fact they are. First match wins. */
const FACTS: { icon: FactIcon; labels: RegExp; label: (v: string) => string }[] = [
  { icon: "area", labels: /^(total construido|superficie total|sup\. total|total|superficie terreno\/total|superficie total\/terreno)$/, label: () => "totales" },
  // Century 21 calls the covered area "Superficie Construcción".
  { icon: "area", labels: /^(superficie cubierta|cubierta|sup\. cubierta|superficie construccion|superficie construida)$/, label: () => "cubiertos" },
  { icon: "area", labels: /^(superficie semicubierta|semicubierta|sup\. semicubierta)$/, label: () => "semicubiertos" },
  { icon: "rooms", labels: /^(ambientes|cantidad de ambientes)$/, label: (v) => (v === "1" ? "ambiente" : "ambientes") },
  { icon: "bedrooms", labels: /^(dormitorios|dormitorios totales|cantidad de dormitorios)$/, label: (v) => (v === "1" ? "dormitorio" : "dormitorios") },
  { icon: "bathrooms", labels: /^(banos|banos completos|cantidad de banos)$/, label: (v) => (v === "1" ? "baño" : "baños") },
  { icon: "bathrooms", labels: /^toilettes?$/, label: (v) => (v === "1" ? "toilette" : "toilettes") },
  { icon: "parking", labels: /^(cocheras?|cantidad de cocheras)$/, label: (v) => (v === "1" ? "cochera" : "cocheras") },
  { icon: "floor", labels: /^(piso en que se encuentra|piso del departamento|ubicacion en el piso)$/, label: () => "piso" },
  { icon: "age", labels: /^antiguedad$/, label: () => "antigüedad" },
];
/** An area published as a bare number ("119,9") is in square meters. */
const withUnit = (icon: FactIcon, v: string) => (icon === "area" && /^\d+(?:[.,]\d+)?$/.test(v.trim()) ? `${v.trim()} m²` : v);
/** General data worth showing as text (not icons); "No especificado" is not data. */
const INFO = /^(condicion|situacion|orientacion|disposicion|apto profesional|apto credito|credito|plantas|piso|luminosidad|estado)$/;
const UNSPECIFIED = /^(no especificado|-|n\/a|sin datos?)$/i;

const lowerFirst = (s: string) => s.replace(/^(\p{Lu})(\p{Ll})/u, (_m, a: string, b: string) => a.toLowerCase() + b);

export type Fallback = {
  title: string;
  location: string | null;
  description: string | null;
  /** Amounts in the page's price elements, when the details found no price. */
  prices: string[];
  images: string[];
  agencyName: string;
  website: string;
};

/** The page has a location section but its map is drawn later by the browser (or not at all). */
const NO_MAP_IN_HTML =
  "La ficha tiene una sección de ubicación, pero el mapa no está en el código de la página (se carga después). Pegá el enlace del mapa o las coordenadas.";

const PRECISION_NAMES = { zone: "zona", approx: "ubicación aproximada", exact: "ubicación exacta", none: "sin mapa" } as const;
function mapRow(d: ListingDetails): ReportRow {
  const map = d.map;
  const value = map
    ? `${PRECISION_NAMES[map.precision]}${map.radius ? ` (${map.radius} m)` : ""} · ${sourceName(map.source)}`
    : null;
  if (d.geo.status === "review")
    return { field: "Mapa", status: "conflict", value, note: d.geo.note, required: false };
  if (map) return { field: "Mapa", status: "found", value, note: null, required: false };
  const section = d.headings.some((h) => /^(ubicaci|mapa)/i.test(h));
  return {
    field: "Mapa",
    status: section ? "error" : "missing",
    value: null,
    note: d.geo.note ?? (section ? NO_MAP_IN_HTML : "No figura en la publicación."),
    required: false,
  };
}

export function toDemo(d: ListingDetails, fallback: Fallback): ImportedDemo {
  const value = (re: RegExp) => d.pairs.find((p) => re.test(norm(p.label)) && !UNSPECIFIED.test(p.value))?.value ?? null;
  const facts: Fact[] = [];
  for (const f of FACTS) {
    const v = value(f.labels);
    // One fact per kind of area/count: the first label that matches wins.
    if (v && facts.length < 8 && !facts.some((x) => x.label === f.label(v) && x.icon === f.icon))
      facts.push({ icon: f.icon, value: withUnit(f.icon, v), label: f.label(v) });
  }
  const amb = value(/^(ambientes|cantidad de ambientes)$/);
  const totalRaw = value(/^(total construido|superficie total|superficie terreno\/total)$/) ?? value(/^(superficie cubierta|cubierta|superficie construccion)$/);
  const total = totalRaw ? withUnit("area", totalRaw) : null;
  const dorm = value(/^(dormitorios|dormitorios totales)$/);
  const features = [amb && `${amb} ${amb === "1" ? "ambiente" : "ambientes"}`, total, dorm && `${dorm} ${dorm === "1" ? "dormitorio" : "dormitorios"}`]
    .filter(Boolean)
    .join(" · ");
  const expensesRaw = value(/^(expensas|expensas mensuales|valor de expensas)$/);
  // "350.000" with no currency: expenses in Argentina are in pesos.
  const expenses = expensesRaw ? (/^\d{1,3}(?:[.,]\d{3})+$|^\d+$/.test(expensesRaw.trim()) ? `$ ${expensesRaw.trim()}` : expensesRaw) : null;
  // Same label, different values on the page: a real contradiction.
  const contradictions = new Map<string, Set<string>>();
  // Only the property's own data: phones and e-mails of the agent and the branch differ by nature.
  for (const p of d.pairs.filter((x) => FACTS.some((f) => f.labels.test(norm(x.label))) || INFO.test(norm(x.label)))) {
    const k = norm(p.label).replace(/^superficie /, "");
    if (!contradictions.has(k)) contradictions.set(k, new Set());
    contradictions.get(k)!.add(p.value.toLowerCase());
  }
  const info = [
    ...new Map(
      d.pairs
        .filter((p) => INFO.test(norm(p.label)) && !UNSPECIFIED.test(p.value))
        .map((p) => [norm(p.label), `${p.label}: ${lowerFirst(p.value)}`]),
    ).values(),
  ];
  const amenities: AmenityGroup[] = [
    ...(info.length ? [{ title: "Información general", items: info }] : []),
    ...d.features.map((g) => ({ title: g.title, items: [...new Set(g.items)] })),
  ].slice(0, 4);
  const office = /oficina|consultorio|local/i.test(d.propertyKind ?? "");
  const has = (re: RegExp) => d.headings.some((h) => re.test(h));
  const row = (field: string, v: string | null | undefined, opts: { required?: boolean; note?: string; error?: boolean; conflict?: string | null } = {}): ReportRow => ({
    field,
    status: opts.conflict ? "conflict" : v ? "found" : opts.error ? "error" : "missing",
    value: v ?? null,
    note: opts.conflict ?? (v ? (opts.note ?? null) : opts.error ? "La página tiene esta sección pero no se pudo leer: reintentá o avisá al equipo." : "No figura en la publicación."),
    required: Boolean(opts.required),
  });
  const pairConflicts = [...contradictions].filter(([, vals]) => vals.size > 1).map(([k, vals]) => `${k}: ${[...vals].join(" / ")}`);
  const agent = d.agent?.name
    ? { name: d.agent.name, role: null, whatsapp: d.agent.whatsapp, phone: d.agent.phone, email: d.agent.email, photoUrl: d.agent.photoUrl?.startsWith("https://") ? d.agent.photoUrl : null }
    : null;
  const images = d.images.length ? d.images : fallback.images;
  const description = d.description ?? fallback.description;
  // Without a price element of its own, a single amount in the price area is the price;
  // several are not guessed (they may be extras or other listings).
  const price = d.price?.text ?? (fallback.prices.length === 1 ? fallback.prices[0] : null);
  const priceNote = !price && fallback.prices.length > 1 ? `La página muestra ${fallback.prices.join(", ")} sin indicar cuál es el precio.` : undefined;
  const contact = agent?.whatsapp ?? agent?.phone ?? agent?.email ?? d.agency.whatsapp ?? d.agency.phone ?? d.agency.email;
  const report: ReportRow[] = [
    row("Título", d.shortTitle ?? fallback.title, { required: true }),
    row("Referencia", d.reference),
    row("Tipo de inmueble", d.propertyKind),
    row("Operación", d.operation),
    d.priceConflict
      ? row("Precio", price, { required: true, conflict: `Dos precios distintos en la misma publicación: ${d.priceConflict}. Elegí cuál mostrar.` })
      : priceNote
        ? { field: "Precio", status: "error", value: null, note: priceNote, required: false }
        : row("Precio", price, { error: has(/^precio|^valor/i) }),
    row("Expensas", expenses, { note: expensesRaw && expenses !== expensesRaw ? "La publicación no indica la moneda: se muestran en pesos." : undefined }),
    row("Ubicación", d.location ?? fallback.location),
    mapRow(d),
    row("Superficies", [value(/^(total construido|superficie total|superficie terreno\/total)$/), value(/^(superficie cubierta|cubierta|superficie construccion)$/), value(/^(superficie semicubierta|semicubierta)$/)].filter(Boolean).join(" · ") || null, { error: has(/superficie/i) && !total }),
    row("Ambientes y dormitorios", [amb && `${amb} amb.`, dorm && `${dorm} dorm.`].filter(Boolean).join(" · ") || null),
    row("Baños", [value(/^(banos|banos completos)$/) && `${value(/^(banos|banos completos)$/)} baño`, value(/^toilettes?$/) && `${value(/^toilettes?$/)} toilette`].filter(Boolean).join(" · ") || null),
    row("Descripción", description ? `${description.length} caracteres` : null, { error: !description && has(/^descripci/i) }),
    row("Características y servicios", amenities.length ? amenities.map((g) => `${g.title} (${g.items.length})`).join(" · ") : null),
    row("Fotos de la propiedad", images.length ? `${images.length}` : null, { required: true, note: d.images.length ? "Solo las de esta propiedad, sin las de propiedades similares." : "Revisá que todas sean de esta propiedad." }),
    row("Inmobiliaria", d.agency.name ?? fallback.agencyName),
    row("Logo", d.agency.logoUrl ? decodeURIComponent(d.agency.logoUrl.split(/[?#]/)[0].split("/").pop() ?? "") : null, { note: d.agency.logoUrl ? "Se guarda en la demo si la inmobiliaria no tiene uno." : undefined }),
    row("Agente", agent?.name, { error: !agent && has(/^contacto/i) }),
    row("Email del agente", agent?.email),
    row("WhatsApp del agente", agent?.whatsapp),
    row("Teléfono del agente", agent?.phone),
    row("Contacto para consultas", contact, { required: true }),
    ...(pairConflicts.length ? [row("Datos de la ficha", null, { conflict: `La página muestra valores distintos: ${pairConflicts.join("; ")}` })] : []),
  ];
  return {
    propertyId: d.propertyId,
    title: d.shortTitle ?? fallback.title,
    location: d.location ?? fallback.location,
    propertyType: office ? "office" : "residential",
    operation: d.operation,
    reference: d.reference,
    price,
    priceConflict: d.priceConflict,
    priceOptions: d.priceOptions,
    expenses,
    features: features || null,
    facts,
    description,
    amenities,
    map: d.map ? { precision: d.map.precision, lat: d.map.lat, lng: d.map.lng, radius: d.map.radius, source: d.map.source } : null,
    mapStatus: d.geo.status,
    mapPlaces: d.geo.status === "review" ? placesOf(d.geo) : [],
    mapNote: d.geo.note ?? (d.geo.status === "none" && has(/^(ubicaci|mapa)/i) ? NO_MAP_IN_HTML : null),
    agent,
    agency: {
      name: d.agency.name,
      website: fallback.website,
      logoUrl: d.agency.logoUrl,
      whatsapp: d.agency.whatsapp,
      phone: d.agency.phone,
      email: d.agency.email,
    },
    images,
    report,
  };
}

/** What a (re)import can write. Photos and the agency's logo and contact go apart. */
export const IMPORT_FIELDS = [
  "title",
  "location",
  "propertyType",
  "operation",
  "reference",
  "price",
  "expenses",
  "features",
  "facts",
  "description",
  "amenities",
  "map",
  "agent",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
const FIELD_LABELS: Record<ImportField, string> = {
  title: "Título",
  location: "Ubicación",
  propertyType: "Tipo de inmueble",
  operation: "Operación",
  reference: "Referencia",
  price: "Precio",
  expenses: "Expensas",
  features: "Resumen",
  facts: "Datos principales",
  description: "Descripción",
  amenities: "Características y servicios",
  map: "Mapa",
  agent: "Agente",
};
export type ImportChange = { field: ImportField; label: string; current: string; imported: string };
export type CurrentDemo = {
  title: string;
  location: string | null;
  settings: DemoSettings;
  /** What the previous automatic reading produced: equal values were never edited by hand. */
  generated: { title: string | null; location: string | null; description: string | null };
};
type Values = DemoSettings & { title: string; location: string | null };

const PRECISION = { none: "sin mapa", zone: "zona", approx: "aproximada", exact: "exacta" } as const;
const clip = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
function shown(field: ImportField, v: Values): string {
  switch (field) {
    case "propertyType":
      return v.propertyType === "office" ? "Oficina o local" : "Vivienda";
    case "price":
      return v.priceConflict ? `Consultar precio (${v.priceConflict})` : (v.price ?? "—");
    case "facts":
      return v.facts.map((f) => `${f.value} ${f.label}`).join(" · ") || "—";
    case "amenities":
      return v.amenities.map((g) => `${g.title} (${g.items.length})`).join(" · ") || "—";
    case "map":
      return v.map.precision === "none"
        ? "—"
        : `Ubicación ${PRECISION[v.map.precision]}${v.map.source ? ` · ${sourceName(v.map.source)}` : ""}`;
    case "agent":
      return v.agent ? [v.agent.name, v.agent.email, v.agent.whatsapp ?? v.agent.phone].filter(Boolean).join(" · ") : "—";
    case "description":
      return v.description ? clip(v.description.replace(/\s+/g, " ")) : "—";
    default:
      return (v[field] as string | null) || "—";
  }
}
/** The comparable content of a field (formatting differences are not changes). */
function key(field: ImportField, v: Values) {
  // Maps: the same place (to ~100 m) and the same precision is the same map.
  if (field === "map")
    return v.map.precision === "none" ? "none" : `${v.map.precision}:${v.map.lat?.toFixed(3)},${v.map.lng?.toFixed(3)}`;
  const raw = field === "price" ? [v.price, v.priceConflict] : v[field];
  return JSON.stringify(raw ?? null).replace(/\s+/g, " ").toLowerCase();
}
function empty(field: ImportField, v: Values) {
  switch (field) {
    case "title":
      return !v.title.trim();
    case "propertyType":
      // The default: never chosen by hand when the listing says otherwise.
      return v.propertyType === "residential";
    case "price":
      // The old reading marked any second amount (a parking space, a storage room) as a conflict.
      return !v.price && (!v.priceConflict || /^la publicación muestra /.test(v.priceConflict));
    case "facts":
    case "amenities":
      return !v[field].length;
    case "map":
      return v.map.precision === "none";
    default:
      return !v[field];
  }
}
function importedValues(imp: ImportedDemo): Values {
  return {
    ...DEFAULT_SETTINGS,
    title: imp.title,
    location: imp.location,
    propertyType: imp.propertyType,
    operation: imp.operation,
    reference: imp.reference,
    price: imp.priceConflict ? null : imp.price,
    priceConflict: imp.priceConflict,
    expenses: imp.expenses ?? null,
    features: imp.features,
    facts: imp.facts,
    description: imp.description,
    amenities: imp.amenities,
    // A doubtful map (two places, or only where a map was centered) is never taken without a person confirming it.
    map: imp.map && imp.mapStatus === "found" ? imp.map : { precision: "none", lat: null, lng: null, radius: null, source: null },
    agent: imp.agent,
  };
}
const currentValues = (cur: CurrentDemo): Values => ({ ...cur.settings, title: cur.title, location: cur.location });

/**
 * Compares the demo with a new reading of the listing. Empty fields and
 * values the previous reading wrote are filled; a different value someone
 * typed is a conflict the admin decides on before anything is overwritten.
 */
export function planImport(cur: CurrentDemo, imp: ImportedDemo) {
  const now = currentValues(cur);
  const next = importedValues(imp);
  const fill: ImportChange[] = [];
  const conflicts: ImportChange[] = [];
  if (imp.map && imp.mapStatus === "review") {
    const doubtful = { ...next, map: imp.map };
    if (key("map", now) !== key("map", doubtful))
      conflicts.push({ field: "map", label: "Mapa (requiere revisión)", current: shown("map", now), imported: `${shown("map", doubtful)}. ${imp.mapNote ?? ""}`.trim() });
  }
  for (const field of IMPORT_FIELDS) {
    if (empty(field, next) || key(field, now) === key(field, next)) continue;
    const change = { field, label: FIELD_LABELS[field], current: shown(field, now), imported: shown(field, next) };
    const auto =
      (field === "title" && now.title === cur.generated.title) ||
      (field === "location" && now.location === cur.generated.location) ||
      (field === "description" && now.description === cur.generated.description);
    if (empty(field, now) || auto) fill.push(change);
    else conflicts.push(change);
  }
  return { fill, conflicts };
}

/** The demo after taking these fields from the listing. */
export function applyImport(cur: CurrentDemo, imp: ImportedDemo, fields: ImportField[]) {
  const next = importedValues(imp);
  const out = currentValues(cur);
  for (const field of fields) {
    if (empty(field, next)) continue;
    if (field === "price") {
      out.price = next.price;
      out.priceConflict = next.priceConflict;
    } else (out as Record<string, unknown>)[field] = next[field];
  }
  const { title, location, ...settings } = out;
  return { title, location, settings };
}
