import { requireUser, failure, HttpError, rpc } from "@/lib/commerce/http";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * The agent's review of a proposal: compared with the real photo and approved
 * for sharing, back to unreviewed, or discarded. Discarding never refunds a
 * photo nor changes the variant limits.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser(request);
    const { id } = await params;
    if (!UUID.test(id)) throw new HttpError(404, "No encontramos esa propuesta.");
    if (Number(request.headers.get("content-length") || 0) > 1024)
      throw new HttpError(413, "Solicitud inválida.");
    const { action } = await request.json().catch(() => ({}));
    if (!["review", "unreview", "discard"].includes(action))
      throw new HttpError(400, "Elegí una acción válida.");
    await rpc("amobla_review_generation", {
      p_user: user.id,
      p_generation: id,
      p_action: action,
    });
    return Response.json({ saved: true, action });
  } catch (e) {
    return failure(e);
  }
}
