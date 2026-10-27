import { HttpError, requireAdmin } from "@/lib/commerce/http";
import { isUuid } from "@/lib/demos/shared";
import { body, iso, NO_STORE, prospectFailure, prospectRpc, text } from "@/lib/prospecting/server";
export const runtime = "nodejs";

const TYPES = new Set(["reply", "auto_reply", "interest", "not_interested", "meeting", "lost", "reopened", "note", "correction"]);
const CHANNELS = new Set(["whatsapp", "email", "phone", "instagram", "web", "other", "unknown"]);

/**
 * Records a fact the team observed: a reply (human), an auto-reply, explicit
 * interest, a loss… Nothing reads inboxes: without a connector this is how a
 * reply gets in. `key` (uuid) makes a retry or a double click one event.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireAdmin(request);
    const { id } = await params;
    if (!isUuid(id)) throw new HttpError(404, "No encontramos la cuenta.");
    const b = await body(request);
    if (!isUuid(b.key)) throw new HttpError(400, "Falta la clave de la operación.");
    if (typeof b.type !== "string" || !TYPES.has(b.type)) throw new HttpError(400, "Tipo de registro no válido.");
    if (b.channel != null && (typeof b.channel !== "string" || !CHANNELS.has(b.channel))) throw new HttpError(400, "Canal no válido.");
    if (b.precision != null && b.precision !== "time" && b.precision !== "day") throw new HttpError(400, "Precisión inválida.");
    for (const k of ["contactId", "attemptId", "corrects"]) if (b[k] != null && !isUuid(b[k])) throw new HttpError(400, "Referencia inválida.");
    const occurredAt = iso(b.occurredAt) ?? new Date().toISOString();
    const reason = text(b.reason, 300);
    const event = await prospectRpc<{ id: string; replayed?: boolean; stopped?: number }>("habita_prospect_record", {
      p_actor: actor.id,
      p_key: b.key,
      p_account: id,
      p_type: b.type,
      p_occurred_at: occurredAt,
      p_precision: b.precision ?? "time",
      p_channel: b.channel ?? null,
      p_contact: b.contactId ?? null,
      p_attempt: b.attemptId ?? null,
      p_evidence: text(b.evidence, 1000),
      p_details: reason ? { reason } : {},
      p_corrects: b.corrects ?? null,
    });
    return Response.json(event, { status: event.replayed ? 200 : 201, headers: NO_STORE });
  } catch (e) {
    return prospectFailure(e);
  }
}
