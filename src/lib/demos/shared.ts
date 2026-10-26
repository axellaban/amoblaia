// Commercial demos: types, texts and helpers shared by the admin panel, the
// server routes and the public page. Nothing here reads secrets.
import { modes, rooms, styles } from "@/lib/catalog";

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
  ctaButton: "Probar amoblaIA",
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

export type PublicPhoto = {
  id: string;
  label: string;
  staged: boolean;
  /** Changes when another proposal is approved, so caches refresh. */
  version: string;
};
/** Exactly what the public page receives: no notes, contacts or internal ids of other entities. */
export type PublicDemo = {
  id: string;
  agencyId: string;
  agencyName: string;
  title: string;
  location: string | null;
  description: string | null;
  cover: PublicPhoto | null;
  photos: PublicPhoto[];
};

export type DemoStatus = "draft" | "published";
export type DemoSummary = {
  id: string;
  token: string;
  status: DemoStatus;
  title: string;
  agencyId: string;
  agencyName: string;
  propertyTitle: string;
  photos: number;
  staged: number;
  coverPhotoId: string | null;
  /** What the link preview shows: the chosen cover, else the first staged or first visible photo. */
  cover: { id: string; staged: boolean; version: string } | null;
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
export type EditorPhoto = {
  id: string;
  projectId: string;
  position: number;
  visible: boolean;
  room: string;
  label: string | null;
  style: string;
  mode: DemoMode;
  approvedGenerationId: string | null;
  discarded: string[];
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
};

export function roomName(id: string) {
  return rooms.find((r) => r.id === id)?.name ?? "Ambiente";
}
export function styleName(id: string) {
  return styles.find((s) => s.id === id)?.name ?? id;
}
export function modeName(id: string) {
  return modes.find((m) => m.id === id)?.name ?? id;
}
type CoverCandidate = {
  id: string;
  visible: boolean;
  approved_generation_id: string | null;
};
export function pickCover(photos: CoverCandidate[], coverId: string | null) {
  const visible = photos.filter((p) => p.visible);
  const p =
    visible.find((x) => x.id === coverId) ??
    visible.find((x) => x.approved_generation_id) ??
    visible[0];
  return p
    ? {
        id: p.id,
        staged: Boolean(p.approved_generation_id),
        version: p.approved_generation_id?.slice(0, 8) ?? "o",
      }
    : null;
}
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
export function demoUrl(origin: string, token: string) {
  return `${origin.replace(/\/$/, "")}${demoPath(token)}`;
}
/** wa.me opens WhatsApp Web or the app; the recipient needs nothing installed to open the link itself. */
export function whatsappShareUrl(url: string, agency: string, title: string) {
  const text = `Hola ${agency}! Preparamos una muestra de cómo podría verse "${title}" con ambientación virtual: ${url}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
/** Where "Probar amoblaIA" leads: the regular studio, carrying the demo and agency for attribution. */
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

export function publicImageUrl(
  token: string,
  photo: PublicPhoto,
  variant: "original" | "staged",
  width?: number,
) {
  const q = new URLSearchParams({ v: variant, r: photo.version });
  if (width) q.set("w", String(width));
  return `/demo/${token}/imagen/${photo.id}?${q}`;
}
export function ogImageUrl(token: string, photo: PublicPhoto) {
  const q = new URLSearchParams({
    v: photo.staged ? "staged" : "original",
    r: photo.version,
    og: "1",
  });
  return `/demo/${token}/imagen/${photo.id}?${q}`;
}
export function adminPhotoUrl(
  photoId: string,
  variant: "original" | "staged",
  width?: number,
  version = "",
) {
  const q = new URLSearchParams({ foto: photoId, v: variant });
  if (width) q.set("w", String(width));
  if (version) q.set("r", version);
  return `/api/admin/demos/imagen?${q}`;
}
export function adminGenerationUrl(generationId: string, width?: number) {
  const q = new URLSearchParams({ generacion: generationId });
  if (width) q.set("w", String(width));
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
