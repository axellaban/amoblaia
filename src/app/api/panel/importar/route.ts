import { failure } from "@/lib/commerce/http";
import { importListing, reportImportPhotos } from "@/lib/agency/import-flow";
import { requireAgency, requireAgencyRead } from "@/lib/agency/server";
export const runtime = "nodejs";

/**
 * A property of the agency from the URL of its listing: a preview first
 * (also for a guest of the panel, read only),
 * then a draft once per key, with its photos reported by PATCH (see
 * importListing). Nothing is staged and no credit is used.
 */
export async function POST(request: Request) {
  try {
    // The preview only reads the listing: a guest of the panel (its visit, no account yet)
    // may see it; the account is asked for when it confirms the import.
    const peek = (await request.clone().json().catch(() => null)) as { preview?: unknown } | null;
    if (peek?.preview === true) {
      const { user, agency } = await requireAgencyRead();
      return await importListing(request, { agencyId: agency.id, userId: user?.id ?? null, origin: "agency" });
    }
    const { user, agency } = await requireAgency(request, "create");
    return await importListing(request, { agencyId: agency.id, userId: user.id, origin: "agency" });
  } catch (e) {
    return failure(e);
  }
}

/** The photos the panel downloaded for an import: { importId, done: [...], failed: [...] }. */
export async function PATCH(request: Request) {
  try {
    const { agency } = await requireAgency(request, "create");
    return await reportImportPhotos(request, agency.id);
  } catch (e) {
    return failure(e);
  }
}
