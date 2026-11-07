import { agentQueue } from "@/lib/followup/server";
import { agentRoute } from "@/lib/followup/route";
export const runtime = "nodejs";

/** La cola del agente: resumen, la próxima libre para esta sesión (`next`), las ejecutables en orden y las bloqueadas con su motivo. `?limite=50`. */
export const GET = agentRoute((q, actor) => agentQueue(actor.id, Number(q.limite) || 50));
