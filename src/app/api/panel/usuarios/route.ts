import { failure } from "@/lib/commerce/http";
import { requireAgency } from "@/lib/agency/server";
import { createInvite, teamOf, teamProperties } from "@/lib/agency/team";
import { readJson } from "@/lib/demos/input";
export const runtime = "nodejs";

const PRIVATE = { "Cache-Control": "private, no-store" };

/** "Usuarios": who has access to the agency, the accesses not used yet and the properties to limit them to. Owner and administrators. */
// Without the request: browsers send no Origin on a same-origin GET, so its origin check would refuse every read.
export async function GET() {
  try {
    const { user, agency } = await requireAgency(undefined, "manage");
    const [team, properties] = await Promise.all([teamOf(agency.id, user.id), teamProperties(agency.id)]);
    return Response.json({ team, properties }, { headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}

/** A new access: { email, name?, role: admin|editor|viewer, properties?: [ids] | null }. Answers its link, shown only now. */
export async function POST(request: Request) {
  try {
    const membership = await requireAgency(request, "manage");
    const body = await readJson(request, 32768);
    const made = await createInvite(membership, membership.user.id, body);
    return Response.json({ ...made, team: await teamOf(membership.agency.id, membership.user.id) }, { status: 201, headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}
