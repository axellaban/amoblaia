import "server-only";
import { createHash } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { HttpError, isAdmin, requireUser } from "@/lib/commerce/http";
import { demoRow } from "@/lib/demos/server";
import { isUuid } from "@/lib/demos/shared";
import { adminClient } from "@/lib/supabase/server";
import type { AgencyRole } from "./shared";
import { assertEditTarget, editContextOf } from "./edit-context";
import { assertReadable, supportAgency } from "./support";

export type AgencyAccount = {
  id: string;
  name: string;
  website: string | null;
  slug: string | null;
  owner_id: string | null;
  site_published: boolean;
};
/** support: a team member looking at this agency's panel (read only). */
export type Membership = { role: AgencyRole; agency: AgencyAccount; support?: boolean };
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

/**
 * The panel this account sees: a team member's active support view (the
 * agency as its owner sees it, read only), else the agency it works for.
 */
export async function membershipFor(user: Pick<User, "id" | "email">): Promise<Membership | null> {
  const viewing = await supportAgency(user);
  if (viewing) return { role: "owner", agency: viewing, support: true };
  return membershipOf(user.id);
}

/** A verified account that works for an agency (or the team in a support view, which only reads). */
export async function requireAgency(request?: Request) {
  const user = await requireUser(request);
  const membership = await membershipFor(user);
  if (!membership) throw new HttpError(404, "Todavía no creaste tu inmobiliaria.");
  if (membership.support) assertReadable(request);
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
  // From the panel in a support view the team only reads, like the agency's panel itself.
  if (admin && request && request.method !== "GET") {
    let fromPanel = false;
    try {
      fromPanel = new URL(request.headers.get("referer") ?? "").pathname.startsWith("/panel");
    } catch {
      // No referer: not the panel.
    }
    if (fromPanel && (await supportAgency(actor))) assertReadable(request);
  }
  // Accounts outside any agency are turned away before any property is read.
  const membership = admin ? null : await membershipOf(actor.id);
  if (!admin && !membership) throw new HttpError(404, "No encontramos la demo.");
  // A tab editing one agency (Editar inmobiliaria) only reads and writes that agency's properties.
  // The context is the team's: anyone else sending one is refused, never silently ignored.
  const editContext = editContextOf(request, actor);
  const demo = await demoRow(demoId);
  if (membership && membership.agency.id !== demo.agency_id) throw new HttpError(404, "No encontramos la demo.");
  assertEditTarget(editContext, demo.agency_id);
  const { data, error } = await adminClient()
    .from("agencies")
    .select("owner_id")
    .eq("id", demo.agency_id)
    .single();
  // Before 202610280001_agency_accounts.sql there are no owners: the team's
  // demos keep working as they did.
  if (error && !admin) throw new Error("AGENCY_LOOKUP_FAILED");
  const billingUser = error ? null : ((data as { owner_id: string | null }).owner_id ?? null);
  return { actor, demo, admin, role: (membership?.role ?? null) as AgencyRole | null, billingUser, editContext };
}
export type DemoAccess = Awaited<ReturnType<typeof requireDemoAccess>>;

/** Why the team cannot stage an agency's photos from the admin panel. */
export const TEAM_ON_AGENCY = "Esta inmobiliaria ya tiene su cuenta: las ambientaciones se crean desde su panel, con sus créditos.";

/**
 * Who pays a new version of a property's photo, and whether this account may
 * create it here. The quote, the reservation and the editor use this same
 * rule: the team stages demos of agencies without an account (free); an
 * agency with an account pays with its owner's credits, and the team never
 * spends them, unless the team member is that owner.
 */
export function stagingRule(access: Pick<DemoAccess, "actor" | "admin" | "billingUser">) {
  if (!access.billingUser) return { payer: "team" as const, blocked: null };
  return {
    payer: "agency" as const,
    blocked: access.admin && access.billingUser !== access.actor.id ? TEAM_ON_AGENCY : null,
  };
}

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
