import { requireAdmin, failure } from "@/lib/commerce/http";
import { leadOverview } from "@/lib/leads/server";

const PRIVATE = { "Cache-Control": "private, no-store" };

/** The Leads / Engagement overview: agencies and demos ranked by the stored scores. */
export async function GET() {
  try {
    await requireAdmin();
    return Response.json(await leadOverview(), { headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}
