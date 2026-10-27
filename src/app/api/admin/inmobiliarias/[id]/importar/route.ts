import { failure } from "@/lib/commerce/http";
import { requireAgencyEdit } from "@/lib/agency/admin-edit";
import { auditAgencyEdit } from "@/lib/agency/edit-context";
import { importListing, reportImportPhotos } from "@/lib/agency/import-flow";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/**
 * "Agregar propiedad" from a listing URL, for the agency the team is
 * editing (the agency is the one in the address and in the tab's context,
 * never one in the body). The same preview, request key, snapshot and
 * partial recovery as the agency's own panel. Nothing is staged and no
 * credit is used.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const access = await requireAgencyEdit(request, id);
    return await importListing(request, { agencyId: id, userId: access.actor.id, origin: "admin" }, (demoId) =>
      auditAgencyEdit(access, "property_import", { demo: demoId }, id),
    );
  } catch (e) {
    return failure(e);
  }
}

/** The photos downloaded for one of this agency's imports: { importId, done: [...], failed: [...] }. */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    await requireAgencyEdit(request, id);
    return await reportImportPhotos(request, id);
  } catch (e) {
    return failure(e);
  }
}
