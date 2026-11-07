import { HttpError, failure, requireAdmin } from "@/lib/commerce/http";
import { addAgency, setScore, setStage } from "@/lib/followup/server";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * Follow-up: corregir una inmobiliaria de la lista.
 *   { accion: "etapa", inmobiliaria, etapa }   su etapa (o "fuera"); la del embudo saca la corrección.
 *   { accion: "score", inmobiliaria, score }   el score en «No contactado» (0 a 100, o null).
 *   { accion: "agregar", etapa, key, name, whatsapp?, contact?, address?, zone?, website?, score?, confirmDuplicates? }
 */
export async function POST(request: Request) {
  try {
    const user = await requireAdmin(request);
    const b = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    if (b.accion === "agregar") {
      const made = await addAgency({ ...b, stage: b.etapa }, user.id);
      return Response.json(made, { status: "duplicates" in made ? 409 : 201, headers: NO_STORE });
    }
    if (typeof b.inmobiliaria !== "string") throw new HttpError(400, "Falta la inmobiliaria.");
    if (b.accion === "etapa") return Response.json(await setStage(b.inmobiliaria, b.etapa, user.id), { headers: NO_STORE });
    if (b.accion === "score") return Response.json(await setScore(b.inmobiliaria, b.score, user.id), { headers: NO_STORE });
    throw new HttpError(400, "Acción desconocida.");
  } catch (e) {
    return failure(e);
  }
}
