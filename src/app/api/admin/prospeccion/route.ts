import { requireAdmin } from "@/lib/commerce/http";
import { isUuid } from "@/lib/demos/shared";
import { body, NO_STORE, prospectDataset, prospectFailure, prospectRpc, text } from "@/lib/prospecting/server";
export const runtime = "nodejs";

/** The private dataset of the acquisition panel. Metrics are computed from it with the shared rules. */
export async function GET() {
  try {
    await requireAdmin();
    return Response.json(await prospectDataset(), { headers: NO_STORE });
  } catch (e) {
    return prospectFailure(e);
  }
}

/** Adds an agency to the base: an existing one ({agencyId}) or a new one ({name, website}). */
export async function POST(request: Request) {
  try {
    const actor = await requireAdmin(request);
    const b = await body(request);
    const agencyId = b.agencyId == null ? null : isUuid(b.agencyId) ? b.agencyId : "invalid";
    if (agencyId === "invalid") return Response.json({ error: "Inmobiliaria inválida." }, { status: 400 });
    const account = await prospectRpc<{ id: string; replayed?: boolean }>("habita_prospect_add", {
      p_actor: actor.id,
      p_agency: agencyId,
      p_name: text(b.name, 120),
      p_website: text(b.website, 300),
      p_sdr: text(b.sdr, 80),
      p_campaign: text(b.campaign, 80),
      p_zone: text(b.zone, 120),
    });
    return Response.json(account, { status: account.replayed ? 200 : 201, headers: NO_STORE });
  } catch (e) {
    return prospectFailure(e);
  }
}
