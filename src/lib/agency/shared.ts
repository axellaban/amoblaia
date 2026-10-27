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

export type PanelSummary = {
  agency: {
    id: string;
    name: string;
    slug: string | null;
    website: string | null;
    sitePublished: boolean;
    logo: string | null;
    primary: string | null;
    whatsapp: string | null;
    email: string | null;
  };
  role: AgencyRole;
  credits: number;
  properties: PanelProperty[];
  imports: { id: string; url: string; status: string; error: string | null; createdAt: string; propertyId: string | null }[];
};

/** A slug as the database accepts it: lowercase letters, digits and dashes. */
export const validSlug = (s: unknown): s is string =>
  typeof s === "string" && /^[a-z0-9]([a-z0-9-]{1,40}[a-z0-9])$/.test(s);
