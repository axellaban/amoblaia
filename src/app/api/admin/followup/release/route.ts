import { releaseClaim } from "@/lib/followup/server";
import { agentRoute } from "@/lib/followup/route";
export const runtime = "nodejs";

/** La deja libre sin hacer nada. `{ inmobiliaria }`. */
export const POST = agentRoute((b, actor) => releaseClaim(b.inmobiliaria, actor.id));
