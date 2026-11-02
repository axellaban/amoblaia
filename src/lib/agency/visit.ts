import "server-only";
import { cookies } from "next/headers";
import { createHash } from "node:crypto";
import { HttpError } from "@/lib/commerce/http";
import { adminClient } from "@/lib/supabase/server";
import { INVITE_CODE } from "./demo-invite";
import { readVisit, VISIT_COOKIE, visitToken } from "./visit-token";
import type { AgencyAccount, Membership } from "./server";

/**
 * The prospect's visit to its own panel (see visit-token.ts): it reads
 * everything as the owner would, and every change asks it to create its
 * account first. The code is checked on every request.
 */
export const VISIT_READ_ONLY = "Estás recorriendo tu panel como invitado. Creá tu cuenta gratis para guardar cambios y ambientar fotos.";

/** The error a visitor's change gets: the panel opens the "create your account" step with it. */
export class VisitorError extends HttpError {
  code = "visita";
  constructor() {
    super(403, VISIT_READ_ONLY);
  }
}

function secret() {
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("VISIT_NOT_CONFIGURED");
  return key;
}

const AGENCY_FIELDS = "id,name,website,slug,owner_id,site_published";

export type LiveInvitation = { agency: AgencyAccount; expiresAt: string; demoToken: string | null };

/** The invitation a code opens while it can still be used: unexpired, unused, unrevoked, for an agency without its account. */
export async function liveInvitation(code: string): Promise<LiveInvitation | null> {
  if (!INVITE_CODE.test(code)) return null;
  const db = adminClient();
  const hash = createHash("sha256").update(code).digest("hex");
  let res = await db
    .from("agency_claims")
    .select(`expires_at,used_at,revoked_at,demo_id,agencies(${AGENCY_FIELDS})`)
    .eq("code_hash", hash)
    .maybeSingle();
  // Before 202611160001_short_demo_links.sql there is no demo_id.
  if (res.error)
    res = (await db
      .from("agency_claims")
      .select(`expires_at,used_at,revoked_at,agencies(${AGENCY_FIELDS})`)
      .eq("code_hash", hash)
      .maybeSingle()) as typeof res;
  if (res.error) throw new Error("VISIT_LOOKUP_FAILED");
  const c = res.data as unknown as {
    expires_at: string;
    used_at: string | null;
    revoked_at: string | null;
    demo_id?: string | null;
    agencies: AgencyAccount | null;
  } | null;
  if (!c?.agencies || c.used_at || c.revoked_at || c.agencies.owner_id || new Date(c.expires_at).getTime() <= Date.now()) return null;
  let demoToken: string | null = null;
  if (c.demo_id) {
    const { data } = await db.from("demos").select("token").eq("id", c.demo_id).maybeSingle();
    demoToken = (data as { token: string } | null)?.token ?? null;
  }
  return { agency: c.agencies, expiresAt: c.expires_at, demoToken };
}

/** Starts the visit: the signed cookie, until the invitation expires (a week at most). */
export async function startVisit(code: string, invitation: LiveInvitation) {
  (await cookies()).set(VISIT_COOKIE, visitToken(code, secret(), Date.now(), new Date(invitation.expiresAt).getTime()), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.max(60, Math.floor((new Date(invitation.expiresAt).getTime() - Date.now()) / 1000)),
  });
}

/** The visit's code and invitation, while both are valid. A failed lookup is no visit. */
export async function currentVisit(): Promise<(LiveInvitation & { code: string }) | null> {
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  const visit = readVisit((await cookies()).get(VISIT_COOKIE)?.value, key);
  if (!visit) return null;
  const invitation = await liveInvitation(visit.code).catch(() => null);
  return invitation ? { ...invitation, code: visit.code } : null;
}

/** The panel a visitor sees: its agency, as the owner would. */
export async function visitorMembership(): Promise<Membership | null> {
  const visit = await currentVisit();
  return visit ? { role: "owner", agency: visit.agency, scope: null, visitor: true } : null;
}

