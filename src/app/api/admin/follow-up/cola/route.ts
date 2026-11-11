import { unlessUnchanged } from "@/lib/change-stamp";
import { failure, requireAdmin } from "@/lib/commerce/http";
import { followupQueueView } from "@/lib/followup/server";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "private, no-store" };

/** La cola de ejecución recalculada en el servidor: ejecutables, bloqueadas, resumen y reglas, con la hora del cálculo. */
// Solo lee: sin control de origen, como las otras lecturas del panel (el navegador no manda `Origin` en un GET del mismo sitio).
// Con `?si=<sello>` (la recarga automática) responde `{ unchanged: true }` si nada cambió en la base desde ese sello.
export async function GET(request?: Request) {
  try {
    await requireAdmin();
    return Response.json(await unlessUnchanged(request, followupQueueView), { headers: NO_STORE });
  } catch (e) {
    return failure(e);
  }
}
