import { failure } from "@/lib/commerce/http";
import { requireAgency } from "@/lib/agency/server";
import { canManage } from "@/lib/agency/shared";
import { teamOf, teamProperties } from "@/lib/agency/team";
import { accessRequestsOf, administrationOf, invitationHistory } from "@/lib/agency/workspace";
export const runtime = "nodejs";

const PRIVATE = { "Cache-Control": "private, no-store" };

/**
 * «Equipo y accesos»: everyone of the agency sees the team and who is its
 * principal administrator (and may ask to become it). Administrators also
 * get the pending invitations, their history, the requests to join and the
 * properties to limit an access to. The role comes from the database, never
 * from the browser.
 */
// Without the request: browsers send no Origin on a same-origin GET.
export async function GET() {
  try {
    const membership = await requireAgency();
    const { user, agency, role } = membership;
    const manager = canManage(role);
    const [team, administration, requests, invitations, properties] = await Promise.all([
      teamOf(agency.id, user.id),
      administrationOf(membership, user.id),
      manager ? accessRequestsOf(agency.id) : Promise.resolve([]),
      manager ? invitationHistory(agency.id) : Promise.resolve([]),
      manager ? teamProperties(agency.id) : Promise.resolve([]),
    ]);
    return Response.json(
      {
        agency: { id: agency.id, name: agency.name },
        role,
        canManage: manager,
        readOnly: Boolean(membership.support && !membership.acting),
        // Members see who works there, not the pending invitations' e-mails.
        team: manager ? team : team.filter((m) => m.kind === "member"),
        administration,
        requests,
        invitations,
        properties,
      },
      { headers: PRIVATE },
    );
  } catch (e) {
    return failure(e);
  }
}
