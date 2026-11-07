import { HttpError } from "@/lib/commerce/http";
import { setPriority } from "@/lib/followup/server";
import { agentRoute } from "@/lib/followup/route";
export const runtime = "nodejs";

/** Prioridad a mano: `{ inmobiliaria, prioridad: "alta" | "media" | "baja" | null }` (null: la del grupo). */
export const POST = agentRoute((b, actor) => {
  if (typeof b.inmobiliaria !== "string") throw new HttpError(400, "Falta la inmobiliaria.");
  return setPriority(b.inmobiliaria, b.prioridad, actor.id);
});
