import "server-only";
import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { HttpError, isAdmin } from "@/lib/commerce/http";
import { isUuid } from "@/lib/demos/shared";
import { adminClient } from "@/lib/supabase/server";
import type { AgencyAccount } from "./server";

/**
 * Support view: a team member sees an agency's panel as its owner would,
 * read only. It never signs in as the agency's user (no session changes
 * hands): a signed cookie names the team member and the agency, lasts one
 * hour, and every write from the panel is refused while it is active.
 * Starting and leaving it are audited.
 */
export const SUPPORT_COOKIE = "habita_soporte";
export const SUPPORT_SECONDS = 60 * 60;
export const READ_ONLY = "Vista de soporte: solo lectura. Salí de la vista de soporte para hacer cambios desde administración.";

function secret() {
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPPORT_NOT_CONFIGURED");
  return key;
}
const sign = (payload: string) => createHmac("sha256", secret()).update(`habita-support:${payload}`).digest("hex");

export function supportToken(agencyId: string, userId: string, now = Date.now()) {
  const payload = `${agencyId}.${userId}.${Math.floor(now / 1000) + SUPPORT_SECONDS}`;
  return `${payload}.${sign(payload)}`;
}

/** The agency the token opens, if it is valid, unexpired and for this team member. */
export function readSupportToken(token: string | undefined, userId: string, now = Date.now()) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [agencyId, owner, exp, mac] = parts;
  if (!isUuid(agencyId) || owner !== userId || !/^\d+$/.test(exp) || Number(exp) * 1000 <= now) return null;
  const expected = Buffer.from(sign(`${agencyId}.${owner}.${exp}`));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return agencyId;
}

/** For a team member with an active support view: the agency they are looking at. */
export async function supportAgency(user: Pick<User, "id" | "email">): Promise<AgencyAccount | null> {
  if (!isAdmin(user.email)) return null;
  const agencyId = readSupportToken((await cookies()).get(SUPPORT_COOKIE)?.value, user.id);
  if (!agencyId) return null;
  const { data, error } = await adminClient()
    .from("agencies")
    .select("id,name,website,slug,owner_id,site_published")
    .eq("id", agencyId)
    .maybeSingle();
  if (error) throw new Error("SUPPORT_AGENCY_LOOKUP_FAILED");
  return (data as AgencyAccount | null) ?? null;
}

/** Writes are refused in the support view; reads (GET) go through. */
export function assertReadable(request?: Request) {
  if (request && request.method !== "GET" && request.method !== "HEAD") throw new HttpError(403, READ_ONLY);
}
