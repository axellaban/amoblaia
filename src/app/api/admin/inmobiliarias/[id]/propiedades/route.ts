import { failure, HttpError, requireAdmin } from "@/lib/commerce/http";
import { agencyProperties } from "@/lib/agency/panel";
import { isUuid } from "@/lib/demos/shared";
export const runtime = "nodejs";

/** A page of one agency's properties for the team: ?pagina=&q=&estado= (real total; no photos or versions are sent). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
