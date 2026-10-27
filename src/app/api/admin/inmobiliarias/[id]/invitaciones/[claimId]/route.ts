import { failure, HttpError, requireAdmin } from "@/lib/commerce/http";
import { revokeClaim } from "@/lib/agency/admin";
import { isUuid } from "@/lib/demos/shared";
export const runtime = "nodejs";

/** Revokes an invitation that was not used yet (audited). */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; claimId: string }> }) {
  try {
    const actor = await requireAdmin(request);
    const { id, claimId } = await params;
    if (!isUuid(id) || !isUuid(claimId)) throw new HttpError(404, "No encontramos la invitación.");
    await revokeClaim(id, claimId, actor.id);
    return new Response(null, { status: 204 });
  } catch (e) {
    return failure(e);
  }
}
