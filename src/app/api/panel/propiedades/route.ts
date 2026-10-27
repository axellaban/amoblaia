import { failure } from "@/lib/commerce/http";
import { agencyProperties } from "@/lib/agency/panel";
import { requireAgency } from "@/lib/agency/server";
export const runtime = "nodejs";

/** A page of the agency's properties: ?pagina=&q=&estado=draft|published&operacion= (real total included). */
export async function GET(request: Request) {
  try {
    const { agency } = await requireAgency();
    const q = new URL(request.url).searchParams;
    const page = Number(q.get("pagina")) || 1;
    const result = await agencyProperties(agency.id, {
      page,
      perPage: Number(q.get("por")) || 24,
      q: q.get("q"),
      status: q.get("estado"),
      operation: q.get("operacion"),
    });
    return Response.json({ ...result, page }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return failure(e);
  }
}
