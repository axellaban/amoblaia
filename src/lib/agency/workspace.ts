import "server-only";
import { HttpError, rpc } from "@/lib/commerce/http";
import { isUuid } from "@/lib/demos/shared";
import { adminClient } from "@/lib/supabase/server";
import type { Membership } from "./server";
import { canManage } from "./shared";
import type { AccessRequest, AdminTransfer, InviteHistory, WorkspaceAdministration } from "./workspace-shared";

/**
 * «Equipo y accesos» (docs/EQUIPO_Y_ACCESOS.md): who is the principal
 * administrator, the requests to join a space that already exists (Journey
 * C) and the requests to become its principal administrator (Journey D).
 * Every rule is checked again by the database functions of
 * 202611260001_workspace_access.sql; the browser's role is never trusted.
 */
export const WORKSPACE_MIGRATION = "202611260001_workspace_access.sql";
const MISSING = `Equipo y accesos todavía no está habilitado: falta aplicar la migración ${WORKSPACE_MIGRATION}.`;

const ERRORS: Record<string, [number, string]> = {
  ACCOUNT_BLOCKED: [403, "Tu cuenta está bloqueada. Escribinos para revisarla."],
  AGENCY_NOT_FOUND: [404, "No encontramos esa inmobiliaria."],
  ALREADY_MEMBER: [409, "Ya tenés acceso a esta inmobiliaria."],
  AGENCY_EXISTS: [409, "Esa cuenta ya trabaja con otra inmobiliaria en habita. Una cuenta puede estar en una sola."],
  TOO_MANY_REQUESTS: [429, "Tenés varias solicitudes pendientes. Esperá a que las respondan."],
  NOT_ADMIN: [403, "Solo un administrador de la inmobiliaria puede responder solicitudes."],
  REQUEST_NOT_FOUND: [404, "No encontramos esa solicitud."],
  REQUEST_CLOSED: [409, "Esa solicitud ya fue respondida."],
  NOT_MEMBER: [403, "Esa persona no forma parte del equipo."],
  ALREADY_PRINCIPAL: [409, "Ya sos el administrador principal."],
  TRANSFER_NOT_FOUND: [404, "No encontramos esa solicitud de administración."],
  TRANSFER_CLOSED: [409, "Esa solicitud ya fue respondida o reemplazada."],
  NOT_PRINCIPAL: [403, "Solo el administrador principal puede aprobar este cambio."],
};

/** The database's named errors as the panel's messages; a missing migration as a clear 503. */
async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
  try {
    return await rpc<T>(name, args);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    const hit = Object.keys(ERRORS).find((k) => msg.includes(k));
    if (hit) throw new HttpError(ERRORS[hit][0], ERRORS[hit][1]);
    if (/does not exist|could not find the function|PGRST202/i.test(msg)) throw new HttpError(503, MISSING);
    throw e;
  }
}

const emailOf = async (userId: string | null) => {
  if (!userId) return null;
  return adminClient()
    .auth.admin.getUserById(userId)
    .then((r) => r.data.user?.email ?? null)
    .catch(() => null);
};

/** The principal administrator: agencies.principal_id while it is a member, else the owner (the same rule as habita_principal). */
export async function principalOf(agencyId: string, ownerId: string | null): Promise<string | null> {
  const db = adminClient();
  const { data, error } = await db.from("agencies").select("principal_id").eq("id", agencyId).maybeSingle();
  // Before the migration every agency's principal is its owner.
  if (error) return ownerId;
  const principal = (data as { principal_id: string | null } | null)?.principal_id ?? null;
  if (!principal || principal === ownerId) return ownerId ?? principal;
  const member = await db.from("agency_members").select("user_id").eq("agency_id", agencyId).eq("user_id", principal).maybeSingle();
  return !member.error && member.data ? principal : ownerId;
}

type RequestRow = { id: string; user_id: string; email: string | null; source: AccessRequest["source"]; status: AccessRequest["status"]; created_at: string };
type TransferRow = { id: string; requester_id: string; current_principal_id: string | null; status: AdminTransfer["status"]; created_at: string };

/** Pending requests to join the agency, for its administrators. */
export async function accessRequestsOf(agencyId: string): Promise<AccessRequest[]> {
  const { data, error } = await adminClient()
    .from("agency_access_requests")
    .select("id,user_id,email,source,status,created_at")
    .eq("agency_id", agencyId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return [];
  const rows = data as RequestRow[];
  const emails = await Promise.all(rows.map((r) => (r.email ? Promise.resolve(r.email) : emailOf(r.user_id))));
  return rows.map((r, i) => ({ id: r.id, email: emails[i], source: r.source, status: r.status, createdAt: r.created_at }));
}

/** The request this account has open for that agency, if any. */
export async function myAccessRequest(userId: string, agencyId: string): Promise<{ id: string; createdAt: string } | null> {
  const { data, error } = await adminClient()
    .from("agency_access_requests")
    .select("id,created_at")
    .eq("agency_id", agencyId)
    .eq("user_id", userId)
    .eq("status", "pending")
    .maybeSingle();
  if (error || !data) return null;
  const r = data as { id: string; created_at: string };
  return { id: r.id, createdAt: r.created_at };
}

/** Asks to join an agency's space (Journey C). The same open request is answered again. */
export async function requestAccess(
  user: { id: string; email?: string | null },
  agencyId: string,
  source: AccessRequest["source"],
  demoId: string | null = null,
) {
  if (!isUuid(agencyId)) throw new HttpError(404, ERRORS.AGENCY_NOT_FOUND[1]);
  return call<{ id: string; created: boolean; createdAt: string }>("habita_request_access", {
    p_user: user.id,
    p_agency: agencyId,
    p_email: user.email ?? "",
    p_source: source,
    p_demo: demoId && isUuid(demoId) ? demoId : null,
  });
}

/** An administrator approves (the account joins as a member) or rejects a request. */
export async function resolveAccessRequest(membership: Membership, actorId: string, requestId: string, approve: boolean) {
  if (!isUuid(requestId)) throw new HttpError(404, ERRORS.REQUEST_NOT_FOUND[1]);
  if (!canManage(membership.role)) throw new HttpError(403, ERRORS.NOT_ADMIN[1]);
  return call<"approved" | "rejected">("habita_resolve_access_request", {
    p_actor: actorId,
    p_agency: membership.agency.id,
    p_request: requestId,
    p_approve: approve,
  });
}

/** A member asks to become the principal administrator (Journey D). */
export async function requestAdminTransfer(membership: Membership, userId: string) {
  return call<{ id: string; created: boolean; createdAt: string }>("habita_request_admin_transfer", { p_user: userId, p_agency: membership.agency.id });
}

/** The principal administrator approves or rejects a transfer. */
export async function resolveAdminTransfer(membership: Membership, actorId: string, transferId: string, approve: boolean) {
  if (!isUuid(transferId)) throw new HttpError(404, ERRORS.TRANSFER_NOT_FOUND[1]);
  return call<"approved" | "rejected">("habita_resolve_admin_transfer", {
    p_actor: actorId,
    p_agency: membership.agency.id,
    p_transfer: transferId,
    p_approve: approve,
    p_support: false,
  });
}

/** The team, after verifying who owns the agency (the principal did not answer). Audited as support. */
export async function supportResolveAdminTransfer(actorId: string, agencyId: string, transferId: string, approve: boolean) {
  if (!isUuid(agencyId) || !isUuid(transferId)) throw new HttpError(404, ERRORS.TRANSFER_NOT_FOUND[1]);
  return call<"approved" | "rejected">("habita_resolve_admin_transfer", {
    p_actor: actorId,
    p_agency: agencyId,
    p_transfer: transferId,
    p_approve: approve,
    p_support: true,
  });
}

/** The principal hands its role to another member of the team. */
export async function transferPrincipal(membership: Membership, actorId: string, targetId: string) {
  if (!isUuid(targetId)) throw new HttpError(404, ERRORS.NOT_MEMBER[1]);
  return call<string>("habita_transfer_principal", { p_actor: actorId, p_agency: membership.agency.id, p_target: targetId });
}

/** Open transfer requests of an agency (for its principal, or the team). */
export async function transfersOf(agencyId: string): Promise<AdminTransfer[]> {
  const { data, error } = await adminClient()
    .from("agency_admin_transfers")
    .select("id,requester_id,current_principal_id,status,created_at")
    .eq("agency_id", agencyId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return [];
  const rows = data as TransferRow[];
  const db = adminClient();
  const names = await Promise.all(
    rows.map(async (r) => {
      const [email, member] = await Promise.all([
        emailOf(r.requester_id),
        db.from("agency_members").select("display_name").eq("agency_id", agencyId).eq("user_id", r.requester_id).maybeSingle(),
      ]);
      return { email, name: (member.data as { display_name: string | null } | null)?.display_name ?? null };
    }),
  );
  return rows.map((r, i) => ({ id: r.id, requesterId: r.requester_id, requesterEmail: names[i].email, requesterName: names[i].name, status: r.status, createdAt: r.created_at }));
}

/** «Administración de la inmobiliaria»: who is the principal, and what this account may do about it. */
export async function administrationOf(membership: Membership, viewerId: string): Promise<WorkspaceAdministration> {
  const agencyId = membership.agency.id;
  const principalId = await principalOf(agencyId, membership.agency.owner_id);
  const isPrincipal = principalId === viewerId;
  const db = adminClient();
  const [email, member, transfers, mine] = await Promise.all([
    emailOf(principalId),
    principalId ? db.from("agency_members").select("display_name").eq("agency_id", agencyId).eq("user_id", principalId).maybeSingle() : null,
    isPrincipal ? transfersOf(agencyId) : Promise.resolve([] as AdminTransfer[]),
    isPrincipal
      ? Promise.resolve(null)
      : db.from("agency_admin_transfers").select("id,created_at").eq("agency_id", agencyId).eq("requester_id", viewerId).eq("status", "pending").maybeSingle(),
  ]);
  const own = mine && !mine.error ? (mine.data as { id: string; created_at: string } | null) : null;
  return {
    principal: principalId ? { id: principalId, email, name: (member?.data as { display_name: string | null } | null)?.display_name ?? null } : null,
    isPrincipal,
    billingIsYou: membership.agency.owner_id === viewerId,
    myRequest: own ? { id: own.id, createdAt: own.created_at } : null,
    transfers,
  };
}

type InviteRow = { id: string; email: string; role: InviteHistory["role"]; created_at: string; expires_at: string; used_at: string | null; revoked_at: string | null };

/** The invitations of the agency with their state: pendiente, aceptada, vencida o revocada (the latest 30). */
export async function invitationHistory(agencyId: string): Promise<InviteHistory[]> {
  const { data, error } = await adminClient()
    .from("agency_invites")
    .select("id,email,role,created_at,expires_at,used_at,revoked_at")
    .eq("agency_id", agencyId)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) return [];
  const now = Date.now();
  return (data as InviteRow[]).map((i) => ({
    id: i.id,
    email: i.email,
    role: i.role,
    createdAt: i.created_at,
    expiresAt: i.expires_at,
    status: i.used_at ? "accepted" : i.revoked_at ? "revoked" : new Date(i.expires_at).getTime() <= now ? "expired" : "pending",
  }));
}
