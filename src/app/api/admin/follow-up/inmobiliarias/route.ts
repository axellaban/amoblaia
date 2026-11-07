import { HttpError, failure, requireAdmin } from "@/lib/commerce/http";
import { addAgency, setScore, setStage } from "@/lib/followup/server";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * Follow-up: lo que se corrige o se suma de una inmobiliaria.
 *   { accion: "estado", inmobiliaria, etapa }   etapa del embudo, o «fuera» para sacarla de Follow-up.
 *   { accion: "score", inmobiliaria, score }    solo en «No contactado» (0 a 100, o null).
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
    if (b.accion === "estado") return Response.json(await setStage(b.inmobiliaria, b.etapa, user.id), { headers: NO_STORE });
    if (b.accion === "score") return Response.json(await setScore(b.inmobiliaria, b.score, user.id), { headers: NO_STORE });
    throw new HttpError(400, "Acción desconocida.");
  } catch (e) {
    return failure(e);
  }
}
