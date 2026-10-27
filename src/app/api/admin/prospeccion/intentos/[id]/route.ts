import { HttpError, requireAdmin } from "@/lib/commerce/http";
import { isUuid } from "@/lib/demos/shared";
import { channelUrl } from "@/lib/prospecting/render";
import { body, iso, NO_STORE, prospectFailure, prospectRpc, text } from "@/lib/prospecting/server";
import type { OutreachAttempt } from "@/lib/prospecting/types";
export const runtime = "nodejs";

const OUTCOMES = new Set(["cancelled", "failed", "invalid_endpoint", "uncertain", "bounced"]);

/**
 * The steps after preparing, each one explicit and checked again here:
 *  - open: re-checks opt-outs and the contact, takes a 10-minute lease and
 *    returns the channel link. Opening is not sending.
 *  - confirm: the operator observed the message sent. Idempotent.
 *  - resolve: cancelled, failed, invalid number, bounced, or uncertain.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireAdmin(request);
    const { id } = await params;
    if (!isUuid(id)) throw new HttpError(404, "No encontramos el intento.");
    const b = await body(request);
    let attempt: OutreachAttempt & { replayed?: boolean };
    if (b.action === "open") {
      if (!Number.isInteger(b.version)) throw new HttpError(400, "Falta la versión del intento.");
      attempt = await prospectRpc("habita_prospect_open", { p_actor: actor.id, p_attempt: id, p_version: b.version, p_lease_seconds: 600 });
      if (attempt.status === "uncertain")
        return Response.json(
          { error: "El bloqueo anterior venció sin confirmación: el mensaje pudo haberse enviado. Revisá el canal y conciliá.", code: "UNCERTAIN", attempt },
          { status: 409, headers: NO_STORE },
        );
      if (attempt.status === "cancelled")
        return Response.json({ error: "Hay una baja vigente o el contacto quedó inválido: el intento se canceló sin abrir el canal.", code: "CANCELLED", attempt }, { status: 409, headers: NO_STORE });
      return Response.json({ attempt, url: channelUrl(attempt) }, { headers: NO_STORE });
    }
    if (b.action === "confirm") {
      if (b.observed !== true) throw new HttpError(400, "Confirmá que observaste el mensaje enviado en el canal.");
      if (b.method !== "channel_observed" && b.method !== "manual") throw new HttpError(400, "Elegí cómo verificaste el envío.");
      attempt = await prospectRpc("habita_prospect_confirm", {
        p_actor: actor.id,
        p_attempt: id,
        p_method: b.method,
        p_sent_at: iso(b.sentAt),
        p_external_id: text(b.externalId, 200),
        p_evidence: text(b.evidence, 500),
      });
      return Response.json({ attempt }, { headers: NO_STORE });
    }
    if (b.action === "resolve") {
      if (typeof b.outcome !== "string" || !OUTCOMES.has(b.outcome)) throw new HttpError(400, "Resultado no válido.");
      attempt = await prospectRpc("habita_prospect_resolve", { p_actor: actor.id, p_attempt: id, p_outcome: b.outcome, p_reason: text(b.reason, 300) });
      return Response.json({ attempt }, { headers: NO_STORE });
    }
    throw new HttpError(400, "Acción no válida.");
  } catch (e) {
    return prospectFailure(e);
  }
}
