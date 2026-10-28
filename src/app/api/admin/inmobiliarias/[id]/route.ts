import { failure, HttpError, requireAdmin } from "@/lib/commerce/http";
import { adminAgency } from "@/lib/agency/admin";
import { agencyRecord, requireAgencyEdit, updateAgencyBranding, updateAgencyRecord } from "@/lib/agency/admin-edit";
import { auditAgencyEdit } from "@/lib/agency/edit-context";
import { readJson } from "@/lib/demos/input";
import { isUuid } from "@/lib/demos/shared";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };
const PRIVATE = { "Cache-Control": "private, no-store" };

/** One agency as the team sees it (read only). ?datos=1: its editable data and brand, for "Editar inmobiliaria". */
export async function GET(request: Request, { params }: Params) {
  try {
    await requireAdmin();
    const { id } = await params;
    if (!isUuid(id)) throw new HttpError(404, "No encontramos la inmobiliaria.");
    if (new URL(request.url).searchParams.get("datos") === "1") return Response.json(await agencyRecord(id), { headers: PRIVATE });
    return Response.json(await adminAgency(id), { headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}

/**
 * The team edits the agency, inside its edit context (the tab's signed
 * context must name this agency):
 * { action: "agency", agency: { name, website, contact_name, contact_email, notes } }
 * { action: "branding", branding: { primary, accent, titleFont, contactKind, contactValue, visitUrl } }
 * Its owner's account, e-mail, password, purchases and credits are not here.
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const access = await requireAgencyEdit(request, id);
    const body = await readJson(request);
    if (body.action === "agency") {
      const fields = await updateAgencyRecord(id, body.agency);
      await auditAgencyEdit(access, "agency_data", { fields }, id);
    } else if (body.action === "branding") {
      await updateAgencyBranding(id, body.branding);
      await auditAgencyEdit(access, "agency_branding", {}, id);
    } else throw new HttpError(400, "Acción inválida.");
    return Response.json(await agencyRecord(id), { headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}
