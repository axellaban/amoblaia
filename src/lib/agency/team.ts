import "server-only";
import { randomBytes } from "node:crypto";
import { HttpError, rpc } from "@/lib/commerce/http";
import { isUuid } from "@/lib/demos/shared";
import { adminClient } from "@/lib/supabase/server";
import { readSettings } from "@/lib/demos/branding";
import { claimHash, type Membership } from "./server";
import { INVITED_ROLES, joinPath, scopable, type AgencyRole, type InvitedRole, type TeamMember, type TeamProperty } from "./shared";

/**
 * "Usuarios" of the agency panel: the owner and its administrators create
 * accesses for their employees, with a role and, for editors and viewers,
 * only some properties. Each access is a one-time link (stored as its hash)
 * for one e-mail: the employee opens it, chooses a password (or signs in
 * with that e-mail's account) and lands in the panel.
 */
export const INVITE_DAYS = 14;
const MAX_MEMBERS = 100;
const MAX_SCOPE = 500;

const check = <T>(r: { data: T; error: unknown }, code: string) => {
  if (r.error) throw new Error(code);
  return r.data;
};
const cleanEmail = (v: unknown) => {
  const mail = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (!/^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(mail) || mail.length > 200) throw new HttpError(400, "Revisá el email.");
  return mail;
};
const cleanName = (v: unknown) => {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw new HttpError(400, "Revisá el nombre.");
  const name = v.replace(/\s+/g, " ").trim().slice(0, 80);
  return name || null;
};
const cleanRole = (v: unknown): InvitedRole => {
  if (!INVITED_ROLES.includes(v as InvitedRole)) throw new HttpError(400, "Elegí un rol: administrador, edición o solo vista.");
  return v as InvitedRole;
};
const newCode = () => randomBytes(24).toString("base64url");
const expiry = () => new Date(Date.now() + INVITE_DAYS * 864e5).toISOString();

/**
 * The properties a user is limited to: null (all) or ids of this agency's
 * properties. Only editors and viewers may be limited, and to at least one.
 */
async function cleanScope(agencyId: string, role: AgencyRole, v: unknown): Promise<string[] | null> {
  if (v === undefined || v === null) return null;
  if (!scopable(role)) throw new HttpError(400, "Los administradores ven todas las propiedades.");
  if (!Array.isArray(v) || !v.every(isUuid)) throw new HttpError(400, "Revisá las propiedades elegidas.");
  const ids = [...new Set(v as string[])];
  if (!ids.length) throw new HttpError(400, "Elegí al menos una propiedad, o dale acceso a todas.");
  if (ids.length > MAX_SCOPE) throw new HttpError(400, `Elegí hasta ${MAX_SCOPE} propiedades.`);
  const found = check(
    await adminClient().from("demo_properties").select("id").eq("agency_id", agencyId).in("id", ids),
    "TEAM_SCOPE_LOOKUP_FAILED",
  ) as { id: string }[];
  if (found.length !== ids.length) throw new HttpError(400, "Alguna de las propiedades elegidas ya no está en tu inmobiliaria.");
  return ids;
}

type MemberRow = { user_id: string; role: AgencyRole | "collaborator"; property_ids: string[] | null; display_name: string | null; created_at: string };
type InviteRow = { id: string; email: string; display_name: string | null; role: InvitedRole; property_ids: string[] | null; created_at: string; expires_at: string };

/** Everyone with access to the agency, and the accesses whose link was not used yet. */
export async function teamOf(agencyId: string, viewerId: string): Promise<TeamMember[]> {
  const db = adminClient();
  const [members, invites] = await Promise.all([
    db.from("agency_members").select("user_id,role,property_ids,display_name,created_at").eq("agency_id", agencyId).order("created_at").limit(MAX_MEMBERS),
    db
      .from("agency_invites")
      .select("id,email,display_name,role,property_ids,created_at,expires_at")
      .eq("agency_id", agencyId)
      .is("used_at", null)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(MAX_MEMBERS),
  ]);
  if (members.error || invites.error) throw new HttpError(503, "Los usuarios todavía no están habilitados: falta aplicar la migración 202611110001_agency_team.sql.");
  const rows = members.data as MemberRow[];
  // E-mails live in the accounts, not in the agency's tables.
  const emails = await Promise.all(
    rows.map((m) =>
      adminClient()
        .auth.admin.getUserById(m.user_id)
        .then((r) => r.data.user?.email ?? null)
        .catch(() => null),
    ),
  );
  return [
    ...rows.map((m, i) => {
      const role: AgencyRole = m.role === "collaborator" ? "editor" : m.role;
      return {
        id: m.user_id,
        kind: "member" as const,
        name: m.display_name,
        email: emails[i],
        role,
        properties: scopable(role) ? m.property_ids : null,
        you: m.user_id === viewerId,
        createdAt: m.created_at,
      };
    }),
    ...(invites.data as InviteRow[]).map((i) => ({
      id: i.id,
      kind: "pending" as const,
      name: i.display_name,
      email: i.email,
      role: i.role,
      properties: i.property_ids,
      you: false,
      createdAt: i.created_at,
      expiresAt: i.expires_at,
    })),
  ];
}

/** The agency's fichas, to choose which ones a limited user sees. */
export async function teamProperties(agencyId: string): Promise<TeamProperty[]> {
  const rows = check(
    await adminClient()
      .from("demos")
      .select("property_id,settings,demo_properties!inner(title,location)")
      .eq("agency_id", agencyId)
      .eq("kind", "ficha")
      .order("created_at", { ascending: false })
      .limit(MAX_SCOPE),
    "TEAM_PROPERTIES_FAILED",
  ) as unknown as { property_id: string; settings: unknown; demo_properties: { title: string; location: string | null } }[];
  return rows.map((r) => ({
    id: r.property_id,
    title: r.demo_properties.title,
    location: r.demo_properties.location,
    reference: readSettings(r.settings).reference,
  }));
}

/**
 * A new access: { email, name?, role, properties? (null: all) }. Returns its
 * link, shown once (only its hash is kept). A previous open access for the
 * same e-mail is replaced.
 */
export async function createInvite(membership: Membership, actorId: string, body: Record<string, unknown>) {
  const agencyId = membership.agency.id;
  const email = cleanEmail(body.email);
  const name = cleanName(body.name);
  const role = cleanRole(body.role);
  const properties = await cleanScope(agencyId, role, body.properties);
  const db = adminClient();
  const team = await teamOf(agencyId, actorId);
  if (team.some((m) => m.kind === "member" && m.email?.toLowerCase() === email))
    throw new HttpError(409, "Esa persona ya tiene acceso a tu inmobiliaria. Cambiá su rol desde la lista.");
  if (team.filter((m) => m.kind === "member").length >= MAX_MEMBERS) throw new HttpError(409, `Una inmobiliaria admite hasta ${MAX_MEMBERS} usuarios.`);
  check(
    await db.from("agency_invites").update({ revoked_at: new Date().toISOString() }).eq("agency_id", agencyId).eq("email", email).is("used_at", null).is("revoked_at", null),
    "TEAM_INVITE_REPLACE_FAILED",
  );
  const code = newCode();
  const made = check(
    await db
      .from("agency_invites")
      .insert({ agency_id: agencyId, email, display_name: name, role, property_ids: properties, code_hash: claimHash(code), created_by: actorId, expires_at: expiry() })
      .select("id")
      .single(),
    "TEAM_INVITE_FAILED",
  ) as { id: string };
  await audit(actorId, "agency_invite", agencyId, { invite: made.id, role, limited: Boolean(properties) });
  return { id: made.id, link: joinPath(code) };
}

/** A new link for an access not used yet (the previous one stops working), valid again for INVITE_DAYS. */
export async function renewInvite(agencyId: string, actorId: string, inviteId: string) {
  if (!isUuid(inviteId)) throw new HttpError(404, "No encontramos ese acceso.");
  const code = newCode();
  const rows = check(
    await adminClient()
      .from("agency_invites")
      .update({ code_hash: claimHash(code), expires_at: expiry() })
      .eq("id", inviteId)
      .eq("agency_id", agencyId)
      .is("used_at", null)
      .is("revoked_at", null)
      .select("id"),
    "TEAM_INVITE_RENEW_FAILED",
  ) as { id: string }[];
  if (!rows.length) throw new HttpError(404, "Ese acceso ya se usó o fue eliminado.");
  await audit(actorId, "agency_invite_renewed", agencyId, { invite: inviteId });
  return { id: inviteId, link: joinPath(code) };
}

/** Changes the role or the properties of a member or of an access not used yet. The owner is never changed here. */
export async function updateAccess(membership: Membership, actorId: string, target: { kind: "member" | "pending"; id: string }, body: Record<string, unknown>) {
  const agencyId = membership.agency.id;
  if (!isUuid(target.id)) throw new HttpError(404, "No encontramos ese usuario.");
  if (target.kind === "member" && target.id === actorId) throw new HttpError(400, "No podés cambiar tu propio acceso: pedíselo a otro administrador.");
  const db = adminClient();
  const table = target.kind === "member" ? "agency_members" : "agency_invites";
  let current: { role: AgencyRole; property_ids: string[] | null } | null;
  if (target.kind === "member") {
    current = check(
      await db.from("agency_members").select("role,property_ids").eq("agency_id", agencyId).eq("user_id", target.id).maybeSingle(),
      "TEAM_MEMBER_LOOKUP_FAILED",
    ) as typeof current;
  } else {
    current = check(
      await db.from("agency_invites").select("role,property_ids").eq("agency_id", agencyId).eq("id", target.id).is("used_at", null).is("revoked_at", null).maybeSingle(),
      "TEAM_INVITE_LOOKUP_FAILED",
    ) as typeof current;
  }
  if (!current) throw new HttpError(404, "No encontramos ese usuario.");
  if (current.role === "owner") throw new HttpError(403, "El acceso del dueño no se puede cambiar.");
  const role = "role" in body ? cleanRole(body.role) : (current.role as InvitedRole);
  const properties = "properties" in body ? await cleanScope(agencyId, role, body.properties) : scopable(role) ? current.property_ids : null;
  const changes = { role, property_ids: properties };
  const updated = target.kind === "member"
    ? await db.from(table).update(changes).eq("agency_id", agencyId).eq("user_id", target.id)
    : await db.from(table).update(changes).eq("agency_id", agencyId).eq("id", target.id);
  if (updated.error) throw new Error("TEAM_UPDATE_FAILED");
  await audit(actorId, "agency_access_changed", agencyId, { [target.kind]: target.id, role, limited: Boolean(properties) });
}

/** Removes a member's access (its account stays, outside the agency) or deletes an access not used yet. */
export async function removeAccess(membership: Membership, actorId: string, target: { kind: "member" | "pending"; id: string }) {
  const agencyId = membership.agency.id;
  if (!isUuid(target.id)) throw new HttpError(404, "No encontramos ese usuario.");
  const db = adminClient();
  if (target.kind === "pending") {
    const rows = check(
      await db.from("agency_invites").update({ revoked_at: new Date().toISOString() }).eq("agency_id", agencyId).eq("id", target.id).is("used_at", null).is("revoked_at", null).select("id"),
      "TEAM_INVITE_REVOKE_FAILED",
    ) as { id: string }[];
    if (!rows.length) throw new HttpError(404, "Ese acceso ya se usó o fue eliminado.");
  } else {
    if (target.id === actorId) throw new HttpError(400, "No podés quitar tu propio acceso.");
    const row = check(
      await db.from("agency_members").select("role").eq("agency_id", agencyId).eq("user_id", target.id).maybeSingle(),
      "TEAM_MEMBER_LOOKUP_FAILED",
    ) as { role: AgencyRole } | null;
    if (!row) throw new HttpError(404, "No encontramos ese usuario.");
    if (row.role === "owner") throw new HttpError(403, "El dueño de la inmobiliaria no se puede quitar.");
    check(await db.from("agency_members").delete().eq("agency_id", agencyId).eq("user_id", target.id).neq("role", "owner"), "TEAM_REMOVE_FAILED");
  }
  await audit(actorId, "agency_access_removed", agencyId, { [target.kind]: target.id });
}

async function audit(actorId: string, action: string, agencyId: string, details: Record<string, unknown>) {
  await adminClient()
    .from("admin_audit")
    .insert({ actor_id: actorId, action, subject_id: agencyId, details })
    .then(
      () => null,
      () => null,
    );
}

export const validJoinCode = (code: unknown): code is string => typeof code === "string" && /^[A-Za-z0-9_-]{20,64}$/.test(code);

export type JoinInvite = { agencyName: string; email: string; name: string | null; role: InvitedRole; limited: boolean; expiresAt: string };

/** What a join link opens; null when it is unknown, used, revoked or expired. */
export async function joinInviteOf(code: string | null): Promise<JoinInvite | null> {
  if (!validJoinCode(code)) return null;
  const { data, error } = await adminClient()
    .from("agency_invites")
    .select("email,display_name,role,property_ids,expires_at,used_at,revoked_at,agencies(name)")
    .eq("code_hash", claimHash(code))
    .maybeSingle();
  if (error) return null;
  const i = data as unknown as (InviteRow & { used_at: string | null; revoked_at: string | null; agencies: { name: string } | null }) | null;
  if (!i?.agencies || i.used_at || i.revoked_at || new Date(i.expires_at).getTime() <= Date.now()) return null;
  return { agencyName: i.agencies.name, email: i.email, name: i.display_name, role: i.role, limited: Boolean(i.property_ids), expiresAt: i.expires_at };
}

const JOIN_ERRORS: Record<string, [number, string]> = {
  INVITE_INVALID: [404, "Este enlace venció, ya se usó o fue reemplazado. Pedile uno nuevo a tu inmobiliaria."],
  INVITE_EMAIL: [403, "Este acceso es para otro email. Entrá con la cuenta del email al que te invitaron."],
  AGENCY_EXISTS: [409, "Tu cuenta ya trabaja con una inmobiliaria en habita. Usá otro email o pedí que te quiten de la anterior."],
  ACCOUNT_BLOCKED: [403, "Tu cuenta está bloqueada. Escribinos para revisarla."],
};

/** Joins the agency with this account, which must be the invited e-mail's. */
export async function joinAgency(userId: string, email: string | undefined, code: unknown) {
  if (!validJoinCode(code)) throw new HttpError(404, JOIN_ERRORS.INVITE_INVALID[1]);
  try {
    return await rpc<string>("habita_join_agency", { p_user: userId, p_email: email ?? "", p_code_hash: claimHash(code) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    const hit = Object.keys(JOIN_ERRORS).find((k) => msg.includes(k));
    if (hit) throw new HttpError(JOIN_ERRORS[hit][0], JOIN_ERRORS[hit][1]);
    throw e;
  }
}

/**
 * Joins with a new account: only a password, for the invited e-mail. The
 * private link stands for the e-mail, so the account starts verified. If the
 * join fails, that new account is removed.
 */
export async function joinWithNewAccount(code: unknown, password: unknown) {
  if (typeof password !== "string" || password.length < 8 || password.length > 72)
    throw new HttpError(400, "La contraseña tiene que tener entre 8 y 72 caracteres.");
  const invite = await joinInviteOf(validJoinCode(code) ? code : null);
  if (!invite) throw new HttpError(404, JOIN_ERRORS.INVITE_INVALID[1]);
  const auth = adminClient().auth.admin;
  const created = await auth.createUser({ email: invite.email, password, email_confirm: true });
  if (created.error || !created.data.user) {
    const msg = `${created.error?.code ?? ""} ${created.error?.message ?? ""}`.toLowerCase();
    if (msg.includes("exist") || msg.includes("registered"))
      throw new HttpError(409, "Ese email ya tiene una cuenta en habita. Entrá con tu contraseña para sumarte.");
    if (msg.includes("password")) throw new HttpError(400, "Elegí una contraseña más segura (por lo menos 8 caracteres, con letras y números).");
    throw new Error("JOIN_SIGNUP_FAILED");
  }
  const userId = created.data.user.id;
  try {
    await rpc("amobla_account", { p_user: userId, p_trial: false });
    await joinAgency(userId, invite.email, code);
    return { email: invite.email };
  } catch (e) {
    await auth.deleteUser(userId).catch(() => null);
    throw e;
  }
}
