import { failure } from "@/lib/commerce/http";
import { createUploadGroup } from "@/lib/agency/photo-groups";
import { requireAgency } from "@/lib/agency/server";
export const runtime = "nodejs";

/** An empty photo group for uploaded files: { name } (optional). The files go one by one to its photos route. */
export async function POST(request: Request) {
  try {
    const { user, agency } = await requireAgency(request);
    return await createUploadGroup(request, { agencyId: agency.id, userId: user.id, origin: "agency" });
  } catch (e) {
    return failure(e);
  }
}
