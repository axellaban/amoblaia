import { claimNext } from "@/lib/followup/server";
import { agentRoute } from "@/lib/followup/route";
export const runtime = "nodejs";

/** Toma una inmobiliaria por 10 minutos y devuelve su mensaje armado. `{ inmobiliaria? }`: sin ella, la próxima libre (null si no queda ninguna). */
export const POST = agentRoute((b, actor, request) => claimNext({ agencyId: b.inmobiliaria }, new URL(request.url).origin, actor));
