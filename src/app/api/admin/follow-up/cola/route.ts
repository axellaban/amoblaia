import { failure, requireAdmin } from "@/lib/commerce/http";
import { followupQueueView } from "@/lib/followup/server";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "private, no-store" };

/** La cola de ejecución recalculada en el servidor: ejecutables, bloqueadas, resumen y reglas, con la hora del cálculo. */
export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    return Response.json(await followupQueueView(), { headers: NO_STORE });
  } catch (e) {
    return failure(e);
  }
}
