// Commercial demos: types, texts and helpers shared by the admin panel, the
// server routes and the public page. Nothing here reads secrets.
import { modes, rooms } from "@/lib/catalog";
import { demoStyleName, demoStyleOrder } from "./styles";

export const DEMO_MODES = ["furnish", "redesign"] as const;
export type DemoMode = (typeof DEMO_MODES)[number];

export const DEMO_TEXT = {
  headline: "Descubrí cómo podría verse esta propiedad con ambientación virtual",
  disclaimer:
    "Ambientación virtual realizada con inteligencia artificial. Las imágenes son ilustrativas y los muebles representados no necesariamente están incluidos en la propiedad.",
  badge: "Ambientación virtual con IA",
  original: "Foto original",
  ctaTitle: "¿Querés hacer esto con tus propiedades?",
  ctaBody:
    "Transformá fotografías de inmuebles vacíos en espacios ambientados profesionalmente con inteligencia artificial.",
  ctaButton: "Probar habita.",
} as const;

/** Display widths offered by the image routes; anything else is rounded up. */
export const IMAGE_WIDTHS = [480, 960, 1600, 2048] as const;
export function imageWidth(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 1600;
  return IMAGE_WIDTHS.find((w) => w >= n) ?? 2048;
}

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,64}$/;
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string =>
  typeof v === "string" && UUID_PATTERN.test(v);

/** Most styles a demo offers; each one is one more image per photo to stage and review. */
export const MAX_DEMO_STYLES = 6;

/** One staged version of a photo, in one style. `v` changes when the version does, so caches refresh. */
export type PhotoVersion = { style: string; v: string };
export type PublicPhoto = {
  id: string;
  label: string;
  /** Staged versions, in the demo's style order. Empty: the photo is shown as is. */
  versions: PhotoVersion[];
};
export type StyleOption = { id: string; name: string };
/** The agency as its buyers see it: identity and public contact only. */
export type PublicAgency = {
  name: string;
  website: string | null;
  /** Versioned URL of the logo, or null to show the name. */
  logo: string | null;
  primary: string;
  accent: string;
  titleFont: "sans" | "serif";
  contact: { kind: "whatsapp" | "url" | "phone" | "email"; value: string } | null;
  visitUrl: string | null;
};
/**
 * Exactly what the public page receives: no internal notes, contact person,
 * settings or ids of other entities. Listing data shows only when entered.
 */
export type PublicDemo = {
  id: string;
  agencyId: string;
  agencyName: string;
  agency: PublicAgency;
  title: string;
  location: string | null;
  /** The full description as published (falls back to the short one). */
  description: string | null;
  listingUrl: string | null;
  propertyType: "residential" | "office";
  operation: string | null;
  /** Null when not confirmed (missing or contradictory): the page invites to ask. */
  price: string | null;
  expenses: string | null;
  availability: string | null;
  requirements: string | null;
  features: string | null;
  reference: string | null;
  facts: import("./branding").Fact[];
  amenities: import("./branding").AmenityGroup[];
  /** Coordinates rounded to the published precision; null without a verified location. */
  /** Rounded to its precision (a zone to ~1 km): never the exact point when the agency chose an area. */
  map: { precision: "zone" | "approx" | "exact"; lat: number; lng: number; radius: number | null } | null;
  agent: { name: string; role: string | null; photoUrl: string | null; initials: string } | null;
  /** Where inquiries go, already resolved (agent first, then the agency). */
  contact: {
    whatsapp: string | null;
    phone: string | null;
    email: string | null;
    url: string | null;
  };
  closingTitle: string;
  closingText: string | null;
  /** Styles with at least one staged photo; the first is the main one (cover and link preview). */
  styles: StyleOption[];
  cover: PublicPhoto | null;
  photos: PublicPhoto[];
  /** The style the first photo opens in (opening mode B), only when it really has that version. */
  openStyle: string | null;
  /** The presentation link may show "Demo preparada para…"; the buyers' link never does. */
  banner: boolean;
  share: { title: string | null; description: string | null };
  /** Prepared by the team for an agency without a habita account: its presentation link invites it to create one. */
  prospect: boolean;
};

export type DemoStatus = "draft" | "published";
export type DemoSummary = {
  id: string;
  token: string;
  status: DemoStatus;
  title: string;
  agencyId: string;
  agencyName: string;
  /** Whether the agency already has its habita account (null: unknown). */
  agencyClaimed: boolean | null;
  propertyTitle: string;
  /** "fotos": imported photos that are not a ficha yet (cannot be published). Absent: a ficha. */
  kind?: "ficha" | "fotos";
  photos: number;
  staged: number;
  coverPhotoId: string | null;
  /** What the link preview shows: the chosen cover, else the first staged or first visible photo. */
  cover: { id: string; version: PhotoVersion | null } | null;
  createdAt: string;
  publishedAt: string | null;
};
export type AgencyRow = {
  id: string;
  name: string;
  website: string | null;
  contact_name: string | null;
  notes: string | null;
};
export type GenerationRow = {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "needs_review";
  style: string;
  mode: string;
  room: string;
  created_at: string;
  error_code: string | null;
};
/** Kinds of space: the catalog's rooms (they can be staged) plus a few that are shown as they are. */
export const EXTRA_SPACE_TYPES = [
  { id: "bathroom", name: "Baño" },
  { id: "exterior", name: "Exterior o fachada" },
  { id: "other", name: "Otro" },
] as const;
export const SPACE_TYPES: { id: string; name: string }[] = [...rooms.map((r) => ({ id: r.id, name: r.name })), ...EXTRA_SPACE_TYPES];
export const spaceTypeName = (id: string) => SPACE_TYPES.find((t) => t.id === id)?.name ?? "Otro";
/** A space whose kind is a catalog room expects its photos to be staged as that room. */
export const stagingRoomOf = (roomType: string) => (rooms.some((r) => r.id === roomType) ? roomType : null);
export type PropertySpace = { id: string; name: string; roomType: string; position: number };

export type EditorPhoto = {
  id: string;
  /** The space it belongs to; null: "Sin organizar". */
  spaceId: string | null;
  projectId: string;
  position: number;
  visible: boolean;
  room: string;
  label: string | null;
  mode: DemoMode;
  discarded: string[];
  /** The file name it was imported or uploaded with (listing photos carry the property's id). */
  source: string | null;
  /** Already paid with a credit: further versions of it cost nothing. */
  charged: boolean;
  /** The version each style shows, by style id: a generation id. */
  shown: Record<string, string>;
  generations: GenerationRow[];
};
export type DemoDetail = {
  demo: DemoSummary;
  agency: AgencyRow;
  property: {
    id: string;
    title: string;
    location: string | null;
    listing_url: string | null;
    description: string | null;
  };
  photos: EditorPhoto[];
  /** Styles with a staged version, main one first. */
  styles: string[];
  mainStyle: string;
  branding: Omit<import("./branding").AgencyBranding, "logo"> & { logo: string | null };
  settings: import("./branding").DemoSettings;
  /** False until migration 202610270001_demo_branding.sql is applied: branding and settings cannot be saved. */
  settingsReady: boolean;
  /** Private: what to check or complete before sharing. */
  warnings: string[];
  /** The property's spaces, in order. */
  spaces: PropertySpace[];
  /** False until migration 202610310001_property_spaces.sql is applied: spaces cannot be saved. */
  spacesReady: boolean;
  /**
   * Who pays new versions and whether this account may create them here,
   * with the same rule the quote and the reservation apply.
   */
  staging?: { payer: "team" | "agency"; blocked: string | null };
  /** Who opened the shared link. Private: the agency never sees the viewers. */
  access: DemoAccess;
};

/** A visitor of a shared demo: a signed-in account, or a browser without one. */
export type DemoViewer = {
  /** "team": an admin account, its visits are not the buyers'. */
  kind: "team" | "account" | "visitor";
  /** The account's e-mail, or "Visitante N" (by first visit) for a browser without an account. */
  label: string;
  views: number;
  firstAt: string;
  lastAt: string;
};
export type DemoAccess = {
  /** False until migration 202611050001_demo_views.sql is applied. */
  ready: boolean;
  /** Visitors who are not the team. */
  people: number;
  /** The last visit by someone who is not the team, or null. */
  lastAt: string | null;
  /** Newest first. */
  viewers: DemoViewer[];
};
export type DemoViewRow = {
  visitor: string;
  user_id: string | null;
  viewer_email: string | null;
  views: number;
  first_viewed_at: string;
  last_viewed_at: string;
};

/**
 * The viewers of a demo, newest first. `isTeam` tells the team's accounts
 * apart, so the team's own visits are shown but never counted as people.
 */
export function viewersOf(rows: DemoViewRow[], isTeam: (email: string) => boolean): Omit<DemoAccess, "ready"> {
  const visitorNumber = new Map(
    [...rows]
      .filter((r) => !r.user_id)
      .sort((a, b) => a.first_viewed_at.localeCompare(b.first_viewed_at))
      .map((r, i) => [r.visitor, i + 1]),
  );
  const viewers = [...rows]
    .sort((a, b) => b.last_viewed_at.localeCompare(a.last_viewed_at))
    .map((r): DemoViewer => {
      const team = Boolean(r.viewer_email && isTeam(r.viewer_email));
      const kind = team ? "team" : r.user_id ? "account" : "visitor";
      const label =
        kind === "visitor" ? `Visitante ${visitorNumber.get(r.visitor)}` : (r.viewer_email ?? "Cuenta sin e-mail");
      return { kind, label, views: r.views, firstAt: r.first_viewed_at, lastAt: r.last_viewed_at };
    });
  const people = viewers.filter((v) => v.kind !== "team");
  return { people: people.length, lastAt: people[0]?.lastAt ?? null, viewers };
}

export function roomName(id: string) {
  return rooms.find((r) => r.id === id)?.name ?? "Ambiente";
}
export function styleName(id: string) {
  return demoStyleName(id);
}
export function modeName(id: string) {
  return modes.find((m) => m.id === id)?.name ?? id;
}
type Candidate = {
  id: string;
  style: string;
  status: string;
  result_path: string | null;
  is_free: boolean;
};
/**
 * The version a photo shows in each style: the one approved in that style if
 * it can be delivered, else the newest deliverable one. Discarded and free
 * (watermarked) results never show. `generations` are newest first.
 */
export function shownVersions<G extends Candidate>(
  photo: { approved_generation_id: string | null; discarded: string[] | null },
  generations: G[],
) {
  const discarded = new Set(photo.discarded || []);
  const shown = new Map<string, G>();
  const ok = (g: G) => g.status === "succeeded" && Boolean(g.result_path) && !g.is_free && !discarded.has(g.id);
  const approved = generations.find((g) => g.id === photo.approved_generation_id && ok(g));
  if (approved) shown.set(approved.style, approved);
  for (const g of generations) if (ok(g) && !shown.has(g.style)) shown.set(g.style, g);
  return shown;
}
/** Main style first, then the catalog order; unknown styles are left out. */
export function orderStyles(ids: Iterable<string>, main: string) {
  const set = new Set(ids);
  return demoStyleOrder.filter((id) => set.has(id)).sort((a, b) => Number(b === main) - Number(a === main));
}
type CoverCandidate = { id: string; visible: boolean; versions: PhotoVersion[] };
/** The chosen cover if visible, else the first visible photo staged in the main style, else the first visible. */
export function pickCover<P extends CoverCandidate>(photos: P[], coverId: string | null, main: string) {
  const visible = photos.filter((p) => p.visible);
  return (
    visible.find((x) => x.id === coverId) ??
    visible.find((x) => x.versions.some((v) => v.style === main)) ??
    visible.find((x) => x.versions.length) ??
    visible[0] ??
    null
  );
}
/** The version a cover shows: the main style, else the first one it has. */
export const coverVersion = (photo: { versions: PhotoVersion[] }, main: string) =>
  photo.versions.find((v) => v.style === main) ?? photo.versions[0] ?? null;
export const photoLabel = (p: { label: string | null; room: string }) =>
  p.label?.trim() || roomName(p.room);

/** Trims, collapses whitespace and caps a free-text field; empty becomes null. */
export function cleanText(value: unknown, max: number, multiline = false) {
  if (typeof value !== "string") return null;
  const text = multiline
    ? value.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").trim()
    : value.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
}
/** Accepts an http(s) address with or without scheme; anything else is rejected. */
export function cleanUrl(value: unknown) {
  const text = cleanText(value, 500);
  if (!text) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname.includes("."))
      return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

export const demoPath = (token: string) => `/demo/${token}`;
/** The link for presenting the demo to the agency: it may show the "Demo preparada para…" strip. */
export const PRESENTATION_PARAM = "presentacion";
/** The buyers' link (plain), or the presentation link for the agency. */
export function demoUrl(origin: string, token: string, presentation = false) {
  const url = `${origin.replace(/\/$/, "")}${demoPath(token)}`;
  return presentation ? `${url}?${PRESENTATION_PARAM}=1` : url;
}
/** wa.me opens WhatsApp Web or the app; the recipient needs nothing installed to open the link itself. */
export function whatsappShareUrl(presentationUrl: string, buyersUrl: string, agency: string, title: string) {
  const text = `Hola ${agency}! Preparamos una muestra de cómo podría verse "${title}" con ambientación virtual: ${presentationUrl}\n\nPara compartir con compradores (sin la franja de la demo): ${buyersUrl}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
/** The team's WhatsApp message inviting an agency to its panel, with its one-time link. */
export function invitationWhatsappUrl(link: string, agency: string, title: string) {
  const text = `Hola ${agency}! Les armamos su panel en habita con la demo de "${title}" ya cargada. Para entrar solo necesitan un email y una contraseña: ${link}\n\nEl enlace es personal, sirve una sola vez y vence en 30 días.`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
/** Where "Probar habita." leads: the regular studio, carrying the demo and agency for attribution. */
export function ctaHref(demoId: string, agencyId: string) {
  const q = new URLSearchParams({
    utm_source: "demo_comercial",
    utm_medium: "whatsapp",
    utm_campaign: "demos_inmobiliarias",
    demo: demoId,
    inmobiliaria: agencyId,
  });
  return `/estudio?${q}`;
}
export const DEMO_REF_KEY = "amoblaia_demo_ref";

/** An image of a published demo: the original, or its version in one style. */
export function publicImageUrl(token: string, photoId: string, version: PhotoVersion | null, width?: number) {
  const q = new URLSearchParams(version ? { e: version.style, r: version.v } : { r: "o" });
  if (width) q.set("w", String(width));
  return `/demo/${token}/imagen/${photoId}?${q}`;
}
/** The link preview: half original, half staged in the given version. */
export function ogImageUrl(token: string, photoId: string, version: PhotoVersion | null) {
  const q = new URLSearchParams(version ? { e: version.style, r: version.v, og: "1" } : { r: "o", og: "1" });
  return `/demo/${token}/imagen/${photoId}?${q}`;
}
/** The same images for the panel and the preview, through the admin route. */
export function adminPhotoUrl(photoId: string, version: PhotoVersion | null, width?: number, og = false) {
  const q = new URLSearchParams({ foto: photoId });
  if (version) {
    q.set("estilo", version.style);
    q.set("r", version.v);
  }
  if (width) q.set("w", String(width));
  if (og) q.set("og", "1");
  return `/api/admin/demos/imagen?${q}`;
}
export function adminGenerationUrl(generationId: string, width?: number) {
  const q = new URLSearchParams({ generacion: generationId });
  if (width) q.set("w", String(width));
  return `/api/admin/demos/imagen?${q}`;
}

/** A safe file name: letters, digits, dashes; always .jpg. */
export function downloadName(raw: string | null) {
  const full =
    (raw ?? "habita")
      .normalize("NFC")
      // Separators, reserved characters and control characters (code points below 32).
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/[^\P{Cc}]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 100)
      .replace(/\.jpe?g$/i, "")
      .replace(/^[.\s]+/, "") || "habita";
  const ascii =
    full
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^[.-]+|-+$/g, "") || "habita";
  return { full: `${full}.jpg`, ascii: `${ascii}.jpg` };
}

/** The download link of one created version: a JPEG up to 2048 px, named after the property, space and style. */
export function generationDownloadUrl(generationId: string, name: string) {
  const q = new URLSearchParams({ generacion: generationId, w: "2048", descargar: "1", nombre: name });
  return `/api/admin/demos/imagen?${q}`;
}

/** The download link of a photo as uploaded (the original), the same JPEG size and naming as a version. */
export function photoDownloadUrl(photoId: string, name: string) {
  const q = new URLSearchParams({ foto: photoId, w: "2048", descargar: "1", nombre: name });
  return `/api/admin/demos/imagen?${q}`;
}

/** Messages for the generation states the editor shows. */
export function generationNote(g: Pick<GenerationRow, "status">) {
  switch (g.status) {
    case "queued":
      return "En cola";
    case "running":
      return "Ambientando…";
    case "succeeded":
      return "Lista";
    case "needs_review":
      return "En revisión: el resultado puede recuperarse desde Administración.";
    default:
      return "Falló. Podés intentar de nuevo.";
  }
}
