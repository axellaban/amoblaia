import { failure, HttpError, isAdmin, requireUser } from "@/lib/commerce/http";
import { claimWithCode } from "@/lib/agency/invitation";
import { membershipOf } from "@/lib/agency/server";
import { claimCodeFromVisit, currentVisit } from "@/lib/agency/visit";
import { validOrigin } from "@/lib/session";
export const runtime = "nodejs";

/**
 * "Usar esta cuenta para <inmobiliaria>": a signed-in account that is looking
 * around an agency's panel from its link (or its invitation) takes it over,
 * while the agency has no owner. Only the visit's own agency, never another.
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
