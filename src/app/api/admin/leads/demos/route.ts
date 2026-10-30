import { requireAdmin, failure } from "@/lib/commerce/http";
import { demoScores } from "@/lib/leads/server";

const PRIVATE = { "Cache-Control": "private, no-store" };

/** demo id → score, class and visitors: what the demo list shows next to each demo, loaded after the list. */
export async function GET() {
  try {
    await requireAdmin();
    return Response.json(await demoScores(), { headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}
