import { HttpError, requireAdmin, failure } from "@/lib/commerce/http";
import { isUuid } from "@/lib/demos/shared";
import { agencyDetail } from "@/lib/leads/server";

const PRIVATE = { "Cache-Control": "private, no-store" };

/** One agency: its demos, each visitor with the five dimensions and the events behind them. */
export async function GET(_request: Request, { params }: { params: Promise<{ agencyId: string }> }) {
  try {
    await requireAdmin();
    const { agencyId } = await params;
    if (!isUuid(agencyId)) throw new HttpError(404, "Inmobiliaria no encontrada.");
    const detail = await agencyDetail(agencyId);
    if (!detail) throw new HttpError(404, "Inmobiliaria no encontrada.");
    return Response.json(detail, { headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}
