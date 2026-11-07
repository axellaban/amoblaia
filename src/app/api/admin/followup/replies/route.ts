import { inbox } from "@/lib/followup/server";
import { agentRoute } from "@/lib/followup/route";
export const runtime = "nodejs";

/** La bandeja: las respuestas sin resolver (pendientes y de Facu), la más vieja primero. */
export const GET = agentRoute(async () => ({ replies: await inbox() }));
