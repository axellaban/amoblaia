import { failure, HttpError, requireAdmin } from "@/lib/commerce/http";
import { createClaim } from "@/lib/agency/admin";
import { isUuid } from "@/lib/demos/shared";
export const runtime = "nodejs";

/** A new invitation (one-time link) for an agency without an account. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireAdmin(request);
    const { id } = await params;
    if (!isUuid(id)) throw new HttpError(404, "No encontramos la inmobiliaria.");
    const claim = await createClaim(id, actor.id, new URL(request.url).origin);
    return Response.json(claim, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return failure(e);
  }
}
