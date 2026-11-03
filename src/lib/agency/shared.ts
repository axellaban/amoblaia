// What the agency panel and the agency's public site share with the browser.
// Pure: no database, no secrets.

/**
 * Who works for an agency and what they may do. owner: the account that
 * pays (one per agency), everything. admin: everything but buying credits.
 * editor: creates, edits, stages and publishes properties. viewer: only looks.
 */
export type AgencyRole = "owner" | "admin" | "editor" | "viewer";
export type InvitedRole = Exclude<AgencyRole, "owner">;
export const INVITED_ROLES: InvitedRole[] = ["admin", "editor", "viewer"];
export const ROLE_LABEL: Record<AgencyRole, string> = {
  owner: "Dueño",
  admin: "Administrador",
  editor: "Edición",
  viewer: "Solo vista",
};
export const ROLE_HELP: Record<InvitedRole, string> = {
  admin: "Todo, menos comprar créditos: propiedades, sitio web y usuarios.",
  editor: "Carga, edita, ambienta con IA y publica propiedades.",
  viewer: "Ve las propiedades y comparte sus enlaces. No cambia nada.",
};
/** Site, branding, deleting properties and users. */
export const canManage = (role: AgencyRole) => role === "owner" || role === "admin";
/** Properties: creating, editing, staging and publishing. */
export const canEdit = (role: AgencyRole) => role !== "viewer";
/** Only editors and viewers may be limited to some properties. */
export const scopable = (role: AgencyRole) => role === "editor" || role === "viewer";
export const READ_ONLY_ROLE = "Tu usuario es de solo vista: pedile a un administrador de la inmobiliaria que cambie tu acceso.";

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
  /** The properties this user is limited to (null: all of them). */
  scope: string[] | null;
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

/** One user of the agency in "Usuarios": an account that joined, or an access whose link is not used yet. */
export type TeamMember = {
  /** The account (members) or the access (pending). */
  id: string;
  kind: "member" | "pending";
  name: string | null;
  email: string | null;
  role: AgencyRole;
  /** The properties it is limited to, null: all. */
  properties: string[] | null;
  you: boolean;
  createdAt: string;
  /** Pending: when its link stops working. */
  expiresAt?: string;
};
export type TeamProperty = { id: string; title: string; location: string | null; reference: string | null };

/** The link an employee opens to enter with their access. */
export const joinPath = (code: string) => `/panel/unirme?${new URLSearchParams({ codigo: code })}`;

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

/**
 * The property card's next step, in full: what is missing, why, and the one
 * primary action (the others stay secondary). From the same real state as
 * nextAction; nothing is "ready" or "published" that is not.
 */
export function nextStep(p: Pick<PanelProperty, "photos" | "versions" | "staged" | "status">): {
  title: string;
  help: string;
  cta: string;
  section: "fotos" | "publicacion" | "datos";
  primary: boolean;
} {
  const base = nextAction(p);
  if (!p.photos) return { title: "Próximo paso: agregar fotos", help: "Todavía no tiene fotos. Podés subirlas o traerlas de la publicación.", cta: "Agregar fotos", section: "fotos", primary: true };
  if (p.versions.active) return { title: "Se están creando versiones", help: "Seguí el progreso desde el editor de fotos.", cta: "Ver progreso", section: "fotos", primary: true };
  if (p.versions.issues) return { title: "Hay versiones para revisar", help: "Alguna falló o quedó en revisión técnica: revisalas antes de crear otras.", cta: "Revisar versiones", section: "fotos", primary: true };
  if (!p.staged) return { title: "Próximo paso: elegir y crear versiones", help: "La ficha ya tiene fotos. Podés seguir con las imágenes.", cta: "Continuar con las fotos", section: "fotos", primary: true };
  if (p.status === "draft") return { title: "Lista para revisar", help: "Tiene versiones creadas y sigue en borrador: revisala y publicala cuando esté lista.", cta: "Revisar y publicar", section: base.section, primary: true };
  return { title: "Publicada", help: "Podés actualizar sus datos o revisar sus versiones.", cta: "Editar propiedad", section: "datos", primary: false };
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
