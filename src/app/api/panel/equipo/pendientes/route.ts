import { failure } from "@/lib/commerce/http";
import { requireAgency } from "@/lib/agency/server";
import { canManage } from "@/lib/agency/shared";
import { adminClient } from "@/lib/supabase/server";
import { principalOf } from "@/lib/agency/workspace";
export const runtime = "nodejs";

/**
 * What waits for this account in «Equipo y accesos», for the badge in the
 * panel's navigation: requests to join (administrators) and requests for the
 * administration (the principal). Counts only: no names or e-mails.
 */
export async function GET() {
  try {
    const membership = await requireAgency();
    const { user, agency, role } = membership;
    const db = adminClient();
    const [requests, principal] = await Promise.all([
      canManage(role)
        ? db.from("agency_access_requests").select("id", { count: "exact", head: true }).eq("agency_id", agency.id).eq("status", "pending")
        : null,
      principalOf(agency.id, agency.owner_id),
    ]);
    const transfers =
      principal === user.id
        ? await db.from("agency_admin_transfers").select("id", { count: "exact", head: true }).eq("agency_id", agency.id).eq("status", "pending")
        : null;
    const total = (requests && !requests.error ? (requests.count ?? 0) : 0) + (transfers && !transfers.error ? (transfers.count ?? 0) : 0);
    return Response.json({ total }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return failure(e);
  }
}
