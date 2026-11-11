import { failure, HttpError, requireAdmin } from "@/lib/commerce/http";
import { releaseAgency } from "@/lib/agency/admin";
import { isUuid } from "@/lib/demos/shared";
export const runtime = "nodejs";

/** «Liberar cuenta»: the agency goes back to having no account, as before a test claim (audited). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireAdmin(request);
    const { id } = await params;
    if (!isUuid(id)) throw new HttpError(404, "No encontramos la inmobiliaria.");
    return Response.json(await releaseAgency(id, actor.id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return failure(e);
  }
}
