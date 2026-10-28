import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { HttpError, isAdmin, rpc } from "@/lib/commerce/http";
import { isUuid } from "@/lib/demos/shared";
import { adminClient } from "@/lib/supabase/server";
import { EDIT_HEADER } from "./edit-scope";

/**
 * Administrative edit of an agency ("Editar inmobiliaria"): a team member
 * works on one agency's data, brand, properties, photos and publication
 * from administration, as themselves. It never signs in as the agency's
 * owner and never touches the support view (which stays read only).
 *
 * The context is a signed token naming the team member, the agency and an
 * expiry. Each tab keeps its own (sessionStorage) and sends it in a header
 * on every write; the server checks that it is valid, that it belongs to
 * this team member and that its agency is the one that owns the resource.
 * Two tabs on two agencies never mix: a write from a tab is checked against
 * that tab's agency, not against a cookie shared by the browser.
 */
export const EDIT_SECONDS = 4 * 60 * 60;

function secret() {
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("EDIT_CONTEXT_NOT_CONFIGURED");
  return key;
}
// A different prefix from the support view's: one token can never be read as the other.
const sign = (payload: string) => createHmac("sha256", secret()).update(`habita-edit:${payload}`).digest("hex");

export function editToken(agencyId: string, userId: string, now = Date.now()) {
  const payload = `e1.${agencyId}.${userId}.${Math.floor(now / 1000) + EDIT_SECONDS}`;
  return { token: `${payload}.${sign(payload)}`, expiresAt: new Date((Math.floor(now / 1000) + EDIT_SECONDS) * 1000).toISOString() };
}

export type EditContext = { agencyId: string; expiresAt: string };
/** The agency the token opens, if it is well signed, unexpired and for this team member. */
export function readEditToken(token: string | null | undefined, userId: string, now = Date.now()): EditContext | null {
  if (!token || token.length > 300) return null;
  const parts = token.split(".");
  if (parts.length !== 5 || parts[0] !== "e1") return null;
  const [, agencyId, owner, exp, mac] = parts;
  if (!isUuid(agencyId) || owner !== userId || !/^\d+$/.test(exp) || Number(exp) * 1000 <= now) return null;
  const expected = Buffer.from(sign(`e1.${agencyId}.${owner}.${exp}`));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return { agencyId, expiresAt: new Date(Number(exp) * 1000).toISOString() };
}

export const EDIT_EXPIRED = "La edición de esta inmobiliaria venció o no es válida. Renovala desde el aviso de arriba: no se guardó nada y tus cambios sin guardar siguen en pantalla.";
export const EDIT_OTHER_AGENCY =
  "Esta pestaña está editando otra inmobiliaria. No se guardó nada: recargá la página o volvé a administración.";

/**
 * The edit context a request carries, if any. Absent: null (the admin's
 * older pages, which act on one demo at a time, keep working). Present but
 * invalid, expired or someone else's: refused, never ignored, so a stale
 * tab does not silently write without its context.
 */
export function editContextOf(request: Request | undefined, actor: Pick<User, "id" | "email">): EditContext | null {
  const raw = request?.headers.get(EDIT_HEADER);
  if (!raw) return null;
  if (!isAdmin(actor.email)) throw new HttpError(403, "Acceso reservado al equipo.");
  const ctx = readEditToken(raw, actor.id);
  if (!ctx) throw new HttpError(412, EDIT_EXPIRED);
  return ctx;
}

/** The resource belongs to the agency this tab is editing; anything else is refused before a write. */
export function assertEditTarget(ctx: EditContext | null, agencyId: string) {
  if (ctx && ctx.agencyId !== agencyId) throw new HttpError(409, EDIT_OTHER_AGENCY);
}

/** For agency-level writes (its data, its brand): the context is required and must be this agency's. */
export function requireEditContext(request: Request, actor: Pick<User, "id" | "email">, agencyId: string) {
  const ctx = editContextOf(request, actor);
  if (!ctx) throw new HttpError(412, EDIT_EXPIRED);
  assertEditTarget(ctx, agencyId);
  return ctx;
}

/**
 * One row of the agency's activity: who on the team did what to which
 * agency, and from where (an edit context or the older demo pages).
 * Profiles back admin_audit's actor reference.
 */
export async function auditAgency(actorId: string, agencyId: string, action: string, details: Record<string, unknown> = {}) {
  await rpc("amobla_account", { p_user: actorId, p_trial: false });
  const { error } = await adminClient().from("admin_audit").insert({ actor_id: actorId, action, subject_id: agencyId, details });
  if (error) throw new Error("AGENCY_AUDIT_FAILED");
}

/**
 * Records a write the team made on an agency's resource, after it was
 * saved. A failure to record it is logged; the saved change is not undone
 * (it would leave the editor out of step with the database).
 */
export async function auditAgencyEdit(
  access: { admin: boolean; actor: { id: string }; demo?: { id: string; agency_id: string }; editContext?: EditContext | null },
  operation: string,
  details: Record<string, unknown> = {},
  agencyId = access.demo?.agency_id,
) {
  if (!access.admin || !agencyId) return;
  try {
    await auditAgency(access.actor.id, agencyId, "agency_edit", {
      operation,
      ...(access.demo ? { demo: access.demo.id } : {}),
      via: access.editContext ? "edit_context" : "admin_demo",
      ...details,
    });
  } catch {
    console.error("agency_edit_audit_failed", operation);
  }
}
