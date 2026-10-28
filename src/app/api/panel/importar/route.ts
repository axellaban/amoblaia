import { failure } from "@/lib/commerce/http";
import { importListing, reportImportPhotos } from "@/lib/agency/import-flow";
import { requireAgency } from "@/lib/agency/server";
export const runtime = "nodejs";

/**
 * A property of the agency from the URL of its listing: a preview first,
 * then a draft once per key, with its photos reported by PATCH (see
 * importListing). Nothing is staged and no credit is used.
 */
export async function POST(request: Request) {
  try {
    const { user, agency } = await requireAgency(request);
    return await importListing(request, { agencyId: agency.id, userId: user.id, origin: "agency" });
  } catch (e) {
    return failure(e);
  }
}

/** The photos the panel downloaded for an import: { importId, done: [...], failed: [...] }. */
export async function PATCH(request: Request) {
  try {
    const { agency } = await requireAgency(request);
    return await reportImportPhotos(request, agency.id);
  } catch (e) {
    return failure(e);
  }
}
