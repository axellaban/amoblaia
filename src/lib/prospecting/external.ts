// La prospección de habita. vista como una planilla, para el panel comercial de Chapa Labs
// (chapa-labs, /prospecting/habita). Es la misma forma que la API de Turnia: un encabezado y una
// fila por cuenta, con los nombres de columna que ese panel reconoce. Todo sale del dataset del
// panel del equipo (/admin/prospeccion): la planilla de Google sigue siendo solo de entrada.
import { createHash } from "node:crypto";
import { TZ } from "./time";
import type { Dataset, OutreachAttempt, ProspectAccount, ProspectContact } from "./types";

export const HEADER = [
  "ID", "Inmobiliaria", "Saludo", "Teléfono", "Confianza del número", "Email", "Web", "Zona", "SDR", "Campaña", "Prioridad", "Score",
  "Estado", "Mensajes", "Primer contacto", "Último contacto", "Último canal", "Próximo paso", "Fecha del próximo paso",
  "Link de su demo", "Abrió la demo", "Probó la demo", "Respondió", "Interesado", "Reunión", "Cliente", "Motivo de pérdida", "Baja", "Actualizado",
] as const;

/** «AAAA-MM-DD HH:mm» en Buenos Aires (o solo el día, si el dato es de día). */
export function local(iso: string | null | undefined, precision: "time" | "day" | null = "time") {
  if (!iso) return "";
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value]),
  );
  const day = `${p.year}-${p.month}-${p.day}`;
  return precision === "day" ? day : `${day} ${p.hour}:${p.minute}`;
}

const usable = (c: ProspectContact) => Boolean(c.address) && !c.invalid && !c.blocked;
/** El contacto al que se le escribe por ese canal: el principal, si se puede usar. */
export function contactFor(a: ProspectAccount, channel: "whatsapp" | "email") {
  const list = a.contacts.filter((c) => c.channel === channel && usable(c));
  return list.find((c) => !c.needs_review) ?? list[0] ?? null;
}

export const sentOf = (ds: Pick<Dataset, "attempts">, accountId: string) =>
  ds.attempts.filter((t) => t.account_id === accountId && t.status === "sent").sort((x, y) => String(x.sent_at).localeCompare(String(y.sent_at)));
/** Pasos de la secuencia (1 a 3) ya enviados: los «mensajes» del panel de Chapa. */
export const touchesOf = (sent: OutreachAttempt[]) => new Set(sent.filter((t) => t.step >= 1 && t.step <= 3).map((t) => t.step)).size;

const ESTADO: Record<string, string> = {
  pending: "Pendiente",
  sent: "Enviado",
  conversation: "Respondió",
  interested: "Interesado",
  // Activada no es cliente: en Chapa sigue como interesada; la activación se mide con las métricas.
  activated: "Interesado",
  customer: "Cliente",
  lost: "No interesado",
  discarded: "Descartado",
};

type Demo = { url: string; opened: boolean; tried: boolean };

export function toRow(ds: Dataset, a: ProspectAccount, demo: Demo | undefined) {
  const sent = sentOf(ds, a.id);
  const first = sent[0];
  const last = sent[sent.length - 1];
  const ev = (type: string) => ds.events.find((e) => e.account_id === a.id && e.type === type && !e.corrected);
  const when = (e: { occurred_at: string; precision: "time" | "day" } | undefined) => (e ? local(e.occurred_at, e.precision) : "");
  const wa = contactFor(a, "whatsapp");
  const allBad = a.contacts.length > 0 && a.contacts.every((c) => c.invalid);
  const estado = a.suppressed ? "Baja" : a.stage === "pending" && allBad ? "Número incorrecto" : ESTADO[a.stage] ?? "Pendiente";
  const values: Record<(typeof HEADER)[number], string | number> = {
    ID: a.id,
    Inmobiliaria: a.name,
    Saludo: (a.decision_maker ?? "").trim().split(/\s+/)[0] ?? "",
    Teléfono: wa?.address ?? "",
    "Confianza del número": wa ? (wa.needs_review ? "revisar" : "verificado") : "",
    Email: contactFor(a, "email")?.address ?? "",
    Web: a.website ?? "",
    Zona: a.zone ?? "",
    SDR: a.sdr ?? "",
    Campaña: a.campaign ?? "",
    Prioridad: a.priority ?? "",
    Score: a.score ?? "",
    Estado: estado,
    Mensajes: touchesOf(sent),
    "Primer contacto": first ? local(first.sent_at, first.sent_precision) : "",
    "Último contacto": last ? local(last.sent_at, last.sent_precision) : "",
    "Último canal": last && last.channel !== "unknown" ? last.channel : "",
    "Próximo paso": a.next_action ?? "",
    "Fecha del próximo paso": local(a.due_at, "day"),
    "Link de su demo": demo?.url ?? "",
    "Abrió la demo": demo?.opened ? "sí" : "",
    "Probó la demo": demo?.tried ? "sí" : "",
    Respondió: when(ev("reply")) || when(ev("interest")) || when(ev("not_interested")) || when(ev("meeting")),
    Interesado: when(ev("interest")),
    Reunión: when(ev("meeting")),
    Cliente: when(ev("purchased")),
    "Motivo de pérdida": a.lost_reason ?? "",
    Baja: a.suppressed ? "sí" : "",
    Actualizado: a.version,
  };
  return HEADER.map((h) => values[h]);
}

/** La historia que muestra la ficha de Chapa: envíos confirmados y los hechos registrados. */
export function activity(ds: Dataset) {
  const name = new Map(ds.accounts.map((a) => [a.id, a.name]));
  const out = [
    ...ds.attempts
      .filter((t) => t.status === "sent" && t.sent_at)
      .map((t) => ({ at: local(t.sent_at, t.sent_precision), id: t.account_id, account: name.get(t.account_id) ?? "", type: "mensaje", channel: t.channel === "unknown" ? "" : t.channel, template: t.variant_label ?? "", detail: t.legacy ? "Registrado en la planilla" : "", by: t.sender ?? "" })),
    ...ds.events
      .filter((e) => !e.corrected)
      .map((e) => ({ at: local(e.occurred_at, e.precision), id: e.account_id, account: name.get(e.account_id) ?? "", type: EVENT[e.type] ?? e.type, channel: e.channel ?? "", template: "", detail: String((e.details as { reason?: string })?.reason ?? ""), by: "" })),
  ];
  return out.sort((x, y) => x.at.localeCompare(y.at));
}
const EVENT: Record<string, string> = { reply: "respondio", interest: "interesado", not_interested: "perdido", meeting: "reunion", lost: "perdido", purchased: "cliente", activated: "activada", auto_reply: "respuesta_automatica", refunded: "reembolso" };

/** Un UUID estable a partir de un texto: la misma operación repetida usa la misma clave (idempotencia). */
export function stableUuid(text: string) {
  const h = createHash("sha256").update(`chapa:${text}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * El paso de un envío: el que dice la plantilla de Chapa («whatsapp_2» es el 2) o el que pide el
 * registro en lote; si no, el siguiente de la secuencia. Si ya respondió, es conversación (0).
 */
export function stepFor(ds: Dataset, a: ProspectAccount, hint: { template?: unknown; step?: unknown }) {
  const replied = ds.events.some((e) => e.account_id === a.id && !e.corrected && ["reply", "interest", "not_interested", "meeting"].includes(e.type));
  if (replied || ["conversation", "interested", "activated", "customer"].includes(a.stage)) return 0;
  if (Number.isInteger(hint.step) && (hint.step as number) >= 1 && (hint.step as number) <= 3) return hint.step as number;
  const m = typeof hint.template === "string" ? /_(\d)$/.exec(hint.template) : null;
  if (m && +m[1] >= 1 && +m[1] <= 3) return +m[1];
  const done = new Set(sentOf(ds, a.id).filter((t) => t.step >= 1).map((t) => t.step));
  for (let s = 1; s <= 3; s++) if (!done.has(s)) return s;
  return 4;
}
