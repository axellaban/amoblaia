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
  price: string | null;
  operation: string | null;
  photos: number;
  staged: number;
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
