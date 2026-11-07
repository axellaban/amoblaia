import { openExecution } from "@/lib/followup/server";
import { agentRoute } from "@/lib/followup/route";
export const runtime = "nodejs";

/** Abrió WhatsApp con el mensaje: queda «abierto» (no cuenta como enviado). `{ inmobiliaria, etapa, tarea, version }`. */
export const POST = agentRoute((b, actor) => openExecution({ agencyId: b.inmobiliaria, stage: b.etapa, action: b.tarea, versionId: b.version }, actor));
