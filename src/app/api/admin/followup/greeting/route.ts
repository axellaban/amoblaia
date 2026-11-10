import { registerManualGreeting } from "@/lib/followup/server";
import { agentRoute } from "@/lib/followup/route";
export const runtime = "nodejs";
/** Historical manual greeting. { inmobiliaria, hora } (ISO, actual send time). */
export const POST = agentRoute((body,actor) => registerManualGreeting(body.inmobiliaria,body.hora,actor));
