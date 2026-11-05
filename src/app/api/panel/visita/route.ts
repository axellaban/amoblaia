import { failure, HttpError, isAdmin, requireUser } from "@/lib/commerce/http";
import { claimWithCode } from "@/lib/agency/invitation";
import { membershipOf } from "@/lib/agency/server";
import { claimCodeFromVisit, currentVisit } from "@/lib/agency/visit";
import { validOrigin } from "@/lib/session";
export const runtime = "nodejs";

/**
 * Activates the agency's space for a signed-in account that came from its
 * private link or invitation (Journey A, docs/EQUIPO_Y_ACCESOS.md): it becomes
 * its first administrator, while the agency has no owner. Only the visit's own
 * agency, never another; a public demo link alone never gets here.
 */
export async function POST(request: Request) {
  try {
    if (!validOrigin(request)) throw new HttpError(403, "Origen inválido.");
    const user = await requireUser(request);
    if (isAdmin(user.email)) throw new HttpError(403, "El equipo de habita no puede quedarse con una inmobiliaria.");
    if (await membershipOf(user.id)) throw new HttpError(409, "Tu cuenta ya tiene una inmobiliaria.");
    const visit = await currentVisit();
    if (!visit) throw new HttpError(404, "Abrí de nuevo el enlace de tu panel.");
    if (visit.claimed) throw new HttpError(409, "Esta inmobiliaria ya tiene su cuenta en habita. Pedile acceso a quien la administra.");
    await claimWithCode(user, await claimCodeFromVisit(visit));
    return Response.json({ claimed: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return failure(e);
  }
}
