import { failure, HttpError } from "@/lib/commerce/http";
import { requireAgency } from "@/lib/agency/server";
import { requestAdminTransfer, transferPrincipal } from "@/lib/agency/workspace";
import { readJson } from "@/lib/demos/input";
export const runtime = "nodejs";

const PRIVATE = { "Cache-Control": "private, no-store" };

/**
 * «Administración de la inmobiliaria».
 * { action: "request" }: a member asks to become the principal administrator
 * (the same open request is answered again, never a duplicate).
 * { action: "transfer", to }: the principal hands the role to another member.
 * The database checks who may do each; a support view only reads.
 */
export async function POST(request: Request) {
  try {
    const membership = await requireAgency(request);
    if (membership.support) throw new HttpError(403, "El equipo de habita no puede cambiar la administración desde la vista de soporte.");
    const body = await readJson(request, 1024);
    if (body.action === "request") {
      const made = await requestAdminTransfer(membership, membership.user.id);
      return Response.json(made, { status: made.created ? 201 : 200, headers: PRIVATE });
    }
    if (body.action === "transfer") {
      if (typeof body.to !== "string") throw new HttpError(400, "Elegí a quién transferir la administración.");
      await transferPrincipal(membership, membership.user.id, body.to);
      return Response.json({ principal: body.to }, { headers: PRIVATE });
    }
    throw new HttpError(400, "Valor inválido.");
  } catch (e) {
    return failure(e);
  }
}
