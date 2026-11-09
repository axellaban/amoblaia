import { claimNext } from "@/lib/followup/server";
import { agentRoute } from "@/lib/followup/route";
export const runtime = "nodejs";

/**
 * Toma una inmobiliaria por 10 minutos y devuelve su mensaje armado. `{ inmobiliaria? }`: sin ella, la próxima libre (null si no queda ninguna).
 * `filtro?: { etapa?, regla?, situacion?, grupo?, buscar? }` toma solo la próxima que entra en ese filtro; `saltar?: [inmobiliaria]` deja afuera esas.
 */
export const POST = agentRoute((b, actor, request) => claimNext({ agencyId: b.inmobiliaria, filter: b.filtro, skip: b.saltar }, new URL(request.url).origin, actor));
