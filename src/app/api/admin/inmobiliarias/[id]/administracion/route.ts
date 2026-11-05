import { failure, HttpError, requireAdmin } from "@/lib/commerce/http";
import { isUuid } from "@/lib/demos/shared";
import { accessRequestsOf, supportResolveAdminTransfer, transfersOf } from "@/lib/agency/workspace";
import { readJson } from "@/lib/demos/input";
import { adminClient } from "@/lib/supabase/server";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };
const PRIVATE = { "Cache-Control": "private, no-store" };

/** The team's view of an agency's open requests: to join it, and to become its principal administrator. */
export async function GET(_request: Request, { params }: Params) {
  try {
    await requireAdmin();
    const { id } = await params;
    if (!isUuid(id)) throw new HttpError(404, "No encontramos la inmobiliaria.");
    const [requests, transfers] = await Promise.all([accessRequestsOf(id), transfersOf(id)]);
    return Response.json({ requests, transfers }, { headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}

/**
 * Ownership verified by the team (the principal did not answer): { transfer,
 * approve, reason }. The reason (at least 10 characters: what was checked,
 * e.g. the documentation received) stays in admin_audit with the decision.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const actor = await requireAdmin(request);
    const { id } = await params;
    const body = await readJson(request, 2048);
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
    if (typeof body.transfer !== "string" || typeof body.approve !== "boolean") throw new HttpError(400, "Valor inválido.");
    if (reason.length < 10) throw new HttpError(400, "Contá qué verificaste (por lo menos 10 caracteres).");
    const status = await supportResolveAdminTransfer(actor.id, id, body.transfer, body.approve);
    await adminClient()
      .from("admin_audit")
      .insert({ actor_id: actor.id, action: "agency_admin_transfer_support", subject_id: id, details: { transfer: body.transfer, status, reason } })
      .then(
        () => null,
        () => null,
      );
    return Response.json({ status }, { headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}
