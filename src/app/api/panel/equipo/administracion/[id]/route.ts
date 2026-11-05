import { failure, HttpError } from "@/lib/commerce/http";
import { requireAgency } from "@/lib/agency/server";
import { resolveAdminTransfer } from "@/lib/agency/workspace";
import { readJson } from "@/lib/demos/input";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/**
 * The principal administrator answers a transfer request: { approve, confirm }.
 * Approving needs { confirm: true } as well (the panel asks first). Only the
 * principal may do it; the database checks that again, atomically.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const membership = await requireAgency(request);
    if (membership.support) throw new HttpError(403, "El equipo de habita no puede aprobar desde la vista de soporte.");
    const body = await readJson(request, 1024);
    if (typeof body.approve !== "boolean") throw new HttpError(400, "Valor inválido.");
    if (body.approve && body.confirm !== true) throw new HttpError(400, "Confirmá la transferencia para continuar.");
    const status = await resolveAdminTransfer(membership, membership.user.id, id, body.approve);
    return Response.json({ status }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return failure(e);
  }
}
