import "server-only";
import type { User } from "@supabase/supabase-js";
import { adminClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/commerce/http";
import { recordAgencyPanel } from "@/lib/demos/activity";
import { isInternalUser } from "@/lib/internal/server";
import { claimWithCode } from "./invitation";
import { membershipOf } from "./server";
import { claimCodeFromVisit, currentVisit } from "./visit";

/** Where a signed-in account that came through an agency's link finishes entering it (see joinFromVisit). */
export const JOIN_PATH = "/panel/visita/entrar";
export const joinPath = (back: string | null = null) => (back && back !== "/panel" ? `${JOIN_PATH}?${new URLSearchParams({ volver: back })}` : JOIN_PATH);

/**
 * The account enters the agency of the link it came from, without asking:
 * the demo's link or the panel's link left the visit cookie, and creating an
 * account (or signing in) is enough. The first account of an agency without
 * one keeps it (its demos, stagings and credits, the claim of always); any
 * later one joins as an editor, and the owner's role is changed by the team.
 * Null when there is nothing to join: no visit, the team, or an account that
 * already works for an agency.
 */
export async function joinFromVisit(user: Pick<User, "id" | "email" | "app_metadata">): Promise<string | null> {
  if (isAdmin(user.email ?? undefined)) return null;
  if (await membershipOf(user.id)) return null;
  const visit = await currentVisit();
  if (!visit) return null;
  if (!visit.claimed) return claimWithCode(user, await claimCodeFromVisit(visit));
  const db = adminClient();
  await db.from("profiles").upsert({ id: user.id }, { onConflict: "id", ignoreDuplicates: true });
  const profile = await db.from("profiles").select("blocked").eq("id", user.id).maybeSingle();
  if ((profile.data as { blocked?: boolean } | null)?.blocked) throw new Error("ACCOUNT_BLOCKED");
  const { error } = await db.from("agency_members").insert({ agency_id: visit.agency.id, user_id: user.id, role: "editor" });
  // A second tab that joined first: the account already works for an agency.
  if (error && error.code !== "23505") throw new Error("AGENCY_JOIN_FAILED");
  await recordAgencyPanel(visit.agency.id, await isInternalUser(user)).catch(() => null);
  await db.from("admin_audit").insert({ actor_id: user.id, action: "agency_join_link", subject_id: visit.agency.id, details: { role: "editor" } });
  return visit.agency.id;
}
