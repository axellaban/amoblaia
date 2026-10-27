import { failure, HttpError, requireAdmin } from "@/lib/commerce/http";
import { createManualProperty, requireAgencyEdit } from "@/lib/agency/admin-edit";
import { auditAgencyEdit } from "@/lib/agency/edit-context";
import { agencyProperties } from "@/lib/agency/panel";
import { readJson } from "@/lib/demos/input";
import { isUuid } from "@/lib/demos/shared";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/** A page of one agency's properties for the team: ?pagina=&q=&estado= (real total; no photos or versions are sent). */
export async function GET(request: Request, { params }: Params) {
  try {
    await requireAdmin();
    const { id } = await params;
    if (!isUuid(id)) throw new HttpError(404, "No encontramos la inmobiliaria.");
    const q = new URL(request.url).searchParams;
    const page = Number(q.get("pagina")) || 1;
    const result = await agencyProperties(id, { page, perPage: Number(q.get("por")) || 10, q: q.get("q"), status: q.get("estado") });
    return Response.json({ ...result, page }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return failure(e);
  }
}

/**
 * "Cargar a mano": a draft property of the agency the team is editing,
 * once per request key ({ key, property: { title, location?, listing_url?,
 * description? }, settings?: { operation?, price? } }). Photos come next.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const access = await requireAgencyEdit(request, id);
    const made = await createManualProperty(id, access.actor.id, await readJson(request, 8192));
    if (!made.replay) await auditAgencyEdit(access, "property_create", { demo: made.id }, id);
    return Response.json(made, { status: made.replay ? 200 : 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return failure(e);
  }
}
