import { confirmExecution } from "@/lib/followup/server";
import { agentRoute } from "@/lib/followup/route";
export const runtime = "nodejs";

/** El mensaje salió (visto en el chat). Idempotente. `{ inmobiliaria, etapa, tarea, version, texto }` → la ejecución y la inmobiliaria como quedó. */
export const POST = agentRoute((b, actor) => confirmExecution({ agencyId: b.inmobiliaria, stage: b.etapa, action: b.tarea, versionId: b.version, text: b.texto }, actor));
