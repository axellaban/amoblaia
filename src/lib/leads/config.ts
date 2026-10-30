/**
 * Lead Engagement Score: the only place with its names, weights and
 * thresholds. Changing a weight means a new version (lead_score_v2), so a
 * stored score always says which rules produced it. Pure data, no imports:
 * the backfill script (node --experimental-strip-types) reads it too.
 * See docs/LEAD_SCORE.md.
 */

export const LEAD_SCORE_VERSION = "lead_score_v1";
export const LEAD_EVENT_VERSION = 1;
/** Calendar days for recurrence are counted in this time zone. */
export const LEAD_TIME_ZONE = "America/Argentina/Buenos_Aires";

/** The semantic events the score reads. Anything else is ignored. */
export const LEAD_EVENTS = [
  "demo_opened",
  "demo_style_selected",
  "demo_photo_selected",
  "demo_comparison_used",
  "demo_active_time",
  "demo_agency_cta_clicked",
  "demo_pricing_viewed",
  "demo_signup_started",
  "demo_contact_requested",
  "demo_generation_started",
  "demo_generation_completed",
  "demo_property_import_started",
  "demo_property_import_completed",
  "demo_account_created",
] as const;
export type LeadEventName = (typeof LEAD_EVENTS)[number];

/** What the public demo page may report by itself (the rest is confirmed by the server). */
export const CLIENT_EVENTS: readonly LeadEventName[] = [
  "demo_opened",
  "demo_style_selected",
  "demo_photo_selected",
  "demo_comparison_used",
  "demo_active_time",
  "demo_agency_cta_clicked",
  "demo_pricing_viewed",
  "demo_signup_started",
  "demo_contact_requested",
];
/** Accepted from the browser only from a signed-in member of the demo's agency. */
export const MEMBER_EVENTS: readonly LeadEventName[] = [
  "demo_property_import_started",
  "demo_property_import_completed",
  "demo_account_created",
];
/** Written only by the server, when the backend confirms them (never from the browser). */
export const SERVER_EVENTS: readonly LeadEventName[] = ["demo_generation_started", "demo_generation_completed"];

export const WEIGHTS = {
  visual: {
    max: 20,
    perStyle: 4,
    stylesMax: 8,
    perPhoto: 2,
    photosMax: 6,
    comparison: 6,
  },
  depth: {
    max: 15,
    /** [active seconds reached, points added]: cumulative steps. */
    activeSteps: [
      [30, 3],
      [90, 4],
      [180, 4],
    ] as [number, number][],
    features: 4,
    featuresMin: 2,
  },
  commercial: {
    max: 35,
    agencyCta: 12,
    pricing: 10,
    signup: 8,
    contact: 15,
  },
  activation: {
    max: 25,
    generationStarted: 5,
    generationCompleted: 12,
    importStarted: 6,
    importCompletedOrAccount: 15,
  },
  recurrence: {
    max: 5,
    secondDay: 3,
    thirdDay: 2,
  },
  /** Without any commercial or activation signal, the score stops here. */
  noIntentCap: 39,
} as const;

/** The functionalities "explored" counts (depth): one each, whatever is repeated. */
export const FEATURES = ["style_selection", "photo_navigation", "comparison", "generation", "commercial"] as const;
export type Feature = (typeof FEATURES)[number];
export const FEATURE_LABELS: Record<Feature, string> = {
  style_selection: "selección de estilo",
  photo_navigation: "navegación de fotos",
  comparison: "slider antes/después",
  generation: "generación de imágenes",
  commercial: "consulta comercial",
};

export const CLASSES = [
  { min: 80, label: "Muy caliente", key: "very_hot" },
  { min: 60, label: "Caliente", key: "hot" },
  { min: 40, label: "Tibio", key: "warm" },
  { min: 20, label: "Frío", key: "cold" },
  { min: 0, label: "Muy frío", key: "very_cold" },
] as const;
export type LeadClassKey = (typeof CLASSES)[number]["key"];

export type Identity = "identified" | "linked" | "anonymous";
export type VisitorType = "internal" | "agency" | "buyer" | "unknown";
export type DataQuality = "complete" | "partial" | "insufficient";
export type EventSource = "client" | "server" | "backfill";

/** demo_link_type values (see docs/ANALITICA_DEMOS.md) that reach the agency itself. */
export const AGENCY_LINKS = ["owner_invitation", "presentation_invitation", "presentation_invite_unavailable", "presentation"];
/** Links meant for buyers: the agency's public site or the buyer link. */
export const BUYER_LINKS = ["buyer", "agency_site"];
