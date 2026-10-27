import { failure, HttpError, requireAdmin } from "@/lib/commerce/http";
import { adminAgency } from "@/lib/agency/admin";
import { isUuid } from "@/lib/demos/shared";
export const runtime = "nodejs";

/** One agency as the team sees it (read only). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await params;
    if (!isUuid(id)) throw new HttpError(404, "No encontramos la inmobiliaria.");
    return Response.json(await adminAgency(id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return failure(e);
  }
}
