import { failure, HttpError } from "@/lib/commerce/http";
import { requireAgency } from "@/lib/agency/server";
import { removeAccess, renewInvite, teamOf, updateAccess } from "@/lib/agency/team";
import { readJson } from "@/lib/demos/input";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };
const PRIVATE = { "Cache-Control": "private, no-store" };
const kindOf = (v: unknown) => {
  if (v !== "member" && v !== "pending") throw new HttpError(400, "Valor inválido.");
  return v;
};

/**
 * Changes a user: { kind: member|pending, role?, properties? } or, for an
 * access not used yet, { kind: "pending", renew: true } for a new link (the
 * previous one stops working). Owner and administrators.
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const membership = await requireAgency(request, "manage");
    const body = await readJson(request, 32768);
    const kind = kindOf(body.kind);
    let link: string | null = null;
    if (body.renew === true) {
      if (kind !== "pending") throw new HttpError(400, "Ese usuario ya entró: no necesita un enlace nuevo.");
      link = (await renewInvite(membership.agency.id, membership.user.id, id)).link;
    } else await updateAccess(membership, membership.user.id, { kind, id }, body);
    return Response.json({ link, team: await teamOf(membership.agency.id, membership.user.id) }, { headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}

/** Removes a user's access (?tipo=member|pending). Its account, if any, stays outside the agency. */
export async function DELETE(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const membership = await requireAgency(request, "manage");
    const kind = kindOf(new URL(request.url).searchParams.get("tipo"));
    await removeAccess(membership, membership.user.id, { kind, id });
    return Response.json({ team: await teamOf(membership.agency.id, membership.user.id) }, { headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}
