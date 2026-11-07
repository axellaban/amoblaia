import { HttpError, failure, requireAdmin } from "@/lib/commerce/http";
import { actorName } from "@/lib/followup/actor";
import { addAgency, setPriority, setScore, setShortName, setSituation, setStage, snooze, unsnooze } from "@/lib/followup/server";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * Follow-up: lo que se corrige o se suma de una inmobiliaria.
 *   { accion: "estado", inmobiliaria, etapa }   etapa del embudo, o «fuera» para sacarla de Follow-up.
 *   { accion: "score", inmobiliaria, score }    solo en «No contactado» (0 a 100, o null).
 *   { accion: "situacion", inmobiliaria, situacion, texto? }   qué pasó en la conversación.
 *   { accion: "nombre", inmobiliaria, nombre }   el nombre corto para {{inmobiliaria}} (vacío: el de la ficha).
 *   { accion: "reprogramar", inmobiliaria, hasta?, motivo? }   sale de la cola hasta esa fecha; { accion: "volver", inmobiliaria } la devuelve.
 *   { accion: "prioridad", inmobiliaria, prioridad }   alta, media, baja o null (la del grupo).
 *   { accion: "agregar", etapa, name, whatsapp?, contact?, score?, address?, zone?, website?, confirmDuplicates? }
 */
export async function POST(request: Request) {
  try {
    const user = await requireAdmin(request);
    const b = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    if (b.accion === "agregar") {
      const r = await addAgency({ ...b, stage: b.etapa }, user.id);
      return Response.json(r, { status: "id" in r ? 201 : 200, headers: NO_STORE });
    }
    if (typeof b.inmobiliaria !== "string") throw new HttpError(400, "Falta la inmobiliaria.");
    if (b.accion === "estado") return Response.json(await setStage(b.inmobiliaria, b.etapa, user.id, actorName(user)), { headers: NO_STORE });
    if (b.accion === "situacion") return Response.json(await setSituation(b.inmobiliaria, b.situacion, b.texto, { id: user.id, name: actorName(user) }), { headers: NO_STORE });
    if (b.accion === "reprogramar") return Response.json(await snooze(b.inmobiliaria, b.hasta, b.motivo, { id: user.id, name: actorName(user) }), { headers: NO_STORE });
    if (b.accion === "volver") return Response.json(await unsnooze(b.inmobiliaria, user.id, actorName(user)), { headers: NO_STORE });
    if (b.accion === "prioridad") return Response.json(await setPriority(b.inmobiliaria, b.prioridad, user.id, actorName(user)), { headers: NO_STORE });
    if (b.accion === "nombre") return Response.json(await setShortName(b.inmobiliaria, b.nombre, user.id, actorName(user)), { headers: NO_STORE });
    if (b.accion === "score") return Response.json(await setScore(b.inmobiliaria, b.score, user.id, actorName(user)), { headers: NO_STORE });
    throw new HttpError(400, "Acción desconocida.");
  } catch (e) {
    return failure(e);
  }
}
