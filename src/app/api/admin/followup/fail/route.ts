import { failExecution } from "@/lib/followup/server";
import { agentRoute } from "@/lib/followup/route";
export const runtime = "nodejs";

/** No salió. `{ inmobiliaria, etapa, tarea, version, motivo, tipo? }`; tipo «sin_whatsapp» o «numero_incorrecto» invalida el número y la saca de la cola. */
export const POST = agentRoute((b, actor) => failExecution({ agencyId: b.inmobiliaria, stage: b.etapa, action: b.tarea, versionId: b.version, reason: b.motivo, kind: b.tipo }, actor));
