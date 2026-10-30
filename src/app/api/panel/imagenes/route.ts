import { failure } from "@/lib/commerce/http";
import { agencyProperties } from "@/lib/agency/panel";
import { importPhotoGroup } from "@/lib/agency/photo-groups";
import { requireAgency } from "@/lib/agency/server";
export const runtime = "nodejs";

/** The agency's photo groups (not fichas yet), newest first, with their real photo counts. */
// Without the request: browsers send no Origin on a same-origin GET, so its origin check would refuse every read.
export async function GET() {
  try {
    const { agency, scope } = await requireAgency();
    const { items, total } = await agencyProperties(agency.id, { kind: "fotos", perPage: 48, scope });
    return Response.json({ items, total }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return failure(e);
  }
}

/**
 * Photos of a listing as a photo group (see importPhotoGroup). Nothing is
 * staged, no ficha is created and no credit is used.
 */
export async function POST(request: Request) {
  try {
    const { user, agency } = await requireAgency(request, "create");
    return await importPhotoGroup(request, { agencyId: agency.id, userId: user.id, origin: "agency" });
  } catch (e) {
    return failure(e);
  }
}
