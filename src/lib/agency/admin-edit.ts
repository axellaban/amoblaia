import "server-only";
import { HttpError, requireAdmin, rpc } from "@/lib/commerce/http";
import { DEFAULT_SETTINGS } from "@/lib/demos/branding";
import { agencyInput, brandingInput, propertyInput, settingsInput } from "@/lib/demos/input";
import { brandingOf, createDemo, saveJson } from "@/lib/demos/server";
import { cleanText, cleanUrl, isUuid } from "@/lib/demos/shared";
import { adminClient } from "@/lib/supabase/server";
import { findDuplicates, type DuplicateCandidate, type DuplicateMatch } from "./duplicates";
import { auditAgency, requireEditContext } from "./edit-context";

/**
 * A write of the team on one agency as a whole (its data, its brand, a new
 * property): a team member, the tab's edit context for exactly this agency,
 * and an agency that exists.
 */
export async function requireAgencyEdit(request: Request, id: string) {
  const actor = await requireAdmin(request);
  if (!isUuid(id)) throw new HttpError(404, "No encontramos la inmobiliaria.");
  const editContext = requireEditContext(request, actor, id);
  const { data, error } = await adminClient().from("agencies").select("id,name,owner_id").eq("id", id).maybeSingle();
  if (error) throw new Error("AGENCY_LOOKUP_FAILED");
  if (!data) throw new HttpError(404, "No encontramos la inmobiliaria.");
  return { actor, editContext, admin: true as const, agency: data as { id: string; name: string; owner_id: string | null } };
}

const MIGRATION = "Para esto falta aplicar la migración 202611030001_admin_editing.sql en Supabase.";
const validEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 200;
/** A missing column (the migration is not applied yet) as PostgREST or Postgres report it. */
const missingColumn = (e: { code?: string; message?: string } | null) =>
  Boolean(e && (e.code === "42703" || e.code === "PGRST204" || /column/i.test(e.message ?? "")));

/** The contact e-mail of a form: absent, cleared (null) or a valid address; anything else is refused. */
function contactEmail(raw: unknown) {
  const v = cleanText(raw, 200);
  if (v && !validEmail(v)) throw new HttpError(400, "Revisá el email de contacto.");
  return v ? v.toLowerCase() : null;
}

/** Every agency the team has, for the duplicate check (bounded; newest first). */
async function candidates(): Promise<DuplicateCandidate[]> {
  const db = adminClient();
  const withEmail = await db.from("agencies").select("id,name,website,contact_email").order("created_at", { ascending: false }).limit(5000);
  if (!withEmail.error) return (withEmail.data ?? []) as DuplicateCandidate[];
  // Before 202611030001 there is no contact e-mail to compare.
  const plain = await db.from("agencies").select("id,name,website").order("created_at", { ascending: false }).limit(5000);
  if (plain.error) throw new Error("AGENCY_LIST_FAILED");
  return (plain.data ?? []) as DuplicateCandidate[];
}

/** Agencies that may be this one: same site, e-mail or name without generic words. Read only. */
export async function possibleDuplicates(input: { name: unknown; website?: unknown; contactEmail?: unknown }) {
  const name = cleanText(input.name, 120);
  if (!name) return [];
  const website = cleanUrl(input.website) ?? null;
  const email = cleanText(input.contactEmail, 200);
  return findDuplicates({ name, website, contactEmail: email }, await candidates());
}

export type CreateAgencyResult =
  | { kind: "created" | "replay"; id: string; name: string }
  | { kind: "duplicates"; duplicates: DuplicateMatch[] };

/**
 * The team's record of an agency, on its own: a name (required), and
 * optionally its site, a contact person and a contact e-mail (private).
 * It creates no account, no invitation and no credits, and no property.
 * One agency per request key; possible duplicates are shown first and
 * only created anyway when the team confirms, never merged.
 */
export async function createAgencyRecord(actorId: string, raw: Record<string, unknown>): Promise<CreateAgencyResult> {
  if (!isUuid(raw.key)) throw new HttpError(400, "Volvé a abrir el formulario e intentá de nuevo.");
  const name = cleanText(raw.name, 120);
  if (!name) throw new HttpError(400, "Ingresá el nombre comercial de la inmobiliaria.");
  const website = cleanUrl(raw.website);
  if (website === undefined) throw new HttpError(400, "Revisá el sitio web: usá una dirección como inmobiliaria.com.ar.");
  const contact_name = cleanText(raw.contactName, 120);
  const contact_email = contactEmail(raw.contactEmail);
  const db = adminClient();

  const replay = async () => {
    const { data, error } = await db.from("agencies").select("id,name").eq("request_key", raw.key).maybeSingle();
    if (error) throw new HttpError(409, MIGRATION);
    return data as { id: string; name: string } | null;
  };
  const done = await replay();
  if (done) return { kind: "replay", ...done };

  if (raw.confirmDuplicates !== true) {
    const duplicates = findDuplicates({ name, website, contactEmail: contact_email }, await candidates());
    if (duplicates.length) return { kind: "duplicates", duplicates };
  }

  await rpc("amobla_account", { p_user: actorId, p_trial: false });
  const made = await db
    .from("agencies")
    .insert({ name, website, contact_name, contact_email, created_by: actorId, request_key: raw.key })
    .select("id,name")
    .single();
  if (made.error) {
    // The same request raced with itself (two tabs, a retry): that agency.
    if (made.error.code === "23505") {
      const again = await replay();
      if (again) return { kind: "replay", ...again };
    }
    if (missingColumn(made.error)) throw new HttpError(409, MIGRATION);
    throw new Error("AGENCY_CREATE_FAILED");
  }
  const agency = made.data as { id: string; name: string };
  await auditAgency(actorId, agency.id, "agency_create", {
    via: "admin",
    ...(raw.confirmDuplicates === true ? { duplicatesConfirmed: true } : {}),
  }).catch(() => console.error("agency_create_audit_failed"));
  return { kind: "created", ...agency };
}

/** The agency's data as the team edits it: name, site, contact person and e-mail, private notes. */
export async function updateAgencyRecord(agencyId: string, raw: unknown) {
  const v = (raw ?? {}) as Record<string, unknown>;
  const changes: Record<string, unknown> = agencyInput(v);
  if ("contact_email" in v) changes.contact_email = contactEmail(v.contact_email);
  const { data, error } = await adminClient().from("agencies").update(changes).eq("id", agencyId).select("id");
  if (error) {
    if ("contact_email" in changes && missingColumn(error)) throw new HttpError(409, MIGRATION);
    throw new Error("AGENCY_UPDATE_FAILED");
  }
  if (!(data ?? []).length) throw new HttpError(404, "No encontramos la inmobiliaria.");
  return Object.keys(changes);
}

/** Its brand and inquiries channel (the logo has its own route). */
export async function updateAgencyBranding(agencyId: string, raw: unknown) {
  await saveJson("agencies", "branding", agencyId, brandingInput(raw, await brandingOf(agencyId)));
}

/** What the workspace's "Datos y marca" shows: the private fields only reach the team. */
export async function agencyRecord(agencyId: string) {
  const db = adminClient();
  const full = await db
    .from("agencies")
    .select("id,name,website,contact_name,contact_email,notes,owner_id")
    .eq("id", agencyId)
    .maybeSingle();
  let row = full.data as Record<string, unknown> | null;
  let emailReady = true;
  if (full.error) {
    emailReady = false;
    const plain = await db.from("agencies").select("id,name,website,contact_name,notes,owner_id").eq("id", agencyId).maybeSingle();
    if (plain.error) throw new Error("AGENCY_LOOKUP_FAILED");
    row = plain.data as Record<string, unknown> | null;
  }
  if (!row) throw new HttpError(404, "No encontramos la inmobiliaria.");
  const branding = await brandingOf(agencyId);
  return {
    agency: {
      id: row.id as string,
      name: row.name as string,
      website: (row.website as string | null) ?? null,
      contact_name: (row.contact_name as string | null) ?? null,
      contact_email: (row.contact_email as string | null) ?? null,
      notes: (row.notes as string | null) ?? null,
      hasOwner: Boolean(row.owner_id),
    },
    branding: {
      primary: branding.primary ?? null,
      accent: branding.accent ?? null,
      titleFont: branding.titleFont ?? "sans",
      contactKind: branding.contactKind ?? null,
      contactValue: branding.contactValue ?? null,
      visitUrl: branding.visitUrl ?? null,
      logo: branding.logo ? `/api/admin/inmobiliarias/${agencyId}/logo?v=${branding.logo.v}` : null,
    },
    emailReady,
  };
}

/**
 * A property typed by hand, as a draft of this agency: title (required),
 * location, listing address, description, operation and price. One per
 * request key: a double click or a retry returns the same property. Photos
 * are added next, in the editor. Nothing is staged and no credit is used.
 */
export async function createManualProperty(agencyId: string, actorId: string, raw: Record<string, unknown>) {
  if (!isUuid(raw.key)) throw new HttpError(400, "Volvé a abrir el formulario e intentá de nuevo.");
  const property = propertyInput(raw.property);
  const db = adminClient();
  const replay = async () => {
    const { data, error } = await db
      .from("demo_properties")
      .select("id,demos(id)")
      .eq("agency_id", agencyId)
      .eq("request_key", raw.key)
      .maybeSingle();
    if (error) throw new HttpError(409, MIGRATION);
    const demos = (data as { demos: { id: string } | { id: string }[] | null } | null)?.demos;
    const demo = Array.isArray(demos) ? demos[0] : demos;
    return demo?.id ?? null;
  };
  const before = await replay();
  if (before) return { id: before, replay: true };
  // Validated before anything is created: a wrong price or operation leaves nothing behind.
  const extra = (raw.settings ?? {}) as Record<string, unknown>;
  const settings = settingsInput(
    {
      ...(cleanText(extra.operation, 40) ? { operation: extra.operation } : {}),
      ...(cleanText(extra.price, 40) ? { price: extra.price } : {}),
    },
    DEFAULT_SETTINGS,
  );
  await rpc("amobla_account", { p_user: actorId, p_trial: false });
  let id: string;
  try {
    id = await createDemo({
      actorId,
      agencyId,
      agency: null,
      property: { ...property, origin: "admin", request_key: raw.key } as Parameters<typeof createDemo>[0]["property"],
    });
  } catch (e) {
    const again = await replay().catch(() => null);
    if (again) return { id: again, replay: true };
    throw e;
  }
  // The property exists: data that could not be saved is said, never lost silently.
  const saved = await saveJson("demos", "settings", id, settings).then(
    () => true,
    () => false,
  );
  return { id, replay: false, settingsSaved: saved };
}

export type ActivityRow = { id: number; action: string; createdAt: string; actor: string; details: Record<string, unknown> };
/** The agency's recent activity by the team (newest first), with who did it. */
export async function agencyActivity(agencyId: string, limit = 40): Promise<ActivityRow[]> {
  const { data, error } = await adminClient()
    .from("admin_audit")
    .select("id,action,created_at,actor_id,details")
    .eq("subject_id", agencyId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error("AGENCY_ACTIVITY_FAILED");
  return ((data ?? []) as { id: number; action: string; created_at: string; actor_id: string; details: Record<string, unknown> | null }[]).map(
    (r) => ({ id: r.id, action: r.action, createdAt: r.created_at, actor: r.actor_id, details: r.details ?? {} }),
  );
}
