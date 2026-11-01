// Shared shapes of the listing importer: what a platform extractor finds and
// the diagnosis the preview shows (never secrets nor the raw URL in analytics).
import type { Money, Pair } from "@/lib/demos/listing-details";

export const PLATFORMS = [
  "tokko",
  "tokko_api",
  "inmobiliatica",
  "wasi",
  "tecnogestion",
  "houzez",
  "elementor",
  "wordpress",
  "next_rsc",
  "next_tokko",
  "argenprop",
  "zonaprop",
  "generic",
] as const;
export type PlatformId = (typeof PLATFORMS)[number];

export const PLATFORM_NAMES: Record<PlatformId, string> = {
  tokko: "Tokko Broker",
  tokko_api: "Web propia con datos de Tokko",
  inmobiliatica: "Inmobiliatica",
  wasi: "Wasi",
  tecnogestion: "Tecnogestión",
  houzez: "WordPress + Houzez",
  elementor: "WordPress + Elementor",
  wordpress: "WordPress",
  next_rsc: "Next.js",
  next_tokko: "Next.js con datos de Tokko",
  argenprop: "Argenprop",
  zonaprop: "Zonaprop",
  generic: "Sitio propio",
};

/** What one source (a platform's template, JSON-LD, the generic reading) says about the property. Absent = not found. */
export type Extracted = {
  title?: string | null;
  location?: string | null;
  price?: Money | null;
  /** The page says "Consultar precio" (or similar) instead of an amount. */
  priceOnRequest?: boolean;
  operation?: string | null;
  propertyKind?: string | null;
  reference?: string | null;
  description?: string | null;
  pairs?: Pair[];
  images?: string[];
  agencyName?: string | null;
};

export type Strategy = "direct_http" | "render_provider" | "fixture";

/** How the page was read and what came out of it: shown on the preview, sent (without URL) to analytics. */
export type ImportDiagnostics = {
  platform: PlatformId;
  platformName: string;
  strategy: Strategy;
  /** Render service used, when one was (its id, never credentials). */
  provider: string | null;
  durationMs: number | null;
  charset: string | null;
  photosFound: number;
  /** Where each main field came from: platform template, JSON-LD or the generic reading. */
  sources: Partial<Record<"title" | "location" | "price" | "operation" | "description" | "images", "platform" | "structured" | "generic">>;
  missing: string[];
  /** Values that disagree between sources (the more specific one was kept). */
  conflicts: string[];
  priceStatus: "published" | "on_request" | "not_found";
  notes: string[];
};
