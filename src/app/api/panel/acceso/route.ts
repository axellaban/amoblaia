import { failure, HttpError, isAdmin, requireUser } from "@/lib/commerce/http";
import { membershipOf } from "@/lib/agency/server";
import { entrySpace } from "@/lib/agency/workspace-entry";
import { requestAccess } from "@/lib/agency/workspace";
import { readJson } from "@/lib/demos/input";
export const runtime = "nodejs";

/**
 * «Solicitar acceso» (Journey C): a signed-in account asks to join the space
 * of the agency it came from ({ demo: token } or { codigo }, else its visit).
 * Nothing is granted here: the request waits for an administrator (or, for
 * an agency without its space yet, for the team). One open request per
 * account and agency: asking again answers the same one.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    if (isAdmin(user.email)) throw new HttpError(403, "El equipo de habita entra a los paneles desde la vista de soporte.");
    const body = await readJson(request, 1024);
    const demoToken = typeof body.demo === "string" ? body.demo : null;
    const code = typeof body.codigo === "string" ? body.codigo : null;
    const space = await entrySpace({ demoToken, code });
    if (!space) throw new HttpError(404, "No encontramos la inmobiliaria. Abrí de nuevo el enlace que te enviaron.");
    const own = await membershipOf(user.id);
    if (own?.agency.id === space.agency.id) return Response.json({ member: true }, { headers: { "Cache-Control": "private, no-store" } });
    const made = await requestAccess(user, space.agency.id, space.source, space.demo?.id ?? null);
    return Response.json(
      { ...made, agency: space.agency.name, toTeam: !space.agency.ownerId },
      { status: made.created ? 201 : 200, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
