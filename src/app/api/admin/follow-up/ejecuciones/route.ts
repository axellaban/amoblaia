import { HttpError, failure, requireAdmin } from "@/lib/commerce/http";
import { actorName } from "@/lib/followup/actor";
import { claimNext, confirmExecution, failExecution, openExecution, releaseClaim } from "@/lib/followup/server";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * Follow-up desde la pantalla (la extensión usa /api/admin/followup/*, que hace lo mismo):
 *   { accion: "preparar", inmobiliaria }                                   la toma 10 minutos y devuelve el mensaje armado.
 *   { accion: "registrar", inmobiliaria, etapa, tarea, version, estado, motivo?, tipo?, texto? }
 *     estado: «opened» (abrió WhatsApp), «sent» (confirmó el envío) o «failed» (no salió, con motivo).
 *   { accion: "soltar", inmobiliaria }                                      la deja libre sin hacer nada.
 */
export async function POST(request: Request) {
  try {
    const user = await requireAdmin(request);
    const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!b || typeof b.inmobiliaria !== "string") throw new HttpError(400, "Falta la inmobiliaria.");
    const actor = { id: user.id, name: actorName(user) };
    if (b.accion === "preparar") return Response.json(await claimNext({ agencyId: b.inmobiliaria }, new URL(request.url).origin, actor), { headers: NO_STORE });
    if (b.accion === "soltar") return Response.json(await releaseClaim(b.inmobiliaria, actor.id), { headers: NO_STORE });
    if (b.accion === "registrar") {
      const task = { agencyId: b.inmobiliaria, stage: b.etapa, action: b.tarea, versionId: b.version };
      if (b.estado === "opened") return Response.json(await openExecution(task, actor), { headers: NO_STORE });
      if (b.estado === "sent") return Response.json(await confirmExecution({ ...task, text: b.texto }, actor), { headers: NO_STORE });
      if (b.estado === "failed") return Response.json(await failExecution({ ...task, reason: b.motivo, kind: b.tipo }, actor), { headers: NO_STORE });
      throw new HttpError(400, "Estado desconocido.");
    }
    throw new HttpError(400, "Acción desconocida.");
  } catch (e) {
    return failure(e);
  }
}
