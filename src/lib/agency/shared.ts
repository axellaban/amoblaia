// What the agency panel and the agency's public site share with the browser.
// Pure: no database, no secrets.

export type AgencyRole = "owner" | "collaborator";

/** "Russillo Asesores Inmobiliarios" → "russillo-asesores-inmobiliarios" (3–42 characters). */
export function slugify(name: string) {
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " y ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42)
    .replace(/-+$/g, "");
  return slug.length >= 3 ? slug : `inmobiliaria-${slug || "nueva"}`.slice(0, 42).replace(/-+$/g, "");
}

export const agencySitePath = (slug: string) => `/inmobiliaria/${slug}`;
export const agencyPropertyPath = (slug: string, token: string) => `/inmobiliaria/${slug}/${token}`;

/** One row of "Mis propiedades". */
export type PanelProperty = {
  id: string;
  title: string;
  location: string | null;
  /** The agency's own reference for the listing, if entered. */
  reference: string | null;
  /** Where it was created: by the team (admin) or by the agency in its panel. Not whether it is a demo. */
  origin: "admin" | "agency";
  price: string | null;
  operation: string | null;
  photos: number;
  /** Photos with at least one ready version. */
  staged: number;
  /** Versions by their real state: ready (created), active (queued or running), issues (failed or uncertain). */
  versions: { ready: number; active: number; issues: number };
  /** Spaces it is organized in; null when unknown. */
  spaces: number | null;
  status: "draft" | "published";
  token: string;
  coverPhotoId: string | null;
  listingUrl: string | null;
  createdAt: string;
};

export type PanelImport = {
  id: string;
  url: string;
  status: "partial" | "failed";
  error: string | null;
  createdAt: string;
  /** The property page it created, if it got that far. */
  propertyId: string | null;
  photosTotal: number;
  photosDone: number;
  /** Photos still to download: retried alone. */
  pendingImages: string[];
  settingsSaved: boolean;
};

export type PanelSummary = {
  agency: {
    id: string;
    name: string;
    slug: string | null;
    website: string | null;
    sitePublished: boolean;
    logo: string | null;
    primary: string | null;
    contactKind: "whatsapp" | "url" | "phone" | "email" | null;
    contactValue: string | null;
  };
  role: AgencyRole;
  /** The agency's balance (its owner's credits); null when it could not be read. */
  credits: number | null;
  counts: { total: number; published: number; drafts: number; staged: number; review: number; operations: string[] };
  /** The latest properties (the full list is paged: /api/panel/propiedades). */
  properties: PanelProperty[];
  /** Imports that need something: partial (data or photos missing) or failed. */
  imports: PanelImport[];
  /** A team member looking at this panel in a support view (read only). */
  support?: boolean;
};

/** A slug as the database accepts it: lowercase letters, digits and dashes. */
export const validSlug = (s: unknown): s is string =>
  typeof s === "string" && /^[a-z0-9]([a-z0-9-]{1,40}[a-z0-9])$/.test(s);

/**
 * The link to share a published property. /demo/<token> works whether or
 * not the agency's catalog is public; inside a public catalog the same page
 * is also at /inmobiliaria/<slug>/<token>.
 */
export function propertyLink(origin: string, p: { token: string }, site?: { slug: string | null; sitePublished: boolean }) {
  return site?.slug && site.sitePublished ? `${origin}${agencyPropertyPath(site.slug, p.token)}` : `${origin}/demo/${p.token}`;
}

export const ORIGIN_LABEL: Record<PanelProperty["origin"], string> = {
  admin: "Creada por el equipo",
  agency: "Creada por la inmobiliaria",
};

/** The one most useful thing to do next with a property, from its real state. */
export function nextAction(p: Pick<PanelProperty, "photos" | "versions" | "staged" | "status">): {
  label: string;
  section: "fotos" | "publicacion";
} {
  if (!p.photos) return { label: "Agregar fotos", section: "fotos" };
  if (p.versions.active) return { label: "Ver progreso", section: "fotos" };
  if (p.versions.issues) return { label: "Revisar fallos", section: "fotos" };
  if (!p.staged) return { label: "Crear versiones", section: "fotos" };
  if (p.status === "draft") return { label: "Revisar y publicar", section: "publicacion" };
  return { label: "Compartir", section: "publicacion" };
}

/** A path inside the panel or the admin to come back to; anything else (other sites, protocol-relative) is refused. */
export function safeReturn(raw: string | null | undefined, fallback: string) {
  if (!raw || raw.length > 600) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return fallback;
  if (!/^\/(panel|admin)(\/|\?|$)/.test(raw)) return fallback;
  try {
    const url = new URL(raw, "https://x.local");
    return url.origin === "https://x.local" ? `${url.pathname}${url.search}` : fallback;
  } catch {
    return fallback;
  }
}
