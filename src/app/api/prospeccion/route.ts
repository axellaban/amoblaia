import { HttpError, isAdmin } from "@/lib/commerce/http";
import { demoUrl, isUuid } from "@/lib/demos/shared";
import { activity, contactFor, HEADER, stableUuid, stepFor, toRow } from "@/lib/prospecting/external";
import { NO_STORE, ProspectError, prospectDataset, prospectFailure, prospectRpc } from "@/lib/prospecting/server";
import type { Dataset, ProspectAccount } from "@/lib/prospecting/types";
import { sameSecret } from "@/lib/session";
import { cloudConfigured, cloudEnabled } from "@/lib/supabase/config";
import { adminClient } from "@/lib/supabase/server";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * La prospección de habita. para el panel comercial de Chapa Labs, servidor a servidor, como la API
 * de Turnia. `Authorization: Bearer $PROSPECTING_API_SECRET` (o `$METRICS_SECRET`).
 *
 *   GET                       { header, rows, events }: una fila por cuenta (ver lib/prospecting/external.ts).
 *   POST { code, action, by } aplica una acción a la cuenta `code` y devuelve { header, row }.
 *
 * Las acciones pasan por las mismas funciones que el panel del equipo (/admin/prospeccion), con sus
 * reglas: solo contactos revisados, bajas, secuencia de tres pasos, evidencia. «Mandé el mensaje»
 * hace de una los tres pasos del panel (preparar, abrir y confirmar): quien lo registra en Chapa
 * confirma que lo vio salir. Los cambios quedan a nombre de PROSPECTING_ACTOR_ID (o
 * PROSPECT_SYNC_ACTOR_ID, o el primer usuario de ADMIN_EMAILS).
 */
function authorized(request: Request) {
  const got = request.headers.get("authorization") || "";
  return ["PROSPECTING_API_SECRET", "METRICS_SECRET"]
    .map((k) => process.env[k]?.trim() ?? "")
    .some((s) => s.length >= 32 && sameSecret(got, `Bearer ${s}`));
}

let cachedActor: string | null = null;
async function actorId() {
  const env = [process.env.PROSPECTING_ACTOR_ID, process.env.PROSPECT_SYNC_ACTOR_ID].map((v) => v?.trim()).find((v) => isUuid(v));
  if (env) return env;
  if (cachedActor) return cachedActor;
  const { data } = await adminClient().auth.admin.listUsers({ page: 1, perPage: 1000 });
  const admin = (data?.users ?? []).find((u) => isAdmin(u.email));
  if (!admin) throw new HttpError(503, "Falta PROSPECTING_ACTOR_ID: el UUID de un usuario del equipo, a nombre de quien quedan los cambios.");
  cachedActor = admin.id;
  return admin.id;
}

type Demo = { url: string; opened: boolean; tried: boolean };
/** La última demo publicada de cada inmobiliaria y hasta dónde llegaron sus visitas. */
async function demosOf(ds: Dataset, origin: string) {
  const out = new Map<string, Demo>();
  const ids = [...new Set(ds.accounts.map((a) => a.agency_id))];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await adminClient().from("demos").select("agency_id,token,status,published_at,activity_level").in("agency_id", ids.slice(i, i + 200));
    if (error) throw new Error(`DATABASE_${error.code}`);
    const rows = ((data ?? []) as { agency_id: string; token: string; status: string; published_at: string | null; activity_level: number }[])
      .filter((d) => d.status === "published")
      .sort((x, y) => String(x.published_at).localeCompare(String(y.published_at)));
    for (const d of rows) {
      const prev = out.get(d.agency_id);
      out.set(d.agency_id, { url: demoUrl(origin, d.token), opened: Boolean(prev?.opened) || d.activity_level >= 1, tried: Boolean(prev?.tried) || d.activity_level >= 2 });
    }
  }
  return out;
}

async function sheet(origin: string) {
  const ds = await prospectDataset();
  const demos = await demosOf(ds, origin);
  return { ds, demos };
}

export async function GET(request: Request) {
  if (!authorized(request)) return new Response("Unauthorized", { status: 401 });
  try {
    if (!cloudEnabled() || !cloudConfigured()) throw new HttpError(503, "La base de prospección no está disponible.");
    const { ds, demos } = await sheet(new URL(request.url).origin);
    return Response.json(
      { header: HEADER, rows: ds.accounts.map((a) => toRow(ds, a, demos.get(a.agency_id))), events: activity(ds) },
      { headers: NO_STORE },
    );
  } catch (e) {
    return prospectFailure(e);
  }
}

type Action = {
  type?: string;
  channel?: string;
  template?: string;
  step?: number;
  text?: string;
  subject?: string;
  outcome?: string;
  detail?: string;
  nextAt?: string;
  nextStep?: string;
  fields?: Record<string, unknown>;
};

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const minute = () => new Date().toISOString().slice(0, 16);
/** Fecha «AAAA-MM-DD» del panel de Chapa como el inicio de ese día en Buenos Aires. */
const dayIso = (d: string) => (/^\d{4}-\d{2}-\d{2}/.test(d) ? new Date(`${d.slice(0, 10)}T00:00:00-03:00`).toISOString() : null);

async function send(actor: string, ds: Dataset, a: ProspectAccount, act: Action, by: string) {
  const channel = act.channel === "email" ? "email" : act.channel === "whatsapp" || !act.channel ? "whatsapp" : null;
  if (!channel) throw new HttpError(400, "En habita. se registran envíos por WhatsApp o email. Las llamadas y visitas van como nota.");
  const step = stepFor(ds, a, act);
  if (step > 3) throw new HttpError(409, "Ya se mandaron los tres pasos de la secuencia: no se escribe más hasta que responda.");
  const done = ds.attempts.find((t) => t.account_id === a.id && t.status === "sent" && t.step === step && step >= 1);
  // El registro en lote (o un reintento) de un paso que ya está no suma nada.
  if (done) return;
  // Un intento que quedó vivo en el panel del equipo: si está abierto o incierto, el mensaje es ese;
  // si solo estaba preparado, se cancela y se registra el que salió desde Chapa.
  const live = ds.attempts.find((t) => t.account_id === a.id && ["prepared", "opened", "uncertain"].includes(t.status));
  let attemptId = live && live.status !== "prepared" ? live.id : null;
  if (live && live.status === "prepared") await prospectRpc("habita_prospect_resolve", { p_actor: actor, p_attempt: live.id, p_outcome: "cancelled", p_reason: "Enviado desde Chapa Labs" });
  if (!attemptId) {
    const contact = contactFor(a, channel);
    if (!contact) throw new HttpError(409, channel === "email" ? "La cuenta no tiene un email que se pueda usar." : "La cuenta no tiene un WhatsApp que se pueda usar (falta, es inválido o tiene baja).");
    if (contact.needs_review) throw new ProspectError(409, "El número está por revisar: verificalo en la ficha de habita. antes de registrar el envío.", "CONTACT_NEEDS_REVIEW");
    const body = str(act.text, 4000) || `Mensaje enviado desde Chapa Labs${act.template ? ` (${act.template})` : ""}.`;
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
    p_evidence: `Confirmado en Chapa Labs por ${by}`,
  });
}

async function record(actor: string, a: ProspectAccount, type: string, by: string, act: Action, extra: Record<string, unknown> = {}) {
  const evidence = str(act.detail, 1000) || str(act.text, 1000) || `Registrado en Chapa Labs por ${by}`;
  await prospectRpc("habita_prospect_record", {
    p_actor: actor,
    p_key: stableUuid(`record:${a.id}:${type}:${by}:${minute()}`),
    p_account: a.id,
    p_type: type,
    p_occurred_at: new Date().toISOString(),
    p_precision: "time",
    p_channel: act.channel && ["whatsapp", "email", "phone", "instagram", "web", "other"].includes(act.channel) ? act.channel : null,
    p_contact: null,
    p_attempt: null,
    p_evidence: evidence,
    p_details: extra,
    p_corrects: null,
  });
}

async function update(actor: string, a: ProspectAccount, patch: Record<string, unknown>) {
  if (!Object.keys(patch).length) throw new HttpError(400, "No hay cambios.");
  await prospectRpc("habita_prospect_update", { p_actor: actor, p_account: a.id, p_version: a.version, p_patch: patch });
}

const EDIT: Record<string, string> = { zone: "zone", sdr: "sdr", priority: "priority", campaign: "campaign", nextStep: "next_action" };

async function apply(actor: string, ds: Dataset, a: ProspectAccount, act: Action, by: string) {
  switch (act.type) {
    case "sent":
      return send(actor, ds, a, act, by);
    case "call":
    case "visit":
      return record(actor, a, "note", by, { ...act, channel: act.type === "call" ? "phone" : "other", detail: `${act.type === "call" ? "Llamada" : "Visita"}${act.detail ? `: ${act.detail}` : ""}` });
    case "note":
      if (!str(act.text, 1000)) throw new HttpError(400, "La nota está vacía.");
      return record(actor, a, "note", by, act);
    case "outcome":
      switch (act.outcome) {
        case "respondio":
          return record(actor, a, "reply", by, act);
        case "interesado":
          return record(actor, a, "interest", by, act);
        case "reunion":
          return record(actor, a, "meeting", by, act);
        case "perdido":
          return record(actor, a, "lost", by, act, { reason: str(act.detail, 300) || "No le interesa" });
        case "baja":
          await prospectRpc("habita_prospect_suppress", { p_actor: actor, p_account: a.id, p_scope: "account", p_channel: null, p_contact: null, p_reason: str(act.detail, 300) || `Pidió no recibir más (Chapa Labs, ${by})` });
          return;
        case "invalido": {
          const c = contactFor(a, "whatsapp");
          if (!c) throw new HttpError(409, "La cuenta no tiene un WhatsApp para marcar como inválido.");
          await prospectRpc("habita_prospect_contact", { p_actor: actor, p_account: a.id, p_contact: c.id, p_fields: { invalid: true, invalid_reason: str(act.detail, 300) || "No tiene WhatsApp (Chapa Labs)" } });
          return;
        }
        case "cliente":
          throw new HttpError(400, "En habita. «Cliente» sale solo del primer pago aprobado: no se marca a mano.");
        default:
          throw new HttpError(400, "Resultado desconocido.");
      }
    case "reopen":
      return record(actor, a, "reopened", by, act);
    case "schedule":
      return update(actor, a, { next_action: str(act.nextStep, 300) || null, due_at: dayIso(str(act.nextAt, 20)), due_precision: "day" });
    case "edit": {
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(act.fields ?? {})) {
        if (k === "nextAt") { patch.due_at = dayIso(str(v, 20)); patch.due_precision = "day"; }
        else if (EDIT[k]) patch[EDIT[k]] = str(v, 300) || null;
      }
      if (!Object.keys(patch).length) throw new HttpError(400, "Desde Chapa se editan zona, SDR, prioridad, campaña y el próximo paso. Lo demás (contactos, nombre) en la ficha de habita.");
      return update(actor, a, patch);
    }
    case "undo":
      throw new HttpError(400, "En habita. no se deshace: corregí el registro desde la ficha del panel del equipo («Corregir»).");
    case "demo":
      throw new HttpError(400, "En habita. la visita a la demo se registra sola.");
    default:
      throw new HttpError(400, "Acción desconocida.");
  }
}

export async function POST(request: Request) {
  if (!authorized(request)) return new Response("Unauthorized", { status: 401 });
  try {
    if (!cloudEnabled() || !cloudConfigured()) throw new HttpError(503, "La base de prospección no está disponible.");
    const b = (await request.json().catch(() => null)) as { code?: unknown; action?: Action; by?: unknown } | null;
    if (!b || !isUuid(b.code) || !b.action || typeof b.action.type !== "string") throw new HttpError(400, "Falta la cuenta o la acción.");
    const by = str(b.by, 80) || "Chapa Labs";
    const origin = new URL(request.url).origin;
    const actor = await actorId();
    const before = await prospectDataset();
    const account = before.accounts.find((a) => a.id === b.code);
    if (!account) throw new HttpError(404, "No encontramos esa cuenta en habita.");
    await apply(actor, before, account, b.action, by);
    const { ds, demos } = await sheet(origin);
    const after = ds.accounts.find((a) => a.id === account.id)!;
    return Response.json({ header: HEADER, row: toRow(ds, after, demos.get(after.agency_id)) }, { headers: NO_STORE });
  } catch (e) {
    return prospectFailure(e);
  }
}
