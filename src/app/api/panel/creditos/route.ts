import { failure } from "@/lib/commerce/http";
import { agencyCredits } from "@/lib/agency/panel";
import { requireAgency } from "@/lib/agency/server";
import { adminClient } from "@/lib/supabase/server";
export const runtime = "nodejs";

/**
 * The agency's credits: one balance, its owner's account, which pays every
 * staging of its properties. Everyone sees the balance and who pays; only
 * the owner sees the plans, the history and buys. Never the signed-in
 * collaborator's personal account.
 */
export async function GET() {
  try {
    const { user, agency, role } = await requireAgency();
    const owner = agency.owner_id;
    const credits = await agencyCredits(owner);
    const base = { role, payer: { agency: agency.name, isYou: owner === user.id }, credits, creditsError: credits === null };
    if (role !== "owner" || !owner)
      return Response.json(base, { headers: { "Cache-Control": "private, no-store" } });
    const db = adminClient();
    const [grants, ledger] = await Promise.all([
      db
        .from("credit_grants")
        .select("id,remaining,total,expires_at,source_key,revoked,created_at")
        .eq("user_id", owner)
        .not("source_key", "like", "demo:%")
        .order("created_at", { ascending: false })
        .limit(30),
      db
        .from("credit_ledger")
        .select("delta,reason,created_at")
        .eq("user_id", owner)
        .order("created_at", { ascending: false })
        .limit(30),
    ]);
    if (grants.error || ledger.error) throw new Error("CREDITS_LOOKUP_FAILED");
    return Response.json(
      { ...base, grants: grants.data, ledger: ledger.data },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
