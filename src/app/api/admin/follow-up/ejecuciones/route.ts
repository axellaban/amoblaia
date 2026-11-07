import { HttpError, failure, requireAdmin } from "@/lib/commerce/http";
import { actorName } from "@/lib/followup/actor";
import { markExecution, prepareExecution } from "@/lib/followup/server";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * Follow-up: ejecutar la next best action con una inmobiliaria.
 *   { accion: "preparar", inmobiliaria, etapa }                       el mensaje armado, su WhatsApp y sus links.
 *   { accion: "registrar", inmobiliaria, etapa, version, estado, motivo?, texto? }
 *     estado: «opened» (abrió WhatsApp), «sent» (confirmó el envío: cuenta como ejecución) o «failed» (no salió, con motivo).
 */
export async function POST(request: Request) {
  try {
    const user = await requireAdmin(request);
    const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!b || typeof b.inmobiliaria !== "string") throw new HttpError(400, "Falta la inmobiliaria.");
    const actor = { id: user.id, name: actorName(user) };
    if (b.accion === "preparar") return Response.json(await prepareExecution(b.inmobiliaria, b.etapa, new URL(request.url).origin, actor), { headers: NO_STORE });
    if (b.accion === "registrar")
      return Response.json(
        await markExecution({ agencyId: b.inmobiliaria, stage: b.etapa, versionId: b.version, status: b.estado, reason: b.motivo, text: b.texto }, actor),
        { headers: NO_STORE },
      );
    throw new HttpError(400, "Acción desconocida.");
  } catch (e) {
    return failure(e);
  }
}
