import { failure, HttpError, requireAdmin } from "@/lib/commerce/http";
import { isUuid } from "@/lib/demos/shared";
import { adminClient } from "@/lib/supabase/server";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/** The team checked who took over this agency: its claim is marked as verified (recorded in admin_audit). */
export async function POST(request: Request, { params }: Params) {
  try {
    const actor = await requireAdmin(request);
    const { id } = await params;
    if (!isUuid(id)) throw new HttpError(404, "No encontramos la inmobiliaria.");
    const db = adminClient();
    const { data, error } = await db
      .from("agencies")
      .update({ claim_review: "confirmed", claim_reviewed_at: new Date().toISOString() })
      .eq("id", id)
      .not("owner_id", "is", null)
      .select("id")
      .maybeSingle();
    if (error) throw new Error("CLAIM_REVIEW_FAILED");
    if (!data) throw new HttpError(404, "Esta inmobiliaria todavía no tiene cuenta.");
    await db.from("admin_audit").insert({ actor_id: actor.id, action: "agency_claim_confirmed", subject_id: id, details: {} });
    return Response.json({ review: "confirmed" }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return failure(e);
  }
}
