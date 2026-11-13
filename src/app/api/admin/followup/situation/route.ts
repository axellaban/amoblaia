import { HttpError } from "@/lib/commerce/http";
import { setSituation } from "@/lib/followup/server";
import { agentRoute } from "@/lib/followup/route";
export const runtime = "nodejs";

/** Qué pasó en la conversación: `{ inmobiliaria, situacion, texto?, hora? }` (el texto original de la respuesta y la hora en que la escribió, ISO; sin hora, ahora). */
export const POST = agentRoute((b, actor) => {
  if (typeof b.inmobiliaria !== "string") throw new HttpError(400, "Falta la inmobiliaria.");
  return setSituation(b.inmobiliaria, b.situacion, b.texto, actor, b.hora);
});
