// The agency's identity and contact, and each demo's private settings
// (opening mode, presentation strip, listing data). Pure and safe for the
// browser; the panel's input validation lives in input.ts.
import { cleanText, cleanUrl } from "./shared";

export const CONTACT_KINDS = ["whatsapp", "url", "phone", "email"] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];
export const TITLE_FONTS = ["sans", "serif"] as const;
export type TitleFont = (typeof TITLE_FONTS)[number];

/** Stored in agencies.branding. The logo stays server-side; pages get its URL. */
export type AgencyBranding = {
  logo?: { type: string; data: string; v: string };
  primary?: string;
  accent?: string;
  titleFont?: TitleFont;
  contactKind?: ContactKind;
  contactValue?: string;
  visitUrl?: string;
};
export type OpenMode = "original" | "styled";
/** Stored in demos.settings. Private: the buyer's page only gets their effect. */
/** Icons of the key facts, chosen per property (no empty or invented fields). */
export const FACT_ICONS = ["area", "rooms", "bedrooms", "offices", "bathrooms", "floor", "parking", "age", "other"] as const;
export type FactIcon = (typeof FACT_ICONS)[number];
export type Fact = { icon: FactIcon; value: string; label: string };
export type AmenityGroup = { title: string; items: string[] };
/** How precise the published location is: the map never shows more. */
export type MapPrecision = "none" | "zone" | "approx" | "exact";
/** Where the map's coordinates came from: what the listing published, or a person. */
export const MAP_SOURCES = [
  "json-ld",
  "meta",
  "leaflet-circle",
  "leaflet-marker",
  "google-latlng",
  "data-attribute",
  "lat-lng-object",
  "map-link",
  "map-view",
  "manual",
] as const;
export type MapSource = (typeof MAP_SOURCES)[number];
export type MapSettings = {
  precision: MapPrecision;
  lat: number | null;
  lng: number | null;
  /** Meters of the area the listing draws, when it draws one. */
  radius: number | null;
  source: MapSource | null;
};
export type Agent = {
  name: string;
  role: string | null;
  whatsapp: string | null;
  phone: string | null;
  email: string | null;
  photoUrl: string | null;
};
/** Stored in demos.settings. Private: the buyer's page only gets their effect. */
export type DemoSettings = {
  propertyType: "residential" | "office";
  openMode: OpenMode;
  openStyle: string | null;
  /** Whether the presentation link shows "Demo preparada para… · Por habita.". */
  banner: boolean;
  operation: string | null;
  /** As published, with its currency. Shown only when confirmed (no conflict). */
  price: string | null;
  /** Private note: the listing shows different prices. The page then invites to ask. */
  priceConflict: string | null;
  expenses: string | null;
  availability: string | null;
  requirements: string | null;
  features: string | null;
  reference: string | null;
  facts: Fact[];
  /** The listing's full description, as published. */
  description: string | null;
  amenities: AmenityGroup[];
  map: MapSettings;
  agent: Agent | null;
  closingTitle: string | null;
  closingText: string | null;
  shareTitle: string | null;
  shareDescription: string | null;
  /** When the admin last checked the demo against the listing (ISO date). */
  reviewedAt: string | null;
};
export const DEFAULT_SETTINGS: DemoSettings = {
  propertyType: "residential",
  // Recommended: the ficha opens with the main style. A null openStyle means that style.
  openMode: "styled",
  openStyle: null,
  banner: true,
  operation: null,
  price: null,
  priceConflict: null,
  expenses: null,
  availability: null,
  requirements: null,
  features: null,
  reference: null,
  facts: [],
  description: null,
  amenities: [],
  map: { precision: "none", lat: null, lng: null, radius: null, source: null },
  agent: null,
  closingTitle: null,
  closingText: null,
  shareTitle: null,
  shareDescription: null,
  reviewedAt: null,
};

/** The colors of a page without branding: the neutral blue of habita. */
export const DEFAULT_PRIMARY = "#1f3a5f";
export const DEFAULT_ACCENT = "#6f8f5a";
const HEX = /^#[0-9a-f]{6}$/i;
export const color = (v: unknown) => (typeof v === "string" && HEX.test(v.trim()) ? v.trim().toLowerCase() : undefined);

/** Readable text on a background color (WCAG relative luminance). */
export function textOn(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? "#161b26" : "#ffffff";
}

export function readBranding(raw: unknown): AgencyBranding {
  const v = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const logo = v.logo as AgencyBranding["logo"] | undefined;
  return {
    logo:
      logo && typeof logo.data === "string" && typeof logo.type === "string" && typeof logo.v === "string"
        ? logo
        : undefined,
    primary: color(v.primary),
    accent: color(v.accent),
    titleFont: TITLE_FONTS.includes(v.titleFont as TitleFont) ? (v.titleFont as TitleFont) : undefined,
    contactKind: CONTACT_KINDS.includes(v.contactKind as ContactKind) ? (v.contactKind as ContactKind) : undefined,
    contactValue: typeof v.contactValue === "string" ? v.contactValue : undefined,
    visitUrl: typeof v.visitUrl === "string" ? v.visitUrl : undefined,
  };
}

const MAP_PRECISIONS: MapPrecision[] = ["none", "zone", "approx", "exact"];
const list = (v: unknown) => (Array.isArray(v) ? v : []);
const num = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null;

/** Reads stored settings leniently: anything malformed becomes empty, never an error on the page. */
export function readSettings(raw: unknown): DemoSettings {
  const v = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const text = (x: unknown, max: number, multiline = false) => cleanText(x, max, multiline);
  const map = (v.map && typeof v.map === "object" ? v.map : {}) as Record<string, unknown>;
  const agent = (v.agent && typeof v.agent === "object" ? v.agent : null) as Record<string, unknown> | null;
  const agentName = agent ? text(agent.name, 80) : null;
  return {
    propertyType: v.propertyType === "office" ? "office" : "residential",
    openMode: v.openMode === "original" ? "original" : "styled",
    openStyle: typeof v.openStyle === "string" ? v.openStyle : null,
    banner: v.banner !== false,
    operation: text(v.operation, 40),
    price: text(v.price, 40),
    priceConflict: text(v.priceConflict, 200),
    expenses: text(v.expenses, 60),
    availability: text(v.availability, 80),
    requirements: text(v.requirements, 300, true),
    features: text(v.features, 120),
    reference: text(v.reference, 40),
    facts: list(v.facts)
      .map((f) => f as Record<string, unknown>)
      .filter((f) => FACT_ICONS.includes(f?.icon as FactIcon) && cleanText(f.value, 30))
      .slice(0, 8)
      .map((f) => ({ icon: f.icon as FactIcon, value: cleanText(f.value, 30)!, label: cleanText(f.label, 40) ?? "" })),
    description: text(v.description, 6000, true),
    amenities: list(v.amenities)
      .map((g) => g as Record<string, unknown>)
      .map((g) => ({
        title: cleanText(g?.title, 40) ?? "",
        items: list(g?.items)
          .map((i) => cleanText(i, 80))
          .filter((i): i is string => Boolean(i))
          .slice(0, 40),
      }))
      .filter((g) => g.items.length)
      .slice(0, 4),
    map: {
      precision: MAP_PRECISIONS.includes(map.precision as MapPrecision) ? (map.precision as MapPrecision) : "none",
      lat: num(map.lat, -90, 90),
      lng: num(map.lng, -180, 180),
      radius: num(map.radius, 50, 5000),
      source: MAP_SOURCES.includes(map.source as MapSource) ? (map.source as MapSource) : null,
    },
    agent: agentName
      ? {
          name: agentName,
          role: text(agent!.role, 60),
          whatsapp: text(agent!.whatsapp, 30),
          phone: text(agent!.phone, 30),
          email: text(agent!.email, 120),
          photoUrl: typeof agent!.photoUrl === "string" && /^https:\/\//.test(agent!.photoUrl) ? agent!.photoUrl : null,
        }
      : null,
    closingTitle: text(v.closingTitle, 80),
    closingText: text(v.closingText, 160),
    shareTitle: text(v.shareTitle, 90),
    shareDescription: text(v.shareDescription, 200),
    reviewedAt: typeof v.reviewedAt === "string" && !Number.isNaN(Date.parse(v.reviewedAt)) ? v.reviewedAt : null,
  };
}

/** WhatsApp numbers as wa.me wants them: digits with country code. */
export function whatsappNumber(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

/** Where "Consultar a …" leads; the message is only prepared, the buyer sends it. */
export function contactHref(
  branding: AgencyBranding,
  listing: { title: string; reference: string | null; url: string },
) {
  const value = branding.contactValue;
  if (!value || !branding.contactKind) return null;
  const ref = listing.reference ? ` (ref. ${listing.reference})` : "";
  const message = `Hola! Quiero consultar por "${listing.title}"${ref}: ${listing.url}`;
  switch (branding.contactKind) {
    case "whatsapp": {
      const n = whatsappNumber(value);
      return n ? `https://wa.me/${n}?text=${encodeURIComponent(message)}` : null;
    }
    case "url":
      return cleanUrl(value) || null;
    case "phone":
      return `tel:${value.replace(/[^\d+]/g, "")}`;
    case "email":
      return `mailto:${value}?subject=${encodeURIComponent(`Consulta: ${listing.title}${ref}`)}&body=${encodeURIComponent(message)}`;
  }
}
