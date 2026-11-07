import "server-only";
import { HttpError } from "@/lib/commerce/http";
import { contactFor, stableUuid, stepFor } from "./external";
import { ProspectError, prospectRpc } from "./server";
import type { Dataset, ProspectAccount } from "./types";

export type SendInput = { channel?: string; template?: string; step?: number; text?: string; subject?: string };

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * Registra un mensaje que ya salió por el canal: prepara, abre y confirma el intento de una vez,
 * con las reglas del panel del equipo (contacto revisado, bajas, secuencia de tres pasos). Lo usan
 * Chapa Labs («Mandé el mensaje») y Follow-up («Confirmar envío»): quien lo registra confirma que
 * lo vio salir. `where` nombra el lugar en la evidencia («Chapa Labs», «Follow-up»).
 */
export async function recordSend(actor: string, ds: Dataset, a: ProspectAccount, act: SendInput, by: string, where = "Chapa Labs") {
  const channel = act.channel === "email" ? "email" : act.channel === "whatsapp" || !act.channel ? "whatsapp" : null;
  if (!channel) throw new HttpError(400, "En habita. se registran envíos por WhatsApp o email. Las llamadas y visitas van como nota.");
  const step = stepFor(ds, a, act);
  if (step > 3) throw new HttpError(409, "Ya se mandaron los tres pasos de la secuencia: no se escribe más hasta que responda.");
  const done = ds.attempts.find((t) => t.account_id === a.id && t.status === "sent" && t.step === step && step >= 1);
  // El registro en lote (o un reintento) de un paso que ya está no suma nada.
  if (done) return;
  // Un intento que quedó vivo en el panel del equipo: si está abierto o incierto, el mensaje es ese;
  // si solo estaba preparado, se cancela y se registra el que salió desde acá.
  const live = ds.attempts.find((t) => t.account_id === a.id && ["prepared", "opened", "uncertain"].includes(t.status));
  let attemptId = live && live.status !== "prepared" ? live.id : null;
  if (live && live.status === "prepared") await prospectRpc("habita_prospect_resolve", { p_actor: actor, p_attempt: live.id, p_outcome: "cancelled", p_reason: `Enviado desde ${where}` });
  if (!attemptId) {
    const contact = contactFor(a, channel);
    if (!contact) throw new HttpError(409, channel === "email" ? "La cuenta no tiene un email que se pueda usar." : "La cuenta no tiene un WhatsApp que se pueda usar (falta, es inválido o tiene baja).");
    if (contact.needs_review) throw new ProspectError(409, "El número está por revisar: verificalo en la ficha de habita. antes de registrar el envío.", "CONTACT_NEEDS_REVIEW");
    const body = str(act.text, 4000) || `Mensaje enviado desde ${where}${act.template ? ` (${act.template})` : ""}.`;
    const prepared = await prospectRpc<{ id: string; version: number; status: string }>("habita_prospect_prepare", {
      p_actor: actor,
      // Misma cuenta, paso e historia: un reintento devuelve el mismo intento.
      p_key: stableUuid(`send:${a.id}:${step}:${channel}:${ds.attempts.filter((t) => t.account_id === a.id).length}`),
      p_account: a.id,
      p_contact: contact.id,
      p_step: step,
      p_campaign: a.campaign,
      p_template_version: null,
      p_custom: true,
      p_subject: channel === "email" ? str(act.subject, 200) || "habita." : null,
      p_body: body,
      p_sender: by,
      p_reviewed: true,
    });
    if (prepared.status === "sent") return;
    attemptId = prepared.id;
    if (prepared.status === "prepared") {
      const opened = await prospectRpc<{ status: string }>("habita_prospect_open", { p_actor: actor, p_attempt: prepared.id, p_version: prepared.version, p_lease_seconds: 600 });
      if (opened.status === "cancelled") throw new HttpError(409, "Hay una baja vigente o el contacto quedó inválido: no se registró el envío.");
    }
  }
  await prospectRpc("habita_prospect_confirm", {
    p_actor: actor,
    p_attempt: attemptId,
    p_method: "manual",
    p_sent_at: null,
    p_external_id: null,
    p_evidence: `Confirmado en ${where} por ${by}`,
  });
}
