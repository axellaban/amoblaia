import "server-only";
import { HttpError, rpc } from "@/lib/commerce/http";
import { adminClient } from "@/lib/supabase/server";
import { recordAgencyPanel } from "@/lib/demos/activity";
import { applyAgencyCredits } from "./admin";
import { agencyRpc } from "./panel";
import { claimHash } from "./server";
import { slugify } from "./shared";

export const validCode = (code: unknown): code is string => typeof code === "string" && /^[A-Za-z0-9_-]{20,64}$/.test(code);

export type Invitation = { agencyId: string; agencyName: string; properties: number; freeCredits: number; expiresAt: string };

/**
 * What an invitation link opens: the agency it is for, its demos and the
 * credits waiting for it. Null when the code is unknown, used, revoked or
 * expired, or the agency already has its account.
 */
export async function invitationOf(code: string | null): Promise<Invitation | null> {
  if (!validCode(code)) return null;
  const db = adminClient();
  const { data, error } = await db
    .from("agency_claims")
    .select("agency_id,expires_at,used_at,revoked_at,agencies(name,owner_id)")
    .eq("code_hash", claimHash(code))
    .maybeSingle();
  if (error) throw new Error("INVITATION_LOOKUP_FAILED");
  const c = data as unknown as {
    agency_id: string;
    expires_at: string;
    used_at: string | null;
    revoked_at: string | null;
    agencies: { name: string; owner_id: string | null } | null;
  } | null;
  if (!c?.agencies || c.used_at || c.revoked_at || c.agencies.owner_id || new Date(c.expires_at).getTime() <= Date.now()) return null;
  const [demos, pending] = await Promise.all([
    db.from("demos").select("id", { count: "exact", head: true }).eq("agency_id", c.agency_id),
    db.from("agencies").select("free_credits_pending").eq("id", c.agency_id).maybeSingle(),
  ]);
  return {
    agencyId: c.agency_id,
    agencyName: c.agencies.name,
    properties: demos.count ?? 0,
    freeCredits: pending.error ? 0 : ((pending.data as { free_credits_pending: number } | null)?.free_credits_pending ?? 0),
    expiresAt: c.expires_at,
  };
}

/**
 * Accepts an invitation with a new account: only an e-mail and a password.
 * The one-time link the team sent privately stands for the invitation, so
 * the account starts verified. The code is checked before the account is
 * created; if the agency cannot be taken over, that new account is removed.
 */
export async function acceptWithNewAccount(code: unknown, email: unknown, password: unknown) {
  if (!validCode(code)) throw new HttpError(404, "Esta invitación no es válida. Pedile un enlace nuevo al equipo de habita.");
  const mail = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!/^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(mail) || mail.length > 200) throw new HttpError(400, "Revisá el email.");
  if (typeof password !== "string" || password.length < 8 || password.length > 72)
    throw new HttpError(400, "La contraseña tiene que tener entre 8 y 72 caracteres.");
  const invitation = await invitationOf(code);
  if (!invitation) throw new HttpError(404, "Esta invitación venció o ya se usó. Pedile un enlace nuevo al equipo de habita.");

  const auth = adminClient().auth.admin;
  const created = await auth.createUser({ email: mail, password, email_confirm: true });
  if (created.error || !created.data.user) {
    const msg = `${created.error?.code ?? ""} ${created.error?.message ?? ""}`.toLowerCase();
    if (msg.includes("exist") || msg.includes("registered"))
      throw new HttpError(409, "Ese email ya tiene una cuenta en habita. Ingresá con tu contraseña para sumar tus demos.");
    if (msg.includes("password")) throw new HttpError(400, "Elegí una contraseña más segura (por lo menos 8 caracteres, con letras y números).");
    throw new Error("INVITATION_SIGNUP_FAILED");
  }
  const userId = created.data.user.id;
  try {
    await rpc("amobla_account", { p_user: userId, p_trial: false });
    const agencyId = await agencyRpc<string>("habita_claim_agency", {
      p_user: userId,
      p_code_hash: claimHash(code),
      p_slug: slugify(invitation.agencyName),
    });
    await applyAgencyCredits(agencyId);
    await recordAgencyPanel(agencyId);
    return { agencyId, email: mail };
  } catch (e) {
    // The account was only for this invitation: nothing is left half done.
    await auth.deleteUser(userId).catch(() => null);
    throw e;
  }
}
