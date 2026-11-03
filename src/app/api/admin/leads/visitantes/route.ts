import { HttpError, requireAdmin, failure } from "@/lib/commerce/http";
import { readJson } from "@/lib/demos/input";
import { setInternalVisitor, validLeadVisitor } from "@/lib/leads/server";

const PRIVATE = { "Cache-Control": "private, no-store" };

/**
 * Marks a visitor as the team's ({ visitor, internal: true, note? }) or
 * undoes it (internal: false). Who and when are recorded; the demos it
 * touched are recalculated before answering.
 */
export async function POST(request: Request) {
  try {
    const actor = await requireAdmin(request);
    const body = await readJson(request, 2048);
    if (!validLeadVisitor(body.visitor) || typeof body.internal !== "boolean") throw new HttpError(400, "Visitante inválido.");
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 200) || null : null;
    const result = await setInternalVisitor({ visitorId: body.visitor, internal: body.internal, actorId: actor.id, note });
    return Response.json(result, { headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}
