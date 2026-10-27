import { failure, HttpError, requireAdmin } from "@/lib/commerce/http";
import { applyAgencyCreditsNow, giveAgencyCredits } from "@/lib/agency/admin";
import { readJson } from "@/lib/demos/input";
import { isUuid } from "@/lib/demos/shared";
export const runtime = "nodejs";

/**
 * Free credits for an agency (a gift or adjustment, not a sale): { key, photos, reason }.
 * The key makes the same request credit once. With an account they go to
 * its owner's balance; without one, they wait until it claims its account.
 * { apply: true } moves credits left waiting on an agency that already has an owner.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireAdmin(request);
    const { id } = await params;
    if (!isUuid(id)) throw new HttpError(404, "No encontramos la inmobiliaria.");
    const body = await readJson(request, 2048);
    if (body.apply === true) return Response.json({ applied: await applyAgencyCreditsNow(id) }, { headers: { "Cache-Control": "private, no-store" } });
    const result = await giveAgencyCredits(actor.id, id, body.photos, body.reason, body.key);
    return Response.json(result, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return failure(e);
  }
}
