import "server-only";
import sharp from "sharp";
import { HttpError } from "@/lib/commerce/http";
import { brandingOf } from "@/lib/demos/server";
import { adminClient } from "@/lib/supabase/server";
import { normalizeSite, type SiteDoc, type SiteSeed, type StoredSite } from "./schema";

export const SITE_BUCKET = "agency-site";
const MIGRATION = "Para usar el constructor de sitios falta aplicar la migración 202612120001_agency_site_builder.sql en Supabase.";

type AgencyRow = { id: string; name: string; website: string | null; site: StoredSite | null };

async function agencyRow(agencyId: string): Promise<AgencyRow | null> {
  const { data, error } = await adminClient().from("agencies").select("id,name,website,site").eq("id", agencyId).maybeSingle();
  if (error) return null;
  return data as AgencyRow | null;
}

/** What the agency already told habita, to prefill a new site. */
export async function siteSeed(agencyId: string, name: string, website: string | null = null): Promise<SiteSeed> {
  const b = await brandingOf(agencyId).catch(() => ({}) as Awaited<ReturnType<typeof brandingOf>>);
  const value = b.contactValue ?? null;
  return {
    name,
    primary: b.primary ?? null,
    whatsapp: b.contactKind === "whatsapp" ? value : null,
    phone: b.contactKind === "phone" ? value : null,
    email: b.contactKind === "email" ? value : null,
    website,
  };
}

export type EditorSite = {
  /** False while the migration is missing: the editor says so and saves nothing. */
  ready: boolean;
  draft: SiteDoc | null;
  publishedAt: string | null;
  updatedAt: string | null;
  /** The draft has changes that are not on the public site yet. */
  pending: boolean;
  seed: SiteSeed;
};

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export async function editorSite(agencyId: string): Promise<EditorSite> {
  const row = await agencyRow(agencyId);
  if (!row) {
    const { data } = await adminClient().from("agencies").select("name,website").eq("id", agencyId).maybeSingle();
    const a = (data as { name: string; website: string | null } | null) ?? { name: "Mi inmobiliaria", website: null };
    return { ready: false, draft: null, publishedAt: null, updatedAt: null, pending: false, seed: await siteSeed(agencyId, a.name, a.website) };
  }
  const seed = await siteSeed(agencyId, row.name, row.website);
  const stored = row.site ?? {};
  const draft = stored.draft ? normalizeSite(stored.draft, seed) : null;
  const published = stored.published ? normalizeSite(stored.published, seed) : null;
  return {
    ready: true,
    draft,
    publishedAt: stored.publishedAt ?? null,
    updatedAt: stored.updatedAt ?? null,
    pending: Boolean(draft) && !same(draft, published),
    seed,
  };
}

async function writeStored(agencyId: string, next: StoredSite, extra: Record<string, unknown> = {}) {
  if (Buffer.byteLength(JSON.stringify(next)) > 880000) throw new HttpError(413, "El sitio es demasiado grande para guardar. Quitá algunas secciones o textos largos.");
  const { error } = await adminClient()
    .from("agencies")
    .update({ site: next, ...extra })
    .eq("id", agencyId);
  if (error) throw new HttpError(409, MIGRATION);
}

/** Saves the draft (what the editor shows). The public site does not change. */
export async function saveDraft(agencyId: string, input: unknown): Promise<EditorSite> {
  const row = await agencyRow(agencyId);
  if (!row) throw new HttpError(409, MIGRATION);
  const seed = await siteSeed(agencyId, row.name, row.website);
  const draft = normalizeSite(input, seed);
  await writeStored(agencyId, { ...(row.site ?? {}), draft, updatedAt: new Date().toISOString() });
  return editorSite(agencyId);
}

/** The draft becomes the public site, and the site is made public. */
export async function publishDraft(agencyId: string, hasSlug: boolean): Promise<EditorSite> {
  if (!hasSlug) throw new HttpError(400, "Elegí la dirección de tu sitio en Ajustes antes de publicarlo.");
  const row = await agencyRow(agencyId);
  if (!row) throw new HttpError(409, MIGRATION);
  const stored = row.site ?? {};
  if (!stored.draft) throw new HttpError(400, "Todavía no armaste tu sitio.");
  const seed = await siteSeed(agencyId, row.name, row.website);
  const now = new Date().toISOString();
  const draft = normalizeSite(stored.draft, seed);
  await writeStored(agencyId, { ...stored, draft, published: draft, publishedAt: now }, { site_published: true });
  return editorSite(agencyId);
}

/** Back to what is published. */
export async function discardDraft(agencyId: string): Promise<EditorSite> {
  const row = await agencyRow(agencyId);
  if (!row) throw new HttpError(409, MIGRATION);
  const stored = row.site ?? {};
  if (!stored.published) throw new HttpError(400, "Tu sitio todavía no se publicó: no hay una versión anterior.");
  await writeStored(agencyId, { ...stored, draft: stored.published, updatedAt: new Date().toISOString() });
  return editorSite(agencyId);
}

/** Back to the plain catalog: the site built in the editor is kept, but not shown. */
export async function resetSite(agencyId: string): Promise<EditorSite> {
  const row = await agencyRow(agencyId);
  if (!row) throw new HttpError(409, MIGRATION);
  await writeStored(agencyId, {});
  return editorSite(agencyId);
}

/** The site to show: the published one, or the draft for the members' preview. Null: the plain catalog. */
export async function siteDocFor(agencyId: string, name: string, website: string | null, preview: boolean): Promise<SiteDoc | null> {
  const row = await agencyRow(agencyId);
  const stored = row?.site ?? {};
  const raw = preview ? (stored.draft ?? stored.published) : stored.published;
  if (!raw) return null;
  return normalizeSite(raw, await siteSeed(agencyId, name, website));
}

/* ─────────────── Images ─────────────── */

/** An image for the site, at most 2400 px wide, as WebP in the public bucket. */
export async function uploadSiteImage(agencyId: string, bytes: Buffer, purpose: "photo" | "logo" = "photo") {
  const image = await sharp(bytes, { limitInputPixels: 60_000_000 })
    .rotate()
    .resize(purpose === "logo" ? { width: 600, height: 300, fit: "inside", withoutEnlargement: true } : { width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
    .webp({ quality: purpose === "logo" ? 90 : 80 })
    .toBuffer()
    .catch(() => {
      throw new HttpError(400, "No pudimos leer la imagen. Probá con un JPG, PNG o WebP.");
    });
  const path = `${agencyId}/${crypto.randomUUID()}.webp`;
  const db = adminClient();
  const up = await db.storage.from(SITE_BUCKET).upload(path, image, { contentType: "image/webp", upsert: false, cacheControl: "31536000" });
  if (up.error) throw new HttpError(409, MIGRATION);
  return db.storage.from(SITE_BUCKET).getPublicUrl(path).data.publicUrl;
}

/* ─────────────── Inquiries ─────────────── */

export type InquiryKind = "contacto" | "tasacion" | "propiedad" | "newsletter";
export type Inquiry = {
  id: string;
  kind: InquiryKind;
  name: string | null;
  email: string | null;
  phone: string | null;
  message: string | null;
  property_token: string | null;
  page: string | null;
  details: Record<string, string>;
  created_at: string;
  read_at: string | null;
};

export async function addInquiry(agencyId: string, i: Omit<Inquiry, "id" | "created_at" | "read_at">) {
  const db = adminClient();
  // A form sent over and over (a bot, a stuck button) does not flood the inbox.
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await db.from("site_inquiries").select("id", { count: "exact", head: true }).eq("agency_id", agencyId).gte("created_at", since);
  if ((count ?? 0) >= 60) throw new HttpError(429, "Recibimos muchas consultas en poco tiempo. Probá de nuevo en un rato.");
  const { error } = await db.from("site_inquiries").insert({ agency_id: agencyId, ...i });
  if (error) throw new HttpError(503, "No pudimos enviar la consulta. Probá de nuevo en un momento.");
}

export async function listInquiries(agencyId: string, limit = 200): Promise<{ ready: boolean; items: Inquiry[]; unread: number }> {
  const { data, error } = await adminClient()
    .from("site_inquiries")
    .select("id,kind,name,email,phone,message,property_token,page,details,created_at,read_at")
    .eq("agency_id", agencyId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return { ready: false, items: [], unread: 0 };
  const items = data as Inquiry[];
  return { ready: true, items, unread: items.filter((i) => !i.read_at).length };
}

export async function markInquiries(agencyId: string, ids: string[], read: boolean) {
  const valid = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 200);
  if (!valid.length) return;
  const { error } = await adminClient()
    .from("site_inquiries")
    .update({ read_at: read ? new Date().toISOString() : null })
    .eq("agency_id", agencyId)
    .in("id", valid);
  if (error) throw new HttpError(503, "No pudimos actualizar las consultas.");
}

export async function deleteInquiry(agencyId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, "Consulta inválida.");
  const { error } = await adminClient().from("site_inquiries").delete().eq("agency_id", agencyId).eq("id", id);
  if (error) throw new HttpError(503, "No pudimos borrar la consulta.");
}
