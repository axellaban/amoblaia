import { HttpError } from "@/lib/commerce/http";
import { snooze, unsnooze } from "@/lib/followup/server";
import { agentRoute } from "@/lib/followup/route";
export const runtime = "nodejs";

/** Omitir o reprogramar: `{ inmobiliaria, hasta?, motivo? }` (sin `hasta`: mañana a las 9). `{ inmobiliaria, hasta: null, volver: true }` la devuelve a la cola. */
export const POST = agentRoute((b, actor) => {
  if (typeof b.inmobiliaria !== "string") throw new HttpError(400, "Falta la inmobiliaria.");
  return b.volver === true ? unsnooze(b.inmobiliaria, actor.id) : snooze(b.inmobiliaria, b.hasta, b.motivo, actor);
});
