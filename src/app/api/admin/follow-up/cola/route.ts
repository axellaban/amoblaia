import { failure, requireAdmin } from "@/lib/commerce/http";
import { followupQueueView } from "@/lib/followup/server";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "private, no-store" };

/** La cola de ejecución recalculada en el servidor: ejecutables, bloqueadas, resumen y reglas, con la hora del cálculo. */
// Solo lee: sin control de origen, como las otras lecturas del panel (el navegador no manda `Origin` en un GET del mismo sitio).
export async function GET() {
  try {
    await requireAdmin();
    return Response.json(await followupQueueView(), { headers: NO_STORE });
  } catch (e) {
    return failure(e);
  }
}
