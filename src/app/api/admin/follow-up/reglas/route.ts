import { HttpError, failure, requireAdmin } from "@/lib/commerce/http";
import { actorName } from "@/lib/followup/actor";
import { auditOf, deleteRule, listRules, saveRule } from "@/lib/followup/server";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "private, no-store" };

/** Las reglas de la next best action y los últimos cambios de reglas y versiones. */
export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const [rules, changes] = await Promise.all([listRules(), auditOf(null, 30)]);
    return Response.json({ rules, changes }, { headers: NO_STORE });
  } catch (e) {
    return failure(e);
  }
}

/** Guarda una regla: `{ key?, stage, situations, action, after_hours, after_action, position, enabled, hours_from, hours_to, days }` (sin `key`: una nueva). */
export async function PUT(request: Request) {
  try {
    const user = await requireAdmin(request);
    const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!b) throw new HttpError(400, "Falta la regla.");
    return Response.json(await saveRule(b.key, b, { id: user.id, name: actorName(user) }), { headers: NO_STORE });
  } catch (e) {
    return failure(e);
  }
}

/** Quita una regla: `{ key }`. Sus versiones, ejecuciones y métricas se conservan. */
export async function DELETE(request: Request) {
  try {
    const user = await requireAdmin(request);
    const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    return Response.json(await deleteRule(b?.key, { id: user.id, name: actorName(user) }), { headers: NO_STORE });
  } catch (e) {
    return failure(e);
  }
}
