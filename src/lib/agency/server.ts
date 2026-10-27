import "server-only";
import { createHash } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { HttpError, isAdmin, requireUser } from "@/lib/commerce/http";
import { demoRow } from "@/lib/demos/server";
import { isUuid } from "@/lib/demos/shared";
import { adminClient } from "@/lib/supabase/server";
import type { AgencyRole } from "./shared";

export type AgencyAccount = {
  id: string;
  name: string;
  website: string | null;
  slug: string | null;
  owner_id: string | null;
  site_published: boolean;
};
export type Membership = { role: AgencyRole; agency: AgencyAccount };
const AGENCY_FIELDS = "id,name,website,slug,owner_id,site_published";

/** The agency this account works for, if any (one per account for now). */
export async function membershipOf(userId: string): Promise<Membership | null> {
  const { data, error } = await adminClient()
    .from("agency_members")
    .select(`role,agencies(${AGENCY_FIELDS})`)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("MEMBERSHIP_LOOKUP_FAILED");
  const row = data as { role: AgencyRole; agencies: AgencyAccount | null } | null;
  return row?.agencies ? { role: row.role, agency: row.agencies } : null;
}

/** A verified account that works for an agency. */
export async function requireAgency(request?: Request) {
  const user = await requireUser(request);
  const membership = await membershipOf(user.id);
  if (!membership) throw new HttpError(404, "Todavía no creaste tu inmobiliaria.");
  return { user, ...membership };
}

/**
 * Who may work on a property page (a demo row): the team, on any of them, or
 * a member of the agency it belongs to. Anyone else gets "not found", so a
 * property of another agency is not even revealed. `billingUser` is the
 * account whose credits pay its stagings: the agency's owner, or null for a
 * demo the team prepares (staged with the team's zero-balance demo grant).
 */
export async function requireDemoAccess(request: Request | undefined, demoId: string) {
  const actor = await requireUser(request);
  const admin = isAdmin(actor.email);
  // Accounts outside any agency are turned away before any property is read.
  const membership = admin ? null : await membershipOf(actor.id);
  if (!admin && !membership) throw new HttpError(404, "No encontramos la demo.");
  const demo = await demoRow(demoId);
  if (membership && membership.agency.id !== demo.agency_id) throw new HttpError(404, "No encontramos la demo.");
  const { data, error } = await adminClient()
    .from("agencies")
    .select("owner_id")
    .eq("id", demo.agency_id)
    .single();
  // Before 202610280001_agency_accounts.sql there are no owners: the team's
  // demos keep working as they did.
  if (error && !admin) throw new Error("AGENCY_LOOKUP_FAILED");
  const billingUser = error ? null : ((data as { owner_id: string | null }).owner_id ?? null);
  return { actor, demo, admin, role: (membership?.role ?? null) as AgencyRole | null, billingUser };
}
export type DemoAccess = Awaited<ReturnType<typeof requireDemoAccess>>;

/**
 * The agency a demo photo or a proposal belongs to, for the panel's image
 * route: members only see their own agency's pictures.
 */
export async function imageAgency(params: { photoId?: string | null; generationId?: string | null }) {
  const db = adminClient();
  let projectId: string | null = null;
  let photoId = params.photoId ?? null;
  if (params.generationId) {
    if (!isUuid(params.generationId)) return null;
    const { data } = await db.from("generations").select("project_id").eq("id", params.generationId).maybeSingle();
    projectId = (data as { project_id: string } | null)?.project_id ?? null;
    if (!projectId) return null;
    photoId = null;
  } else if (!isUuid(photoId)) return null;
  let query = db.from("demo_photos").select("demo_properties!inner(agency_id)");
  query = photoId ? query.eq("id", photoId) : query.eq("project_id", projectId!);
  const { data, error } = await query.limit(5);
  if (error) throw new Error("IMAGE_AGENCY_LOOKUP_FAILED");
  const agencies = new Set(
    (data as unknown as { demo_properties: { agency_id: string } }[]).map((r) => r.demo_properties.agency_id),
  );
  return [...agencies];
}

/** For the team and for members: may this account see that picture? */
export async function canSeeImage(user: User, params: { photoId?: string | null; generationId?: string | null }) {
  if (isAdmin(user.email)) return true;
  const membership = await membershipOf(user.id);
  if (!membership) return false;
  return (await imageAgency(params))?.includes(membership.agency.id) ?? false;
}

/** Claim codes are stored only as their hash. */
export const claimHash = (code: string) => createHash("sha256").update(code).digest("hex");
