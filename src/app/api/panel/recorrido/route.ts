import { failure, HttpError, requireUser } from "@/lib/commerce/http";
import { membershipFor } from "@/lib/agency/server";
import { TOUR_VERSION, tourEligible } from "@/lib/agency/panel-tour";
import { adminClient } from "@/lib/supabase/server";
export const runtime = "nodejs";

const PRIVATE = { "Cache-Control": "private, no-store" };
const no = () => Response.json({ eligible: false }, { headers: PRIVATE });

/**
 * Whether the panel's welcome tour starts by itself for this account: once,
 * for a recent member that has not seen it (any device). A visitor, the
 * team's support view or a failed lookup (also: before the migration
 * 202611290001_panel_tour.sql) answer no: the tour never starts by mistake.
 */
export async function GET() {
  try {
    const user = await requireUser().catch((e) => {
      if (e instanceof HttpError && e.status === 401) return null;
      throw e;
    });
    if (!user) return no();
    const membership = await membershipFor(user);
    if (!membership || membership.support || membership.visitor) return no();
    const db = adminClient();
    const [profile, member] = await Promise.all([
      db.from("profiles").select("panel_tour_seen_at").eq("id", user.id).maybeSingle(),
      db.from("agency_members").select("created_at").eq("user_id", user.id).eq("agency_id", membership.agency.id).maybeSingle(),
    ]);
    if (profile.error || member.error) return no();
    const seenAt = (profile.data as { panel_tour_seen_at: string | null } | null)?.panel_tour_seen_at;
    const joinedAt = (member.data as { created_at: string } | null)?.created_at;
    return Response.json({ eligible: tourEligible({ seenAt, joinedAt }) }, { headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}

/** The tour was shown to this account (started by itself or from «Ayuda»): it does not start by itself again. */
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const membership = await membershipFor(user);
    // The team's support view looks at the agency's panel: it never marks the agency's account.
    if (!membership || membership.support) return Response.json({ ok: true, saved: false });
    const { error } = await adminClient()
      .from("profiles")
      .upsert({ id: user.id, panel_tour_seen_at: new Date().toISOString(), panel_tour_version: TOUR_VERSION }, { onConflict: "id" });
    if (error) throw new Error("PANEL_TOUR_SAVE_FAILED");
    return Response.json({ ok: true, saved: true });
  } catch (e) {
    return failure(e);
  }
}
