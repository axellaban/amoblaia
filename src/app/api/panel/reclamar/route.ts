import { failure, HttpError, requireUser, rpc } from "@/lib/commerce/http";
import { applyAgencyCredits } from "@/lib/agency/admin";
import { agencyRpc, panelSummary } from "@/lib/agency/panel";
import { recordAgencyPanel } from "@/lib/demos/activity";
import { INVITE_CODE } from "@/lib/agency/demo-invite";
import { claimHash, membershipOf } from "@/lib/agency/server";
import { slugify } from "@/lib/agency/shared";
import { readJson } from "@/lib/demos/input";
import { adminClient } from "@/lib/supabase/server";
import { recordClaim } from "@/lib/agency/invitation";
export const runtime = "nodejs";

/**
 * Takes over the agency the team prepared demos for, with the one-time code
 * the team gave it ({ code }). Opening a demo is never enough: without a
 * valid, unused and unexpired code nothing is transferred.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = await readJson(request, 1024);
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!INVITE_CODE.test(code)) throw new HttpError(404, "Ese código no es válido o ya se usó. Pedile uno nuevo al equipo de habita.");
    const hash = claimHash(code);
    const { data } = await adminClient()
      .from("agency_claims")
      .select("agencies(name)")
      .eq("code_hash", hash)
      .maybeSingle();
    const name = (data as unknown as { agencies: { name: string } | null } | null)?.agencies?.name ?? "inmobiliaria";
    await rpc("amobla_account", { p_user: user.id, p_trial: false });
    const agencyId = await agencyRpc<string>("habita_claim_agency", { p_user: user.id, p_code_hash: hash, p_slug: slugify(name) });
    // Credits the team left waiting for this agency move to its new owner.
    await applyAgencyCredits(agencyId);
    await recordAgencyPanel(agencyId);
    // Google proves the address; any other existing account signed in with its own password.
    await recordClaim(agencyId, user, user.app_metadata?.provider === "google" ? "google" : "existing");
    const membership = await membershipOf(user.id);
    return Response.json(await panelSummary(membership!), { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return failure(e);
  }
}
