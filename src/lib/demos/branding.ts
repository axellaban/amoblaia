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
export type DemoSettings = {
  openMode: OpenMode;
  openStyle: string | null;
  /** Whether the presentation link shows "Demo preparada para… · Por Amobla IA". */
  banner: boolean;
  operation: string | null;
  price: string | null;
  features: string | null;
  reference: string | null;
};
export const DEFAULT_SETTINGS: DemoSettings = {
  openMode: "original",
  openStyle: null,
  banner: true,
  operation: null,
  price: null,
  features: null,
  reference: null,
};

/** The colors of a page without branding: amoblaIA's neutral blue. */
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

export function readSettings(raw: unknown): DemoSettings {
  const v = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const text = (x: unknown, max: number) => cleanText(x, max);
  return {
    openMode: v.openMode === "styled" ? "styled" : "original",
    openStyle: typeof v.openStyle === "string" ? v.openStyle : null,
    banner: v.banner !== false,
    operation: text(v.operation, 40),
    price: text(v.price, 40),
    features: text(v.features, 120),
    reference: text(v.reference, 40),
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
