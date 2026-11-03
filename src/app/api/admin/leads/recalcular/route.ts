import { requireAdmin, failure } from "@/lib/commerce/http";
import { recomputeAll } from "@/lib/leads/server";
export const maxDuration = 300;

const PRIVATE = { "Cache-Control": "private, no-store" };

/** Full recalculation from every stored event (audit): gives the same rows as the incremental updates. */
export async function POST(request: Request) {
  try {
    await requireAdmin(request);
    return Response.json(await recomputeAll(), { headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}
