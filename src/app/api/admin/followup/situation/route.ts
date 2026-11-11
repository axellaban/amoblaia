import { HttpError } from "@/lib/commerce/http";
import { setSituation } from "@/lib/followup/server";
import { agentRoute } from "@/lib/followup/route";
export const runtime = "nodejs";

/** Qué pasó en la conversación: `{ inmobiliaria, situacion, texto? }` (el texto original de la respuesta). */
export const POST = agentRoute((b, actor) => {
  if (typeof b.inmobiliaria !== "string") throw new HttpError(400, "Falta la inmobiliaria.");
  return setSituation(b.inmobiliaria, b.situacion, b.texto, actor);
});
