import { failure } from "@/lib/commerce/http";
import { agencyProperties } from "@/lib/agency/panel";
import { requireAgencyRead } from "@/lib/agency/server";
export const runtime = "nodejs";

/** A page of the agency's properties: ?pagina=&q=&estado=draft|published&operacion=&etapa=importar|importadas (real total included). */
export async function GET(request: Request) {
  try {
    const { agency, scope } = await requireAgencyRead();
    const q = new URL(request.url).searchParams;
    const page = Number(q.get("pagina")) || 1;
    const result = await agencyProperties(agency.id, {
      page,
      perPage: Number(q.get("por")) || 24,
      q: q.get("q"),
      status: q.get("estado"),
      operation: q.get("operacion"),
      stage: q.get("etapa") === "importar" ? "importar" : q.get("etapa") === "importadas" ? "importadas" : null,
      scope,
    });
    return Response.json({ ...result, page }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return failure(e);
  }
}
