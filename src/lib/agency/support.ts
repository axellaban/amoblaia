import "server-only";
import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { HttpError, isAdmin } from "@/lib/commerce/http";
import { isUuid } from "@/lib/demos/shared";
import { adminClient } from "@/lib/supabase/server";
import type { AgencyAccount } from "./server";

/**
 * Support view: a team member sees an agency's panel as its owner would. It
 * never signs in as the agency's user (no session changes hands): a signed
 * cookie names the team member, the agency and the mode, and lasts one hour.
 * "view" (Ver como cliente) refuses every write from the panel; "act"
 * (Entrar como la inmobiliaria) works with the owner's permissions, its
 * changes are real and its stagings use the agency's credits. Starting and
 * leaving it are audited.
 */
export const SUPPORT_COOKIE = "habita_soporte";
export const SUPPORT_SECONDS = 60 * 60;
export type SupportMode = "view" | "act";
export const READ_ONLY = "Vista de soporte: solo lectura. Salí de la vista de soporte para hacer cambios desde administración.";

function secret() {
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPPORT_NOT_CONFIGURED");
  return key;
}
const sign = (payload: string) => createHmac("sha256", secret()).update(`habita-support:${payload}`).digest("hex");

/** The mode is signed with the rest: a "view" token can never be turned into "act". */
export function supportToken(agencyId: string, userId: string, now = Date.now(), mode: SupportMode = "view") {
  const payload = `${agencyId}.${userId}.${Math.floor(now / 1000) + SUPPORT_SECONDS}${mode === "act" ? ".act" : ""}`;
  return `${payload}.${sign(payload)}`;
}

/** The agency and mode the token opens, if it is valid, unexpired and for this team member. */
export function readSupport(token: string | undefined, userId: string, now = Date.now()): { agencyId: string; mode: SupportMode } | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 4 && !(parts.length === 5 && parts[3] === "act")) return null;
  const [agencyId, owner, exp] = parts;
  const mac = parts[parts.length - 1];
  if (!isUuid(agencyId) || owner !== userId || !/^\d+$/.test(exp) || Number(exp) * 1000 <= now) return null;
  const expected = Buffer.from(sign(parts.slice(0, -1).join(".")));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return { agencyId, mode: parts.length === 5 ? "act" : "view" };
}

/** The agency the token opens (either mode). */
export const readSupportToken = (token: string | undefined, userId: string, now = Date.now()) => readSupport(token, userId, now)?.agencyId ?? null;

export type SupportAgency = AgencyAccount & { supportMode: SupportMode };

/** For a team member with an active support view: the agency they are looking at, and how. */
export async function supportAgency(user: Pick<User, "id" | "email">): Promise<SupportAgency | null> {
  if (!isAdmin(user.email)) return null;
  const support = readSupport((await cookies()).get(SUPPORT_COOKIE)?.value, user.id);
  if (!support) return null;
  const { agencyId } = support;
  const { data, error } = await adminClient()
    .from("agencies")
    .select("id,name,website,slug,owner_id,site_published")
    .eq("id", agencyId)
    .maybeSingle();
  if (error) throw new Error("SUPPORT_AGENCY_LOOKUP_FAILED");
  return data ? { ...(data as AgencyAccount), supportMode: support.mode } : null;
}

/** Writes are refused in the support view; reads (GET) go through. */
export function assertReadable(request?: Request) {
  if (request && request.method !== "GET" && request.method !== "HEAD") throw new HttpError(403, READ_ONLY);
}
