import "server-only";
import { HttpError } from "@/lib/commerce/http";
import { agencyStep } from "@/lib/agency/demo-funnel";
import { commercialRow, commercialRows } from "@/lib/agency/commercial-server";
import type { CommercialRow } from "@/lib/agency/commercial";
import { createAgencyRecord } from "@/lib/agency/admin-edit";
import { agencyDemoLink, setDemosSent } from "@/lib/agency/external";
import { agencyPanelLink } from "@/lib/agency/panel-link";
import { normalizeArNumber } from "@/lib/demos/send";
import { isUuid } from "@/lib/demos/shared";
import { contactFor, stableUuid } from "@/lib/prospecting/external";
import { recordSend } from "@/lib/prospecting/record-send";
import { prospectDataset, prospectRpc } from "@/lib/prospecting/server";
import type { Dataset, OutreachAttempt, ProspectAccount } from "@/lib/prospecting/types";
import { artDate } from "@/lib/prospecting/time";
import { adminClient } from "@/lib/supabase/server";
import {
  FOLLOWUP_STAGES,
  OUT,
  byScore,
  cleanVersion,
  isOverrideStage,
  fillMessage,
  isStageKey,
  linksNeeded,
  missingVariables,
  personName,
  lastActionOf,
  placement,
  stageInfo,
  stageOf,
  type OverrideStage,
  versionFor,
  versionStats,
  stepValue,
  type Channel,
  type ExecutionStatus,
  type FollowupExecution,
  type FollowupVersion,
  type LastAction,
  type StageKey,
  type VersionStats,
} from "./stages";
import {
  CLOSED_SITUATIONS,
  DAILY_NEW_CAP,
  SITUATIONS,
  actionLabel,
  byPriority,
  currentSituation,
  derivedSituation,
  groupOf,
  isSituation,
  nameKey,
  nextAction,
  outsideHours,
  shortName,
  splitMessages,
  defaultPriority,
  isPriority,
  type Priority,
  FACU_CLASSES,
  REPLY_CLASSES,
  isReplyClass,
  replyRoute,
  type ReplyClass,
  type Action,
  type Group,
  type Situation,
} from "./plan";
import { DEFAULT_RULES, cleanRule, outsideWindow, type Rule } from "./rules";
import { WINDOWS, blockReasons, bySegment, cohorts, versionResults, weekly, type VersionResult, type WindowKey } from "./results";

/**
 * Follow-up (/admin/follow-up): each funnel stage with its next best action,
 * its versions measured and the agencies waiting in it. The agencies and
 * their step come from commercialRows, the same rows as /admin/inmobiliarias
 * («Todo»), so a stage holds exactly the orange part of that bar.
 */

export const MIGRATION = "202612010001_followup_edit.sql";
const MISSING = `Para Follow-up falta aplicar las migraciones 202611300001_followup.sql y ${MIGRATION} en Supabase.`;
const missing = (e: { code?: string; message?: string } | null) =>
  Boolean(e && (e.code === "PGRST205" || e.code === "PGRST202" || e.code === "42P01" || e.code === "42883" || /followup_/.test(e.message ?? "")));

const PAGE = 1000;
async function readAll<T>(table: string, columns: string) {
  const out: T[] = [];
  for (let from = 0; from < 50000; from += PAGE) {
    const { data, error } = await adminClient().from(table).select(columns).range(from, from + PAGE - 1);
    if (error) throw missing(error) ? new HttpError(409, MISSING) : new Error("FOLLOWUP_READ_FAILED");
    out.push(...((data ?? []) as T[]));
    if ((data ?? []).length < PAGE) break;
  }
  return out;
}
const VERSION_FIELDS = "id,stage,action,version,channel,trigger_label,body,ctas,status,created_at,status_at,notes,edited_at";
const versions = () => readAll<FollowupVersion>("followup_versions", VERSION_FIELDS);

/** What Follow-up keeps of each agency: its corrected stage, and the address, zone and score of the ones added by hand. */
type AgencyExtra = {
  agency_id: string;
  stage_override: OverrideStage | null;
  override_step: number | null;
  address: string | null;
  zone: string | null;
  score: number | null;
  situation: Situation | null;
  situation_step: number | null;
  situation_note: string | null;
  situation_at: string | null;
  short_name: string | null;
  priority: Priority | null;
  snooze_until: string | null;
  snooze_reason: string | null;
};
const extras = async (agencyId?: string) => {
  let q = adminClient().from("followup_agencies").select("agency_id,stage_override,override_step,address,zone,score,situation,situation_step,situation_note,situation_at,short_name,priority,snooze_until,snooze_reason");
  if (agencyId) q = q.eq("agency_id", agencyId);
  const { data, error } = await q.limit(20000);
  if (error) throw missing(error) ? new HttpError(409, MISSING) : new Error("FOLLOWUP_READ_FAILED");
  return new Map(((data ?? []) as AgencyExtra[]).map((x) => [x.agency_id, { ...x, score: x.score === null ? null : Number(x.score) }]));
};

/** Las reglas activas e inactivas (Fase 3). Sin la tabla, la migración falta. */
async function readRules(): Promise<Rule[]> {
  const { data, error } = await adminClient().from("followup_rules").select("key,stage,situations,action,after_hours,after_action,position,enabled,hours_from,hours_to,days").limit(500);
  if (error) throw missing(error) || /followup_rules/.test(error.message ?? "") ? new HttpError(409, MISSING) : new Error("FOLLOWUP_READ_FAILED");
  return ((data ?? []) as Rule[]).map((r) => ({ ...r, after_hours: Number(r.after_hours) }));
}

/** Deja constancia de un cambio a mano: quién, qué y cuándo. Nunca frena el cambio. */
async function audit(subject: string, actor: { id: string; name?: string }, f: { agencyId?: string | null; ref?: string | null; from?: unknown; to?: unknown }) {
  const text = (v: unknown) => (v === undefined || v === null ? null : String(typeof v === "object" ? JSON.stringify(v) : v).slice(0, 2000));
  await adminClient()
    .from("followup_audit")
    .insert({ agency_id: f.agencyId ?? null, subject, ref: f.ref ?? null, old_value: text(f.from), new_value: text(f.to), actor_id: actor.id, actor_name: actor.name ?? "" })
    .then(() => undefined, () => undefined);
}

/** What the prospecting sheet said of the account: its «Estado» and its «Fecha envío». */
type SheetFacts = { status: string | null; sentDate: string | null };
function sheetFacts(row: Record<string, unknown>): SheetFacts {
  const find = (re: RegExp) => {
    const k = Object.keys(row).find((x) => re.test(x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim()));
    const v = k ? row[k] : null;
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  return { status: find(/^estado$/), sentDate: find(/^fecha (de )?envio$/) };
}

/** The agency's web and contact name, and its prospecting account's address (optional sources: missing reads as nothing). */
async function details(agencyId?: string) {
  const [agencies, accounts] = await Promise.all([
    readAll<{ id: string; website: string | null; contact_name: string | null }>("agencies", "id,website,contact_name").catch(() => []),
    readAll<{ agency_id: string; address: string | null; stage: string; source_data: Record<string, unknown> | null }>("prospect_accounts", "agency_id,address,stage,source_data").catch(() => []),
  ]);
  const only = <T extends { id?: string; agency_id?: string }>(list: T[]) => (agencyId ? list.filter((x) => (x.id ?? x.agency_id) === agencyId) : list);
  return {
    agency: new Map(only(agencies).map((a) => [a.id, a])),
    address: new Map(only(accounts).filter((a) => a.address).map((a) => [a.agency_id, a.address])),
    sheet: new Map(
      only(accounts)
        .filter((a) => a.source_data && a.stage !== "lost" && a.stage !== "discarded")
        .map((a) => [a.agency_id, sheetFacts(a.source_data!)] as const),
    ),
  };
}
const executions = (agencyId?: string) =>
  agencyId
    ? adminClient()
        .from("followup_executions")
        .select("id,version_id,stage,action,agency_id,from_step,status,reason,created_at,updated_at,sent_at,converted_at")
        .eq("agency_id", agencyId)
        .then(({ data, error }) => {
          if (error) throw missing(error) ? new HttpError(409, MISSING) : new Error("FOLLOWUP_READ_FAILED");
          return (data ?? []) as FollowupExecution[];
        })
    : readAll<FollowupExecution>("followup_executions", "id,version_id,stage,action,agency_id,from_step,status,reason,created_at,updated_at,sent_at,converted_at");

/** The prospecting account of each agency: an open one before a lost or discarded one. */
function accountsByAgency(ds: Dataset | null) {
  const out = new Map<string, ProspectAccount>();
  for (const a of ds?.accounts ?? []) {
    const prev = out.get(a.agency_id);
    const closed = (x: ProspectAccount) => x.stage === "lost" || x.stage === "discarded";
    if (!prev || (closed(prev) && !closed(a))) out.set(a.agency_id, a);
  }
  return out;
}

/** An agency's place in the funnel (the same rule as the «Todo» funnel of /admin/inmobiliarias) and its follow-up stage. */
function derived(r: CommercialRow, account: ProspectAccount | undefined) {
  const demo = r.demos.length ? Math.max(...r.demos.map((d) => d.step)) : null;
  const reached = agencyStep(r.prospectFunnel?.step ?? null, demo);
  const closed = account?.stage === "lost" || account?.stage === "discarded";
  const stage = stageOf({
    reached,
    lost: Boolean(r.prospectFunnel?.lost) || (reached === null && closed),
    test: r.test,
    suppressed: Boolean(account?.suppressed),
    pendingProspect: Boolean(account && !closed),
  });
  return { reached, stage };
}

/** Where it goes in Follow-up: the funnel's stage, or the one corrected by hand while the funnel still says the same. */
function place(r: CommercialRow, account: ProspectAccount | undefined, extra: AgencyExtra | undefined) {
  const d = derived(r, account);
  const override = extra?.stage_override && extra.override_step !== null ? { stage: extra.stage_override, step: extra.override_step } : null;
  return { ...placement(d, override), derived: d };
}

/** Who to write to: the prospecting WhatsApp (the reviewed one first), else the agency's contact WhatsApp. */
function recipient(r: CommercialRow, account: ProspectAccount | undefined, contactName?: string | null) {
  const contact = account ? contactFor(account, "whatsapp") : null;
  const raw = contact?.address ?? r.whatsapp ?? null;
  const wa = normalizeArNumber(raw) ?? (raw && /^\d{10,15}$/.test(raw.replace(/\D/g, "")) ? raw.replace(/\D/g, "") : null);
  // The prospecting «decisor» is usually a category («Por confirmar», «Marca comercial»): only a real name counts.
  const person = personName(contact?.person_name) ?? personName(account?.decision_maker) ?? personName(contactName) ?? null;
  return { wa, phone: raw, person, needsReview: Boolean(contact?.needs_review), fromProspect: Boolean(contact) };
}

export type QueueItem = {
  agencyId: string;
  name: string;
  /** El nombre para {{inmobiliaria}}: el corto cargado a mano, o el de la ficha sin paréntesis ni forma societaria. */
  shortName: string;
  shortNameManual: boolean;
  person: string | null;
  phone: string | null;
  wa: string | null;
  needsReview: boolean;
  hasDemo: boolean;
  hasAccount: boolean;
  lastActivity: { at: string; text: string } | null;
  /** Lo más reciente entre Follow-up, Adquisición y lo que hizo la inmobiliaria. */
  lastAction: LastAction | null;
  since: string;
  /** In «No contactado», its prospecting score (loaded with the list, editable); in the other stages, its lead score. */
  score: number | null;
  scoreEditable: boolean;
  address: string | null;
  zone: string | null;
  website: string | null;
  /** Its properties (demos), as in /admin/inmobiliarias. */
  properties: number;
  stage: StageKey;
  /** The funnel step that counts (the corrected stage's, when it was corrected by hand). */
  step: number;
  /** Its stage was corrected by hand (by the team or the extension). */
  manual: boolean;
  situation: Situation;
  situationManual: boolean;
  situationNote: string | null;
  /** La próxima acción (fija por código en la Fase 1); null: nada que mandar. */
  action: Action | null;
  actionLabel: string | null;
  group: Group;
  /** Por qué no se puede ejecutar ahora; null: está en la cola. */
  blocked: string | null;
  /** Lo que el agente revisa antes de mandar (número sin validar, un WhatsApp abierto sin confirmar). */
  checks: string[];
  /** Otra sesión la tiene tomada (o esta misma). */
  claim: { actorId: string; by: string; until: string } | null;
  /** Alta, Media o Baja: la del grupo, o la que puso el equipo. */
  priority: Priority;
  priorityManual: boolean;
  /** Reprogramada: no entra a la cola hasta esta fecha. */
  snoozedUntil: string | null;
  /** La regla que eligió su acción (null: fija por código). */
  ruleKey: string | null;
  /** Ventana horaria de esa regla. */
  window: { hours_from: number; hours_to: number; days: number[] } | null;
  /** Demo prometida: cuándo mostró interés (va primera; a los 30 minutos está atrasada). */
  promisedAt: string | null;
  /** Por qué no hay acción (secuencia terminada, rechazo…). */
  actionReason: string | null;
  /** Horas de espera de su paso de la secuencia desde nuestro último mensaje. */
  afterHours: number;
  /** Programada: su paso sale en esta fecha (antes no entra a la cola). */
  dueAt: string | null;
  /** Respuestas suyas en la bandeja sin resolver (pendientes o de Facu). */
  openReplies: number;
  versionId: string | null;
  /** The channel of its version (WhatsApp or a team task). */
  versionChannel: Channel | null;
  execution: { status: ExecutionStatus; at: string; reason: string | null } | null;
};
export type StageView = {
  key: StageKey;
  title: string;
  goal: string;
  versions: (FollowupVersion & { stats: VersionStats })[];
  queue: QueueItem[];
};
export type QueueSummary = {
  /** Acciones para hoy: se pueden ejecutar ahora y nadie las tomó. */
  ready: number;
  /** Respuestas nuevas: confirmaron el número o preguntaron precios, o respondieron algo que se resuelve a mano. */
  replies: number;
  /** Demos pendientes: por crear o por enviar. */
  demos: number;
  /** Programadas: su paso de la secuencia sale más adelante. */
  scheduled: number;
  blocked: number;
  claimed: number;
  doneToday: number;
  newToday: number;
  cap: number;
};

type Claim = { agency_id: string; actor_id: string; actor_name: string; stage: string; action: string; locked_until: string };
const claims = async () => {
  const { data, error } = await adminClient().from("followup_claims").select("agency_id,actor_id,actor_name,stage,action,locked_until").gt("locked_until", new Date().toISOString()).limit(5000);
  if (error) throw missing(error) ? new HttpError(409, MISSING) : new Error("FOLLOWUP_READ_FAILED");
  return new Map(((data ?? []) as Claim[]).map((c) => [c.agency_id, c]));
};

const DAY_MS = 86_400_000;
const whenText = (iso: string) => new Date(iso).toLocaleString("es-AR", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });

/**
 * Everything Follow-up knows of every agency, computed once: its stage,
 * situation, next action, whether it can be executed now and why not. The
 * page, the agent's queue and each claim or confirmation read the same thing,
 * so the counters match the rows.
 */
async function board(now = new Date()) {
  const [rows, ds, vs, ex, extra, info, held, open, rules] = await Promise.all([
    commercialRows(),
    prospectDataset().catch(() => null),
    versions(),
    executions(),
    extras(),
    details(),
    claims(),
    openReplies(),
    readRules(),
  ]);
  const accounts = accountsByAgency(ds);
  const exOf = new Map<string, FollowupExecution[]>();
  for (const e of ex) exOf.set(e.agency_id, [...(exOf.get(e.agency_id) ?? []), e]);
  const agencyOfAccount = new Map((ds?.accounts ?? []).map((a) => [a.id, a.agency_id]));
  const sendsOf = new Map<string, OutreachAttempt[]>();
  for (const t of ds?.attempts ?? []) {
    const agency = agencyOfAccount.get(t.account_id);
    if (t.status === "sent" && agency) sendsOf.set(agency, [...(sendsOf.get(agency) ?? []), t]);
  }

  // New conversations in the last 24 hours: a first send (Follow-up's greeting or the sequence's step 1), once per agency.
  const since24 = now.getTime() - DAY_MS;
  const fresh = new Set<string>();
  for (const e of ex) if (e.stage === "no-contactado" && e.status === "sent" && e.sent_at && Date.parse(e.sent_at) >= since24) fresh.add(e.agency_id);
  for (const [agency, list] of sendsOf) if (list.some((t) => t.step === 1 && t.sent_at && Date.parse(t.sent_at) >= since24)) fresh.add(agency);

  // Our last message and their last reply, per agency: a follow-up waits, a reply is answered once.
  const lastOurs = new Map<string, number>();
  const later = (m: Map<string, number>, id: string, iso: string | null) => {
    const t = iso ? Date.parse(iso) : NaN;
    if (Number.isFinite(t) && t > (m.get(id) ?? 0)) m.set(id, t);
  };
  for (const [agency, list] of sendsOf) for (const t of list) later(lastOurs, agency, t.sent_at);
  for (const e of ex) if (e.status === "sent") later(lastOurs, e.agency_id, e.sent_at);
  const lastReply = new Map<string, number>();
  const lastInterest = new Map<string, number>();
  for (const e of ds?.events ?? []) {
    const agency = agencyOfAccount.get(e.account_id);
    if (agency && !e.corrected && (e.type === "reply" || e.type === "interest" || e.type === "not_interested")) later(lastReply, agency, e.occurred_at);
    if (agency && !e.corrected && e.type === "interest") later(lastInterest, agency, e.occurred_at);
  }

  const stepNow = new Map<string, number>();
  const base: { r: CommercialRow; account: ProspectAccount | undefined; own: AgencyExtra | undefined; at: ReturnType<typeof place> }[] = [];
  for (const r of rows) {
    const account = accounts.get(r.id);
    const own = extra.get(r.id);
    const at = place(r, account, own);
    stepNow.set(r.id, at.step);
    base.push({ r, account, own, at });
  }

  // Possible duplicates: another agency with the same number or the same name that was already contacted.
  const contacted = (id: string) => (stepNow.get(id) ?? -1) >= 0 || (sendsOf.get(id)?.length ?? 0) > 0 || (exOf.get(id) ?? []).some((e) => e.status === "sent");
  const byWa = new Map<string, string[]>();
  const byName = new Map<string, string[]>();
  const nameOf = new Map<string, string>();
  for (const { r, account } of base) {
    const wa = recipient(r, account).wa;
    if (wa) byWa.set(wa, [...(byWa.get(wa) ?? []), r.id]);
    const key = nameKey(r.name);
    if (key.length >= 4) byName.set(key, [...(byName.get(key) ?? []), r.id]);
    nameOf.set(r.id, r.name);
  }
  const duplicateOf = (id: string, wa: string | null, name: string) => {
    const other = [...(wa ? byWa.get(wa) ?? [] : []), ...(byName.get(nameKey(name)) ?? [])].find((x) => x !== id && contacted(x));
    return other ? nameOf.get(other)! : null;
  };

  const items = new Map<string, QueueItem>();
  for (const { r, account, own, at } of base) {
    if (!at.stage) continue;
    const it = item(r, account, own, info, at, vs, exOf.get(r.id) ?? [], sendsOf.get(r.id) ?? [], rules);
    // A promised demo (interested, the demo still to make or to send) goes first; past 30 minutes it is late.
    const interest = lastInterest.get(r.id);
    if (interest && (it.stage === "sin-demo" || it.stage === "sin-enviar") && it.execution?.status !== "sent") {
      it.promisedAt = new Date(interest).toISOString();
      it.priority = own?.priority ?? "alta";
    }
    const claim = held.get(r.id);
    it.claim = claim ? { actorId: claim.actor_id, by: claim.actor_name || "otra sesión", until: claim.locked_until } : null;
    const version = vs.find((v) => v.id === it.versionId);
    const snoozed = own?.snooze_until && Date.parse(own.snooze_until) > now.getTime() ? own.snooze_until : null;
    it.snoozedUntil = snoozed;
    const replies = open.get(r.id) ?? [];
    it.openReplies = replies.length;
    const ours = lastOurs.get(r.id) ?? null;
    const due = it.afterHours > 0 && ours ? ours + it.afterHours * 3600_000 : null;
    it.dueAt = due && due > now.getTime() && it.execution?.status !== "sent" ? new Date(due).toISOString() : null;
    it.blocked = replies.length
      ? replies.some((x) => x.status === "facu")
        ? "Asignada a Facu: tiene una respuesta que no se resuelve con el script."
        : "Tiene una respuesta sin clasificar en la bandeja."
      : snoozed
      ? `Reprogramada para el ${whenText(snoozed)}${own?.snooze_reason ? `: ${own.snooze_reason}` : ""}.`
      : it.dueAt
        ? `Programada para el ${whenText(it.dueAt)} (${it.actionLabel}, a las ${it.afterHours} h de nuestro último mensaje).`
        : blockReason(it, {
      account,
      sheet: info.sheet.get(r.id),
      duplicate: it.stage === "no-contactado" ? duplicateOf(r.id, it.wa, r.name) : null,
      newToday: fresh.size,
      now,
      lastOurs: lastOurs.get(r.id) ?? null,
      lastReply: lastReply.get(r.id) ?? null,
      needsDemo: Boolean(version && /\{\{\s*demo\s*\}\}/.test(version.body)),
    });
    items.set(r.id, it);
  }
  // Fase 4: the moment each execution converted, recorded the first time it is seen (the exact time when known).
  const firstDemo = new Map<string, number>();
  for (const r of rows) for (const d of r.demos) if (d.createdAt) later(firstDemo, r.id, d.createdAt);
  const pendingConv = ex.filter((e) => e.status === "sent" && e.sent_at && !e.converted_at && (stepNow.get(e.agency_id) ?? -1) > e.from_step);
  await Promise.all(
    pendingConv.slice(0, 200).map((e) => {
      const sentAt = Date.parse(e.sent_at!);
      const interest = lastInterest.get(e.agency_id);
      const demo = firstDemo.get(e.agency_id);
      const at = e.from_step < 1 && interest && interest >= sentAt ? interest : e.from_step < 2 && demo && demo >= sentAt ? demo : now.getTime();
      e.converted_at = new Date(at).toISOString();
      return adminClient()
        .from("followup_executions")
        .update({ converted_at: e.converted_at, converted_step: stepNow.get(e.agency_id) ?? null })
        .eq("id", e.id)
        .is("converted_at", null)
        .then(
          () => undefined,
          () => undefined,
        );
    }),
  );
  // Fase 4: per agency, its first contact and first reply (for the cohorts) and the greeting version it got.
  const firstReply = new Map<string, number>();
  for (const e of ds?.events ?? []) {
    const agency = agencyOfAccount.get(e.account_id);
    if (agency && !e.corrected && (e.type === "reply" || e.type === "interest")) {
      const t = Date.parse(e.occurred_at);
      if (Number.isFinite(t) && (!firstReply.has(agency) || t < firstReply.get(agency)!)) firstReply.set(agency, t);
    }
  }
  const firstContact = new Map<string, number>();
  const earlier = (id: string, iso: string | null) => {
    const t = iso ? Date.parse(iso) : NaN;
    if (Number.isFinite(t) && (!firstContact.has(id) || t < firstContact.get(id)!)) firstContact.set(id, t);
  };
  for (const [agency, list] of sendsOf) for (const t of list) earlier(agency, t.sent_at);
  for (const e of ex) if (e.status === "sent") earlier(e.agency_id, e.sent_at);
  const greeting = new Map<string, number>();
  for (const e of ex) if (e.status === "sent" && e.stage === "no-contactado" && (e.action ?? "principal") === "principal") greeting.set(e.agency_id, vs.find((v) => v.id === e.version_id)?.version ?? 0);
  const facts = [...stepNow.keys()].map((id) => ({
    firstContact: firstContact.has(id) ? new Date(firstContact.get(id)!).toISOString() : null,
    firstReply: firstReply.has(id) ? new Date(firstReply.get(id)!).toISOString() : null,
    step: stepNow.get(id) ?? -1,
    greetingVersion: greeting.get(id) ?? null,
  }));
  return { items, vs, ex, stepNow, newToday: fresh.size, open, names: new Map(rows.map((r) => [r.id, r.name])), rules, facts };
}

/** Why it cannot be executed now (in order of what to fix first), or null. */
function blockReason(
  it: QueueItem,
  f: { account: ProspectAccount | undefined; sheet: SheetFacts | undefined; duplicate: string | null; newToday: number; now: Date; lastOurs: number | null; lastReply: number | null; needsDemo: boolean },
) {
  if (!it.action) return it.actionReason ?? "Sin acción para esta situación.";
  if (it.execution?.status === "sent") return null;
  if (!it.versionId) return `Falta el texto de «${it.actionLabel}»: cargalo en la etapa «${stageInfo(it.stage).title}».`;
  if (it.stage === "no-contactado") {
    if (f.sheet?.sentDate) return `Ya contactada: la hoja tiene fecha de envío ${f.sheet.sentDate}. Corregí su estado.`;
    if (f.lastOurs) return `Ya le escribimos el ${whenText(new Date(f.lastOurs).toISOString())}. Corregí su estado.`;
  }
  if (f.duplicate) return `Posible duplicado de «${f.duplicate}», que ya fue contactada.`;
  if (it.group === "respuestas" && f.lastOurs && (!f.lastReply || f.lastOurs > f.lastReply))
    return `Ya le escribimos después de su última respuesta (${whenText(new Date(f.lastOurs).toISOString())}): esperá que conteste.`;
  if (f.needsDemo && !it.hasDemo) return "Variable incompleta: el mensaje lleva {{demo}} y todavía no tiene una demo publicada.";
  const channel = it.versionChannel;
  if (channel === "whatsapp" && !it.wa) return "Sin WhatsApp: cargalo en la ficha o marcala «Sin WhatsApp».";
  if (channel === "whatsapp" && it.group === "nuevos" && f.newToday >= DAILY_NEW_CAP) return `Tope de ${DAILY_NEW_CAP} conversaciones nuevas en 24 horas alcanzado.`;
  if (channel === "whatsapp") return it.window ? outsideWindow(it.window, f.now) : outsideHours(it.group, f.now);
  return null;
}

/** The agency's place, situation and next action, with its version and what was done. */
function item(
  r: CommercialRow,
  account: ProspectAccount | undefined,
  own: AgencyExtra | undefined,
  info: Awaited<ReturnType<typeof details>>,
  at: ReturnType<typeof place>,
  vs: FollowupVersion[],
  executionsOf: FollowupExecution[],
  sends: { status: string; sent_at: string | null; step: number }[],
  rules: Rule[] = DEFAULT_RULES,
): QueueItem {
  const stage = at.stage!;
  const agency = info.agency.get(r.id);
  const to = recipient(r, account, agency?.contact_name);
  const waContacts = account?.contacts.filter((c) => c.channel === "whatsapp") ?? [];
  const derived = derivedSituation({
    suppressed: Boolean(account?.suppressed),
    accountStage: account?.stage ?? null,
    lostReason: account?.lost_reason ?? null,
    sheetStatus: info.sheet.get(r.id)?.status ?? null,
    hasNumber: Boolean(to.wa),
    allInvalid: waContacts.length > 0 && waContacts.every((c) => c.invalid),
  });
  const sit = currentSituation(derived, own?.situation && own.situation_step !== null ? { situation: own.situation, step: own.situation_step } : null, stepValue(at.derived.reached));
  // The steps already sent in this stage: the sequence goes on from there.
  const stageSent = executionsOf.filter((e) => e.stage === stage && e.status === "sent").sort((a, b) => (b.sent_at ?? "").localeCompare(a.sent_at ?? ""));
  const doneMap: Partial<Record<Action, boolean>> = {};
  for (const e of stageSent) doneMap[(e.action ?? "principal") as Action] = true;
  const next = nextAction(stage, sit.situation, doneMap, rules);
  // The rule's window, or the one of the rule that sent the last step (for the row of a finished sequence).
  const window = next.rule ?? rules.find((x) => x.stage === stage && x.action === (stageSent[0]?.action ?? "principal")) ?? null;
  // Nothing left to send but something went out: the row shows that last one as sent.
  const action = next.action ?? (!CLOSED_SITUATIONS.includes(sit.situation) && stageSent[0] ? ((stageSent[0].action ?? "principal") as Action) : null);
  const mine = executionsOf.filter((e) => e.stage === stage && (e.action ?? "principal") === (action ?? "principal"));
  const offered = vs.filter((v) => v.stage === stage && (v.action ?? "principal") === (action ?? "principal"));
  const sent = mine.find((e) => e.status === "sent");
  const version = action ? (sent ? offered.find((v) => v.id === sent.version_id) ?? null : versionFor(r.id, offered, mine, action)) : null;
  const done = sent ?? (version ? mine.find((e) => e.version_id === version.id) : undefined);
  const uncontacted = stage === "no-contactado";
  const lastAction = lastActionOf({ executions: executionsOf, versions: vs, attempts: sends, activity: r.lastActivity });
  const checks: string[] = [];
  if (version?.channel === "whatsapp" && to.wa && to.needsReview) checks.push("Número sin validar: confirmá en el chat que es la inmobiliaria; al confirmar el envío queda validado.");
  if (done?.status === "opened") checks.push(`Se abrió WhatsApp el ${whenText(done.updated_at)} sin confirmar: revisá el chat antes de reenviar.`);
  const short = own?.short_name?.trim() || shortName(r.name);
  return {
    agencyId: r.id,
    name: r.name,
    shortName: short,
    shortNameManual: Boolean(own?.short_name?.trim()),
    person: to.person,
    phone: to.phone,
    wa: to.wa,
    needsReview: to.needsReview,
    hasDemo: Boolean(r.shareDemo),
    hasAccount: r.hasOwner,
    lastActivity: r.lastActivity,
    lastAction,
    since: lastAction?.at ?? r.prospectFunnel?.at ?? r.createdAt,
    score: uncontacted ? (account?.score ?? own?.score ?? null) : r.score,
    scoreEditable: uncontacted,
    address: info.address.get(r.id) ?? own?.address ?? null,
    zone: account?.zone ?? own?.zone ?? null,
    website: agency?.website ?? account?.website ?? null,
    properties: r.properties,
    stage,
    step: at.step,
    manual: at.manual,
    situation: sit.situation,
    situationManual: sit.manual,
    situationNote: sit.manual ? (own?.situation_note ?? null) : null,
    action,
    actionLabel: action ? actionLabel(stage, action) : null,
    group: groupOf(stage, action),
    afterHours: next.action ? next.afterHours : 0,
    ruleKey: next.rule?.key ?? null,
    window: window ? { hours_from: window.hours_from, hours_to: window.hours_to, days: window.days } : null,
    promisedAt: null,
    actionReason: next.reason,
    dueAt: null,
    priority: own?.priority ?? defaultPriority(groupOf(stage, action)),
    priorityManual: Boolean(own?.priority),
    snoozedUntil: null,
    openReplies: 0,
    blocked: null,
    checks,
    claim: null,
    versionId: version?.id ?? null,
    versionChannel: version?.channel ?? null,
    execution: done ? { status: done.status, at: done.updated_at, reason: done.reason } : null,
  };
}

/** The whole page: one view per stage, with its versions measured and its agencies (score from highest to lowest), and the execution queue. */
export type FunnelStep = { key: StageKey; title: string; goal: string; waiting: number; reached: number; rate: number | null };
export type Change = Awaited<ReturnType<typeof auditOf>>[number];
export type Results = ReturnType<typeof resultsOf>;

/** La pestaña Resultados: por regla y versión (con ventana de 7, 14 días o sin límite), por semana, cohortes y bloqueos. */
function resultsOf(b: Awaited<ReturnType<typeof board>>, all: QueueItem[]) {
  const pendingByVersion = new Map<string, number>();
  for (const q of all) if (q.versionId && q.execution?.status !== "sent" && q.action) pendingByVersion.set(q.versionId, (pendingByVersion.get(q.versionId) ?? 0) + 1);
  const windows = Object.fromEntries(
    (Object.keys(WINDOWS) as WindowKey[]).map((k) => [
      k,
      {
        versions: versionResults(b.vs, b.ex, b.stepNow, WINDOWS[k], pendingByVersion).filter((r) => r.eligible > 0 || r.status !== "archived"),
        weekly: weekly(b.ex, b.stepNow, WINDOWS[k]),
      },
    ]),
  ) as Record<WindowKey, { versions: VersionResult[]; weekly: ReturnType<typeof weekly> }>;
  const sent = b.ex.filter((e) => e.status === "sent");
  const since30 = Date.now() - 30 * DAY_MS;
  return {
    windows,
    totals: {
      executed30: sent.filter((e) => e.sent_at && Date.parse(e.sent_at) >= since30).length,
      replies30: b.facts.filter((f) => f.firstReply && Date.parse(f.firstReply) >= since30).length,
      failed: b.ex.filter((e) => e.status === "failed").length,
      pending: all.filter((q) => q.action && q.execution?.status !== "sent").length,
      blocked: all.filter((q) => q.action && q.execution?.status !== "sent" && q.blocked).length,
    },
    cohorts: { contacto: cohorts(b.facts, "contacto"), respuesta: cohorts(b.facts, "respuesta"), version: bySegment(b.facts) },
    blocks: blockReasons(all.filter((q) => q.action && q.execution?.status !== "sent" && q.blocked).map((q) => q.blocked!)),
  };
}
export async function followupOverview(): Promise<{ stages: StageView[]; queue: QueueItem[]; blocked: QueueItem[]; summary: QueueSummary; inbox: InboxItem[]; funnel: FunnelStep[]; rules: Rule[]; changes: Change[]; results: Results }> {
  const [b, changes] = await Promise.all([board(), auditOf(null, 20)]);
  const all = [...b.items.values()];
  const inboxItems = inboxOf(b);
  return {
    stages: FOLLOWUP_STAGES.map((s) => {
      const own = b.vs.filter((v) => v.stage === s.key).sort((x, y) => (x.action ?? "").localeCompare(y.action ?? "") || x.version - y.version);
      const stats = versionStats(own, b.ex.filter((e) => e.stage === s.key), b.stepNow);
      return {
        key: s.key,
        title: s.title,
        goal: s.goal,
        versions: own.map((v, i) => ({ ...v, stats: stats[i] })),
        queue: all.filter((q) => q.stage === s.key).sort(byScore),
      };
    }),
    queue: executable(all),
    blocked: all.filter((q) => pending(q) && q.blocked).sort(byPriority),
    summary: summarize(all, b.newToday, inboxItems.length),
    inbox: inboxItems,
    funnel: funnelOf(b, all),
    rules: [...b.rules].sort((x, y) => x.position - y.position),
    changes,
    results: resultsOf(b, all),
  };
}

/** Las etapas como en el embudo: cuántas esperan en cada una y qué parte de las que llegaron pasó a la siguiente. */
function funnelOf(b: Awaited<ReturnType<typeof board>>, all: QueueItem[]): FunnelStep[] {
  const steps = [...b.stepNow.values()];
  const reach = (step: number) => steps.filter((x) => x >= step).length;
  return FOLLOWUP_STAGES.map((s) => {
    const here = reach(s.step);
    return { key: s.key, title: s.title, goal: s.goal, waiting: all.filter((q) => q.stage === s.key).length, reached: here, rate: here ? reach(s.step + 1) / here : null };
  });
}

const pending = (q: QueueItem) => q.action !== null && q.execution?.status !== "sent";
/** The ones that can be executed now, in priority order (taken ones included: the page shows who has them). */
const executable = (all: QueueItem[]) => all.filter((q) => pending(q) && !q.blocked).sort(byPriority);
function summarize(all: QueueItem[], newToday: number, inboxCount = 0): QueueSummary {
  const today = artDate(new Date());
  const live = new Date().toISOString();
  return {
    ready: all.filter((q) => pending(q) && !q.blocked && !(q.claim && q.claim.until > live)).length,
    replies: inboxCount + all.filter((q) => pending(q) && q.group === "respuestas" && !q.blocked).length,
    scheduled: all.filter((q) => pending(q) && q.dueAt).length,
    demos: all.filter((q) => pending(q) && q.group === "demos" && !q.snoozedUntil).length,
    blocked: all.filter((q) => pending(q) && q.blocked && !q.dueAt).length,
    claimed: all.filter((q) => pending(q) && !q.blocked && q.claim && q.claim.until > live).length,
    doneToday: all.filter((q) => q.execution?.status === "sent" && artDate(q.execution.at) === today).length,
    newToday,
    cap: DAILY_NEW_CAP,
  };
}

// ------------------------------------------------------------------ the agent's API

const strip = (q: QueueItem) => q;

/** GET /api/admin/followup/queue: what's left, in order, and the next one free for this session. */
export async function agentQueue(actorId: string, limit = 50) {
  const b = await board();
  const all = [...b.items.values()];
  const live = new Date().toISOString();
  const ready = executable(all);
  const free = ready.filter((q) => !q.claim || q.claim.until <= live || q.claim.actorId === actorId);
  return {
    summary: summarize(all, b.newToday, inboxOf(b).length),
    next: free[0] ? strip(free[0]) : null,
    queue: ready.slice(0, Math.max(1, Math.min(limit, 500))).map(strip),
    blocked: all.filter((q) => pending(q) && q.blocked).slice(0, 200).map((q) => ({ agencyId: q.agencyId, name: q.name, stage: q.stage, situation: q.situation, blocked: q.blocked })),
  };
}

/** The agency as Follow-up sees it now (the same computation as the page). */
async function itemOf(agencyId: string) {
  if (!isUuid(agencyId)) throw new HttpError(404, "No encontramos la inmobiliaria.");
  const b = await board();
  const it = b.items.get(agencyId);
  if (!it) throw new HttpError(409, "Ya no está en Follow-up (avanzó, se perdió o se sacó). Actualizá la lista.");
  return { it, b };
}

/**
 * POST …/claim: takes an agency for 10 minutes and returns its message ready.
 * Without `inmobiliaria`, the next one free in the queue: two sessions asking
 * at the same time get different ones (the lock is taken in the database).
 */
export async function claimNext(input: { agencyId?: unknown }, origin: string, actor: { id: string; name: string }) {
  if (typeof input.agencyId === "string" && input.agencyId) {
    const { it } = await itemOf(input.agencyId);
    if (it.execution?.status === "sent") throw new HttpError(409, `Ya se confirmó «${it.actionLabel}» con ${it.name}.`);
    if (it.blocked) throw new HttpError(409, it.blocked);
    await lock(it, actor);
    return prepare(it, origin, actor);
  }
  const { queue } = await agentQueue(actor.id, 500);
  for (const it of queue) {
    if (it.claim && it.claim.until > new Date().toISOString() && it.claim.actorId !== actor.id) continue;
    try {
      await lock(it, actor);
      return prepare(it, origin, actor);
    } catch (e) {
      if (e instanceof HttpError && e.status === 409) continue;
      throw e;
    }
  }
  return null;
}

async function lock(it: QueueItem, actor: { id: string; name: string }) {
  const { error } = await adminClient().rpc("habita_followup_claim", { p_actor: actor.id, p_actor_name: actor.name, p_agency: it.agencyId, p_stage: it.stage, p_action: it.action, p_seconds: 600 });
  if (!error) return;
  if (error.message?.includes("FOLLOWUP_LOCKED")) throw new HttpError(409, `${it.name} la está ejecutando ${it.claim?.by ?? "otra sesión"}.`);
  throw missing(error) ? new HttpError(409, MISSING) : new Error("FOLLOWUP_CLAIM_FAILED");
}
async function release(agencyId: string, actorId: string) {
  await adminClient().rpc("habita_followup_release", { p_actor: actorId, p_agency: agencyId });
}

/**
 * The message for this agency, with its links resolved (the same ones as
 * «Link demo» and «Link panel»), its WhatsApp and the version it gets. A text
 * with «---» lines is several messages, sent one after the other.
 */
async function prepare(it: QueueItem, origin: string, actor: { id: string; name: string }) {
  const vs = await versions();
  const v = vs.find((x) => x.id === it.versionId);
  if (!v) throw new HttpError(409, `Falta el texto de «${it.actionLabel}».`);
  const need = linksNeeded(v);
  const [demo, panel, account] = await Promise.all([
    need.demo ? agencyDemoLink(it.agencyId, actor.id, origin).then((l) => l.url).catch(() => null) : null,
    need.panel ? agencyPanelLink(it.agencyId, actor.id, origin).then((l) => l.url).catch(() => null) : null,
    prospectDataset()
      .then((ds) => accountsByAgency(ds).get(it.agencyId))
      .catch(() => undefined),
  ]);
  const message = fillMessage(v.body, { inmobiliaria: it.shortName, decisor: it.person, sdr: account?.sdr || actor.name, demo, panel });
  const holes = missingVariables(message);
  const warnings: string[] = [...it.checks];
  if (holes.includes("demo")) warnings.push("Todavía no tiene una demo publicada: publicala antes de mandar este mensaje.");
  if (holes.includes("panel")) warnings.push("No pudimos armar el link a su panel.");
  if (holes.some((h) => h !== "demo" && h !== "panel")) warnings.push(`Variable sin completar: ${holes.map((h) => `{{${h}}}`).join(", ")}.`);
  if (v.channel === "whatsapp" && !it.wa) warnings.push("Falta su WhatsApp: cargalo en la ficha de la inmobiliaria.");
  const ready = !holes.length && (v.channel === "task" || Boolean(it.wa));
  const messages = splitMessages(message);
  const history = await historyOf(it.agencyId, account?.id ?? null, vs);
  const hours = v.channel === "whatsapp" ? (it.window ? outsideWindow(it.window) : outsideHours(it.group)) : null;
  const linkOk = (!need.demo || Boolean(demo)) && (!need.panel || Boolean(panel));
  // Lo que el agente revisa antes de mandar. «Número validado» queda pendiente con un número sin validar: se valida al confirmar.
  const checklist = [
    { key: "numero", label: "Número validado", ok: v.channel === "task" || (Boolean(it.wa) && !it.needsReview), note: v.channel === "task" ? "Tarea del equipo" : !it.wa ? "Falta su WhatsApp" : it.needsReview ? "Confirmá en el chat que es la inmobiliaria: queda validado al confirmar el envío" : "" },
    { key: "rechazo", label: "Sin rechazo ni baja", ok: !CLOSED_SITUATIONS.includes(it.situation), note: "" },
    { key: "reciente", label: "Sin mensaje equivalente reciente", ok: !it.blocked, note: it.blocked ?? (it.execution?.status === "opened" ? "Se abrió WhatsApp antes sin confirmar: revisá el chat" : "") },
    { key: "horario", label: "Horario permitido", ok: !hours, note: hours ?? (it.group === "nuevos" ? "Lunes a sábado, de 9 a 18" : "Lunes a sábado, de 9 a 19") },
    { key: "variables", label: "Variables completas", ok: !holes.length, note: holes.length ? holes.map((h) => `{{${h}}}`).join(", ") : `{{inmobiliaria}} = «${it.shortName}»` },
    { key: "enlaces", label: "Enlaces listos", ok: linkOk, note: need.demo || need.panel ? (linkOk ? "Demo y panel armados" : "No se pudo armar un enlace") : "Este mensaje no lleva enlaces" },
    { key: "mensaje", label: "Mensaje listo", ok: ready, note: `${messages.length} ${messages.length === 1 ? "mensaje" : "mensajes"} · V${v.version}` },
  ];
  // A demo to make: what the panel can check by itself, and the promise (30 minutes at most).
  if (it.stage === "sin-demo" || it.stage === "sin-enviar") {
    const late = it.promisedAt ? Math.round((Date.now() - Date.parse(it.promisedAt)) / 60000) : null;
    if (late !== null) checklist.unshift({ key: "promesa", label: "Demo prometida a tiempo", ok: late <= 30, note: `Mostró interés hace ${late} min · máximo 30` });
    if (it.stage === "sin-demo")
      checklist.push(
        { key: "propiedad", label: "Propiedad elegida e importada", ok: it.properties > 0, note: it.properties ? `${it.properties} en su panel` : "Buscá una en su web e importala" },
        { key: "publicada", label: "Demo generada, revisada y publicada", ok: it.hasDemo, note: it.hasDemo ? "Publicada" : "Al publicarla pasa sola a «Demo creada, sin enviar»" },
      );
  }
  return {
    agencyId: it.agencyId,
    name: it.name,
    stage: it.stage,
    action: it.action,
    actionLabel: it.actionLabel,
    situation: it.situation,
    versionId: v.id,
    version: v.version,
    channel: v.channel,
    ctas: v.ctas,
    notes: v.notes,
    person: it.person,
    phone: it.phone,
    message,
    messages,
    ready,
    warnings,
    // web.whatsapp.com reuses the same tab (the page opens it in a named window); the first message goes prefilled.
    whatsappUrl: v.channel === "whatsapp" && it.wa && ready ? `https://web.whatsapp.com/send?phone=${it.wa}&text=${encodeURIComponent(messages[0] ?? message)}` : null,
    links: { demo, panel, createDemo: `/admin/inmobiliarias/${it.agencyId}/propiedades/nueva` },
    execution: it.execution,
    lockedUntil: new Date(Date.now() + 600_000).toISOString(),
    checklist,
    history,
    context: {
      score: it.score,
      priority: it.priority,
      priorityManual: it.priorityManual,
      zone: it.zone,
      address: it.address,
      website: it.website,
      properties: it.properties,
      hasDemo: it.hasDemo,
      hasAccount: it.hasAccount,
      shortName: it.shortName,
      situationNote: it.situationNote,
      stageTitle: stageInfo(it.stage).title,
      situationLabel: SITUATIONS[it.situation],
    },
  };
}

/** Las últimas acciones con la inmobiliaria, de Follow-up, de Adquisición (envíos y respuestas, con su texto) y de ella misma. */
async function historyOf(agencyId: string, accountId: string | null, vs: FollowupVersion[]) {
  const db = adminClient();
  const [ex, sends, events, changes] = await Promise.all([
    db.from("followup_executions").select("stage,action,version_id,status,reason,updated_at,sent_at").eq("agency_id", agencyId).order("updated_at", { ascending: false }).limit(10),
    accountId ? db.from("outreach_attempts").select("step,status,sent_at,body").eq("account_id", accountId).eq("status", "sent").order("sent_at", { ascending: false }).limit(10) : Promise.resolve({ data: [] }),
    accountId
      ? db.from("prospect_events").select("type,occurred_at,evidence,details,source").eq("account_id", accountId).in("type", ["reply", "interest", "not_interested", "lost", "imported", "suppressed"]).order("occurred_at", { ascending: false }).limit(10)
      : Promise.resolve({ data: [] }),
    auditOf(agencyId, 10),
  ]);
  const out: { at: string; text: string; kind: "nuestro" | "suyo" | "dato" }[] = [];
  const SUBJECT: Record<string, string> = { stage: "Etapa corregida", situation: "Situación", score: "Score", priority: "Prioridad", snooze: "Reprogramada", short_name: "Nombre en el mensaje" };
  for (const c of changes) {
    const value = c.subject === "situation" && c.new_value ? (SITUATIONS[c.new_value.split(" · ")[0] as Situation] ?? c.new_value) + (c.new_value.includes(" · ") ? ` ${c.new_value.slice(c.new_value.indexOf(" · "))}` : "") : c.subject === "stage" && c.new_value && isStageKey(c.new_value) ? stageInfo(c.new_value).title : c.subject === "snooze" && c.new_value && /^\d{4}-/.test(c.new_value) ? `hasta el ${whenText(c.new_value.slice(0, 24))}${c.new_value.includes(" · ") ? ` (${c.new_value.split(" · ")[1]})` : ""}` : c.new_value;
    out.push({ at: c.created_at, text: `${SUBJECT[c.subject] ?? c.subject}: ${value ?? "—"}${c.actor_name ? ` · ${c.actor_name}` : ""}`, kind: "dato" });
  }
  for (const e of (ex.data ?? []) as { stage: string; action: string; version_id: string; status: string; reason: string | null; updated_at: string; sent_at: string | null }[]) {
    if (e.status === "opened") continue;
    const v = vs.find((x) => x.id === e.version_id);
    const what = `${isStageKey(e.stage) ? actionLabel(e.stage, (e.action ?? "principal") as Action) : "Follow-up"}${v ? ` V${v.version}` : ""}`;
    out.push(e.status === "sent" ? { at: e.sent_at ?? e.updated_at, text: `${what} enviado desde Follow-up`, kind: "nuestro" } : { at: e.updated_at, text: `${what} no salió${e.reason ? `: ${e.reason}` : ""}`, kind: "nuestro" });
  }
  for (const t of (sends.data ?? []) as { step: number; sent_at: string | null; body: string | null }[])
    if (t.sent_at && !(t.body ?? "").includes("desde Follow-up") && !out.some((o) => o.kind === "nuestro" && Math.abs(Date.parse(o.at) - Date.parse(t.sent_at!)) < 120_000))
      out.push({ at: t.sent_at, text: t.step >= 1 ? `Mensaje ${t.step} de la secuencia (Adquisición)` : "Mensaje enviado (Adquisición)", kind: "nuestro" });
  const label: Record<string, string> = { reply: "Respondió", interest: "Mostró interés", not_interested: "No le interesa", lost: "Se dio por perdida", imported: "Importada de la hoja", suppressed: "Pidió no ser contactada" };
  for (const e of (events.data ?? []) as { type: string; occurred_at: string; evidence: string | null }[]) {
    const quote = e.evidence?.replace(/^WhatsApp: /, "").trim();
    out.push({ at: e.occurred_at, text: `${label[e.type] ?? e.type}${quote && e.type !== "imported" && !quote.startsWith("Follow-up:") ? `: ${quote}` : ""}`, kind: e.type === "imported" ? "dato" : "suyo" });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10);
}

/** «Omitir o reprogramar»: sale de la cola hasta esa fecha (sin fecha: mañana a las 9), con el motivo. La suelta. */
export async function snooze(agencyId: string, rawUntil: unknown, rawReason: unknown, actor: { id: string; name: string }) {
  if (!isUuid(agencyId)) throw new HttpError(404, "No encontramos la inmobiliaria.");
  const reason = typeof rawReason === "string" ? rawReason.trim().slice(0, 300) : "";
  let until: Date;
  if (rawUntil === null || rawUntil === undefined || rawUntil === "") {
    // Mañana a las 9 de Argentina (12 UTC).
    until = new Date(Date.now() + DAY_MS);
    until.setUTCHours(12, 0, 0, 0);
  } else until = new Date(String(rawUntil));
  if (Number.isNaN(until.getTime())) throw new HttpError(400, "Fecha inválida.");
  if (until.getTime() < Date.now()) throw new HttpError(400, "La fecha ya pasó.");
  if (until.getTime() > Date.now() + 90 * DAY_MS) throw new HttpError(400, "Se reprograma hasta 90 días.");
  await saveExtra(agencyId, { snooze_until: until.toISOString(), snooze_reason: reason || null }, actor.id);
  await release(agencyId, actor.id).catch(() => undefined);
  await audit("snooze", actor, { agencyId, to: `${until.toISOString()}${reason ? ` · ${reason}` : ""}` });
  return { snoozedUntil: until.toISOString(), reason: reason || null };
}

/** Saca la reprogramación: vuelve a la cola. */
export async function unsnooze(agencyId: string, actorId: string, actorName = "") {
  if (!isUuid(agencyId)) throw new HttpError(404, "No encontramos la inmobiliaria.");
  await saveExtra(agencyId, { snooze_until: null, snooze_reason: null }, actorId);
  await audit("snooze", { id: actorId, name: actorName }, { agencyId, to: "vuelve a la cola" });
  return { snoozedUntil: null };
}

/** Prioridad a mano (Alta, Media, Baja); null vuelve a la del grupo. */
export async function setPriority(agencyId: string, raw: unknown, actorId: string, actorName = "") {
  if (!isUuid(agencyId)) throw new HttpError(404, "No encontramos la inmobiliaria.");
  if (raw !== null && raw !== "" && !isPriority(raw)) throw new HttpError(400, "La prioridad es alta, media o baja.");
  await saveExtra(agencyId, { priority: isPriority(raw) ? raw : null }, actorId);
  await audit("priority", { id: actorId, name: actorName }, { agencyId, to: isPriority(raw) ? raw : "automática" });
  return { priority: isPriority(raw) ? raw : null };
}
export type Prepared = Awaited<ReturnType<typeof prepare>>;

/** Same agency, same action, same version: or the queue moved under the agent's feet. */
async function sameTask(input: { agencyId: unknown; stage?: unknown; action?: unknown; versionId?: unknown }, actorId: string) {
  if (typeof input.agencyId !== "string") throw new HttpError(400, "Falta la inmobiliaria.");
  const { it, b } = await itemOf(input.agencyId);
  if (input.stage !== undefined && input.stage !== it.stage) throw new HttpError(409, `Ya no está en «${isStageKey(input.stage) ? stageInfo(input.stage).title : input.stage}»: ahora está en «${stageInfo(it.stage).title}». Actualizá la lista.`);
  if (input.action !== undefined && input.action !== (it.action ?? null)) throw new HttpError(409, `La próxima acción cambió: ahora es «${it.actionLabel ?? "ninguna"}». Actualizá la lista.`);
  const v = b.vs.find((x) => x.id === input.versionId);
  if (!v || v.stage !== it.stage || (v.action ?? "principal") !== it.action) throw new HttpError(409, "Esa versión ya no corresponde a esta acción. Actualizá la lista.");
  if (it.claim && it.claim.until > new Date().toISOString() && it.claim.actorId !== actorId) throw new HttpError(409, `${it.name} la está ejecutando ${it.claim.by}.`);
  return { it, v };
}

async function mark(it: QueueItem, v: FollowupVersion, status: ExecutionStatus, actorId: string, reason?: string | null, body?: string | null) {
  const { data, error } = await adminClient().rpc("habita_followup_mark", {
    p_actor: actorId,
    p_version: v.id,
    p_agency: it.agencyId,
    p_from_step: it.step,
    p_status: status,
    p_reason: reason || null,
    p_body: body || null,
  });
  if (error) throw missing(error) ? new HttpError(409, MISSING) : new Error("FOLLOWUP_MARK_FAILED");
  return data as FollowupExecution;
}

/** «Abrir WhatsApp»: queda como abierto (no cuenta como enviado). */
export async function openExecution(input: { agencyId: unknown; stage?: unknown; action?: unknown; versionId?: unknown }, actor: { id: string; name: string }) {
  const { it, v } = await sameTask(input, actor.id);
  await lock(it, actor);
  const e = await mark(it, v, "opened", actor.id);
  return { execution: { status: e.status, at: e.updated_at } };
}

/**
 * POST …/confirm: the message went out (the agent saw it in the chat). Counts
 * as an execution, validates the number (it reached a WhatsApp), records the
 * send in Adquisición (first two stages), marks the demo as sent («Demo
 * creada, sin enviar»), frees the agency and returns it as it is now.
 * Idempotent: confirming twice changes nothing.
 */
export async function confirmExecution(input: { agencyId: unknown; stage?: unknown; action?: unknown; versionId?: unknown; text?: unknown }, actor: { id: string; name: string }) {
  if (typeof input.agencyId === "string") {
    const before = await itemOf(input.agencyId).catch(() => null);
    if (before?.it.execution?.status === "sent" && before.it.versionId === input.versionId)
      return { execution: { status: "sent" as const, at: before.it.execution.at }, warning: null, item: strip(before.it), replayed: true };
  }
  const { it, v } = await sameTask(input, actor.id);
  const text = typeof input.text === "string" ? input.text.trim().slice(0, 8000) : "";
  const e = await mark(it, v, "sent", actor.id, null, text || null);
  const warnings: string[] = [];
  const early = it.stage === "no-contactado" || it.stage === "no-responde";
  if (v.channel === "whatsapp" && early) {
    try {
      const ds = await prospectDataset();
      let account = accountsByAgency(ds).get(it.agencyId);
      const contact = account ? contactFor(account, "whatsapp") : null;
      if (account && contact?.needs_review) {
        await prospectRpc("habita_prospect_contact", { p_actor: actor.id, p_account: account.id, p_contact: contact.id, p_fields: { verified: true } });
        const fresh = await prospectDataset();
        account = accountsByAgency(fresh).get(it.agencyId);
        if (account) await recordSend(actor.id, fresh, account, { channel: "whatsapp", text: text || v.body }, actor.name, "Follow-up");
      } else if (account) await recordSend(actor.id, ds, account, { channel: "whatsapp", text: text || v.body }, actor.name, "Follow-up");
    } catch (err) {
      warnings.push(`La ejecución quedó registrada, pero no el envío en Adquisición: ${err instanceof HttpError ? err.message : "probá registrarlo desde su ficha."}`);
    }
  }
  if (it.stage === "sin-enviar") await setDemosSent(it.agencyId, true, actor.id, "followup").catch(() => warnings.push("No pudimos marcar su demo como enviada."));
  await release(it.agencyId, actor.id).catch(() => undefined);
  const after = await itemOf(it.agencyId).catch(() => null);
  return { execution: { status: e.status, at: e.updated_at }, warning: warnings.join(" ") || null, item: after ? strip(after.it) : null, replayed: false };
}

/**
 * POST …/fail: it did not go out (with the reason). `kind` «sin_whatsapp» or
 * «numero_incorrecto» also marks the number invalid in Adquisición and the
 * situation, so it leaves the queue. Frees the agency.
 */
export async function failExecution(
  input: { agencyId: unknown; stage?: unknown; action?: unknown; versionId?: unknown; reason?: unknown; kind?: unknown },
  actor: { id: string; name: string },
) {
  const { it, v } = await sameTask(input, actor.id);
  const kind = input.kind === "sin_whatsapp" || input.kind === "numero_incorrecto" ? input.kind : null;
  const reason = (typeof input.reason === "string" ? input.reason.trim().slice(0, 300) : "") || (kind ? SITUATIONS[kind] : "");
  if (!reason) throw new HttpError(400, "Contá por qué no salió.");
  const e = await mark(it, v, "failed", actor.id, reason);
  let warning: string | null = null;
  if (kind) warning = (await setSituation(it.agencyId, kind, reason, actor)).warning;
  await release(it.agencyId, actor.id).catch(() => undefined);
  return { execution: { status: e.status, at: e.updated_at, reason }, warning };
}

/** «Cerrar» sin hacer nada: la inmobiliaria vuelve a quedar libre. */
export async function releaseClaim(agencyId: unknown, actorId: string) {
  if (typeof agencyId !== "string" || !isUuid(agencyId)) throw new HttpError(400, "Falta la inmobiliaria.");
  await release(agencyId, actorId);
  return { released: true };
}

/** Lo que cada situación registra en Adquisición, para que el embudo y la hoja digan lo mismo. */
const SITUATION_FACT: Partial<Record<Situation, "reply" | "interest" | "lost">> = {
  confirmo_numero: "reply",
  neutro: "reply",
  pregunta_precios: "reply",
  mas_adelante: "reply",
  derivo: "reply",
  interesado: "interest",
  rechazo: "lost",
  proveedor_ia: "lost",
};

/**
 * POST …/situation: what happened in the conversation, with the original
 * text. It holds while the funnel stays in the same step. It is also recorded
 * in Adquisición where it means something there (a reply, interest, a loss, a
 * do-not-contact, an invalid number), best effort: the answer says what could
 * not be recorded.
 */
export async function setSituation(agencyId: string, raw: unknown, note: unknown, actor: { id: string; name: string }) {
  if (!isSituation(raw)) throw new HttpError(400, "Situación desconocida.");
  const situation = raw;
  const text = typeof note === "string" ? note.trim().slice(0, 2000) : "";
  const { at, account } = await now(agencyId);
  await saveExtra(agencyId, { situation, situation_step: stepValue(at.derived.reached), situation_note: text || null, situation_at: new Date().toISOString() }, actor.id);
  await audit("situation", actor, { agencyId, to: `${situation}${text ? ` · «${text.slice(0, 200)}»` : ""}` });
  let warning: string | null = null;
  if (account) {
    try {
      const evidence = text ? `WhatsApp: «${text}»` : `Follow-up: ${SITUATIONS[situation]}`;
      const fact = SITUATION_FACT[situation];
      const key = stableUuid(`followup-situation:${agencyId}:${situation}:${text}`);
      if (fact === "reply")
        await prospectRpc("habita_prospect_record", { p_actor: actor.id, p_key: key, p_account: account.id, p_type: "reply", p_occurred_at: new Date().toISOString(), p_precision: "time", p_channel: "whatsapp", p_contact: null, p_attempt: null, p_evidence: evidence, p_details: { situation, proposal: situation === "neutro" }, p_corrects: null });
      if (fact === "interest")
        await prospectRpc("habita_prospect_record", { p_actor: actor.id, p_key: key, p_account: account.id, p_type: "interest", p_occurred_at: new Date().toISOString(), p_precision: "time", p_channel: "whatsapp", p_contact: null, p_attempt: null, p_evidence: evidence, p_details: { situation }, p_corrects: null });
      if (fact === "lost")
        await prospectRpc("habita_prospect_record", { p_actor: actor.id, p_key: key, p_account: account.id, p_type: "lost", p_occurred_at: new Date().toISOString(), p_precision: "time", p_channel: "whatsapp", p_contact: null, p_attempt: null, p_evidence: evidence, p_details: { situation, reason: situation === "proveedor_ia" ? "Cuenta con proveedor de IA" : "No interesado" }, p_corrects: null });
      if (situation === "no_contactar" && !account.suppressed)
        await prospectRpc("habita_prospect_suppress", { p_actor: actor.id, p_account: account.id, p_scope: "account", p_channel: null, p_contact: null, p_reason: text || "Pidió no ser contactada (Follow-up)" });
      if (situation === "sin_whatsapp" || situation === "numero_incorrecto") {
        const contact = contactFor(account, "whatsapp") ?? account.contacts.find((c) => c.channel === "whatsapp" && !c.invalid);
        if (contact) await prospectRpc("habita_prospect_contact", { p_actor: actor.id, p_account: account.id, p_contact: contact.id, p_fields: { invalid: true, invalid_reason: SITUATIONS[situation] } });
      }
    } catch (e) {
      warning = `La situación quedó guardada, pero no se pudo registrar en Adquisición: ${e instanceof HttpError ? e.message : "probá desde su ficha."}`;
    }
  }
  // A closed conversation frees whoever had it: nothing else goes out.
  if (CLOSED_SITUATIONS.includes(situation)) await adminClient().from("followup_claims").delete().eq("agency_id", agencyId);
  const after = await itemOf(agencyId).catch(() => null);
  return { situation, warning, item: after ? strip(after.it) : null };
}

// ------------------------------------------------------------------ respuestas (Fase 2)

type ReplyRow = {
  id: string;
  agency_id: string;
  body: string;
  received_at: string;
  classification: ReplyClass | null;
  confidence: number | null;
  status: "pendiente" | "facu" | "procesada";
  note: string | null;
};
const REPLY_FIELDS = "id,agency_id,body,received_at,classification,confidence,status,note";

/** Las respuestas sin resolver, por inmobiliaria. */
async function openReplies() {
  const { data, error } = await adminClient().from("followup_replies").select(REPLY_FIELDS).neq("status", "procesada").order("received_at").limit(2000);
  if (error) throw missing(error) ? new HttpError(409, MISSING) : new Error("FOLLOWUP_READ_FAILED");
  const out = new Map<string, ReplyRow[]>();
  for (const r of (data ?? []) as ReplyRow[]) out.set(r.agency_id, [...(out.get(r.agency_id) ?? []), { ...r, confidence: r.confidence === null ? null : Number(r.confidence) }]);
  return out;
}

export type InboxItem = ReplyRow & { name: string; stage: StageKey | null; situation: Situation | null; phone: string | null };

/** La bandeja: las respuestas sin resolver, la más vieja primero, con su inmobiliaria. */
function inboxOf(b: Awaited<ReturnType<typeof board>>): InboxItem[] {
  return [...b.open.values()]
    .flat()
    .map((r) => {
      const it = b.items.get(r.agency_id);
      return { ...r, name: b.names.get(r.agency_id) ?? "Inmobiliaria", stage: it?.stage ?? null, situation: it?.situation ?? null, phone: it?.phone ?? null };
    })
    .sort((a, c) => a.received_at.localeCompare(c.received_at));
}
export async function inbox() {
  return inboxOf(await board());
}

/**
 * POST …/reply: la extensión (o el equipo) registra una respuesta de WhatsApp
 * con su texto original y la hora. Con clasificación y confianza suficiente se
 * aplica sola (la situación, lo que registra en Adquisición y la próxima
 * acción); con confianza baja, un audio o una pregunta que el script no cubre
 * va a Facu y no se manda nada; sin clasificación queda en la bandeja.
 * Idempotente: la misma respuesta (inmobiliaria, hora, texto) no se duplica.
 */
export async function registerReply(
  input: { agencyId: unknown; text: unknown; receivedAt?: unknown; classification?: unknown; confidence?: unknown; note?: unknown; until?: unknown; contactName?: unknown; contactWhatsapp?: unknown },
  actor: { id: string; name: string },
) {
  if (typeof input.agencyId !== "string" || !isUuid(input.agencyId)) throw new HttpError(400, "Falta la inmobiliaria.");
  const text = typeof input.text === "string" ? input.text.trim().slice(0, 4000) : "";
  if (!text) throw new HttpError(400, "Falta el texto de la respuesta (en un audio: «Audio»).");
  const at = input.receivedAt ? new Date(String(input.receivedAt)) : new Date();
  if (Number.isNaN(at.getTime()) || at.getTime() > Date.now() + 120_000) throw new HttpError(400, "Hora inválida.");
  const classification = input.classification === undefined || input.classification === null || input.classification === "" ? null : isReplyClass(input.classification) ? input.classification : undefined;
  if (classification === undefined) throw new HttpError(400, "Clasificación desconocida.");
  const confidence = input.confidence === undefined || input.confidence === null || input.confidence === "" ? null : Number(input.confidence);
  if (confidence !== null && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) throw new HttpError(400, "La confianza va de 0 a 1.");
  const route = replyRoute(classification, confidence);
  const key = `${input.agencyId}:${at.toISOString().slice(0, 16)}:${text.slice(0, 80)}`;
  const db = adminClient();
  const found = await db.from("followup_replies").select(REPLY_FIELDS).eq("client_key", key).maybeSingle();
  if (found.error) throw missing(found.error) ? new HttpError(409, MISSING) : new Error("FOLLOWUP_READ_FAILED");
  if (found.data) return { reply: found.data as ReplyRow, route: (found.data as ReplyRow).status, replayed: true, warning: null };
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 500) : "";
  const made = await db
    .from("followup_replies")
    .insert({
      agency_id: input.agencyId,
      body: text,
      received_at: at.toISOString(),
      classification,
      confidence,
      status: route === "facu" ? "facu" : "pendiente",
      note: note || (route === "facu" ? (classification && FACU_CLASSES.includes(classification) ? REPLY_CLASSES[classification] : "Confianza baja") : null),
      client_key: key,
      recorded_by: actor.id,
    })
    .select(REPLY_FIELDS)
    .single();
  if (made.error) throw missing(made.error) ? new HttpError(409, MISSING) : new Error("FOLLOWUP_SAVE_FAILED");
  const reply = made.data as ReplyRow;
  // Whoever had it stops: a reply changes what comes next.
  await db.from("followup_claims").delete().eq("agency_id", input.agencyId);
  if (route !== "aplicar") return { reply, route: reply.status, replayed: false, warning: null };
  const done = await processReply(reply.id, { classification, until: input.until, contactName: input.contactName, contactWhatsapp: input.contactWhatsapp }, actor);
  return { reply: { ...reply, status: "procesada" as const }, route: "procesada", replayed: false, warning: done.warning };
}

/**
 * Resuelve una respuesta de la bandeja: aplica su clasificación como situación
 * (con el texto como evidencia) y la marca procesada. «Pide más adelante» con
 * fecha la reprograma; «Derivó» con un contacto nuevo lo suma a la misma
 * inmobiliaria (sin duplicarla). Audio y pregunta no cubierta quedan en Facu.
 */
export async function processReply(
  id: unknown,
  input: { classification?: unknown; until?: unknown; contactName?: unknown; contactWhatsapp?: unknown; facu?: unknown; note?: unknown },
  actor: { id: string; name: string },
) {
  if (!isUuid(id)) throw new HttpError(404, "No encontramos esa respuesta.");
  const db = adminClient();
  const found = await db.from("followup_replies").select(REPLY_FIELDS).eq("id", id).maybeSingle();
  if (found.error) throw missing(found.error) ? new HttpError(409, MISSING) : new Error("FOLLOWUP_READ_FAILED");
  const reply = found.data as ReplyRow | null;
  if (!reply) throw new HttpError(404, "No encontramos esa respuesta.");
  if (reply.status === "procesada") return { reply, warning: null, replayed: true };
  if (input.facu === true) {
    const note = typeof input.note === "string" ? input.note.trim().slice(0, 500) : "";
    await db.from("followup_replies").update({ status: "facu", note: note || reply.note || "Asignada a Facu" }).eq("id", reply.id);
    return { reply: { ...reply, status: "facu" as const }, warning: null, replayed: false };
  }
  const c = isReplyClass(input.classification) ? input.classification : reply.classification;
  if (!c) throw new HttpError(400, "Elegí la clasificación.");
  if (FACU_CLASSES.includes(c)) {
    await db.from("followup_replies").update({ status: "facu", classification: c, note: REPLY_CLASSES[c] }).eq("id", reply.id);
    return { reply: { ...reply, status: "facu" as const, classification: c }, warning: null, replayed: false };
  }
  const warnings: string[] = [];
  // Derivó: the new contact joins the same agency's prospecting account.
  if (c === "derivo" && typeof input.contactWhatsapp === "string" && input.contactWhatsapp.trim()) {
    const wa = normalizeArNumber(input.contactWhatsapp.trim());
    if (!wa) throw new HttpError(400, "Revisá el WhatsApp del contacto nuevo: un celular de Argentina, con el código de área.");
    const account = accountsByAgency(await prospectDataset()).get(reply.agency_id);
    if (!account) warnings.push("No tiene cuenta de prospección: cargá el contacto nuevo en su ficha.");
    else
      await prospectRpc("habita_prospect_contact", {
        p_actor: actor.id,
        p_account: account.id,
        p_contact: null,
        p_fields: { channel: "whatsapp", address: `+${wa}`, person_name: typeof input.contactName === "string" ? input.contactName.trim().slice(0, 120) : null, is_primary: true, is_decision_maker: true, source: "Derivación (Follow-up)" },
      }).catch((e) => warnings.push(`No pudimos sumar el contacto nuevo: ${e instanceof HttpError ? e.message : "probá desde su ficha."}`));
  }
  const situation = c as Situation;
  const applied = await setSituation(reply.agency_id, situation, reply.body, actor);
  if (applied.warning) warnings.push(applied.warning);
  if (c === "mas_adelante" && input.until) await snooze(reply.agency_id, input.until, `Pidió hablar más adelante: «${reply.body.slice(0, 120)}»`, actor);
  await db.from("followup_replies").update({ status: "procesada", classification: c, processed_by: actor.id, processed_at: new Date().toISOString() }).eq("id", reply.id);
  return { reply: { ...reply, status: "procesada" as const, classification: c }, warning: warnings.join(" ") || null, replayed: false };
}

// ------------------------------------------------------------------ reglas (Fase 3)

/** Las reglas, por etapa y orden, para «Mensajes y reglas». */
export async function listRules() {
  return (await readRules()).sort((a, b) => a.stage.localeCompare(b.stage) || a.position - b.position);
}

/**
 * Guarda una regla (o crea una con `key` vacía). Cambia la cola sin deploy:
 * la próxima lectura ya la usa. Queda en la auditoría.
 */
export async function saveRule(key: unknown, input: Record<string, unknown>, actor: { id: string; name: string }) {
  const clean = cleanRule(input, Object.keys(SITUATIONS).filter((x) => !CLOSED_SITUATIONS.includes(x as Situation)), ["principal", "seguimiento_2", "presentacion", "presentacion_seguimiento", "precios"], FOLLOWUP_STAGES.map((x) => x.key));
  if ("error" in clean) throw new HttpError(400, clean.error);
  const db = adminClient();
  const id = typeof key === "string" && key ? key : `${clean.stage}:${clean.action}:${Date.now().toString(36)}`;
  if (id.length > 80) throw new HttpError(400, "Regla desconocida.");
  const before = typeof key === "string" && key ? (await db.from("followup_rules").select("*").eq("key", key).maybeSingle()).data : null;
  if (typeof key === "string" && key && !before) throw new HttpError(404, "No encontramos esa regla.");
  const { data, error } = await db
    .from("followup_rules")
    .upsert({ key: id, ...clean, updated_by: actor.id, updated_at: new Date().toISOString() }, { onConflict: "key" })
    .select("key,stage,situations,action,after_hours,after_action,position,enabled,hours_from,hours_to,days")
    .single();
  if (error) throw missing(error) ? new HttpError(409, MISSING) : error.code === "23514" ? new HttpError(400, "La base rechazó la regla: revisá los valores.") : new Error("FOLLOWUP_SAVE_FAILED");
  await audit("rule", actor, { ref: id, from: before, to: clean });
  return { ...(data as Rule), after_hours: Number((data as Rule).after_hours) };
}

/** Los cambios a mano de una inmobiliaria (o de las reglas y versiones, sin `agencyId`), del más nuevo al más viejo. */
export async function auditOf(agencyId: string | null, limit = 20) {
  let q = adminClient().from("followup_audit").select("subject,ref,old_value,new_value,actor_name,created_at").order("created_at", { ascending: false }).limit(limit);
  q = agencyId ? q.eq("agency_id", agencyId) : q.is("agency_id", null);
  const { data, error } = await q;
  if (error) return [];
  return (data ?? []) as { subject: string; ref: string | null; old_value: string | null; new_value: string | null; actor_name: string; created_at: string }[];
}

/** El nombre corto para {{inmobiliaria}}. Vacío: vuelve al de la ficha sin paréntesis. */
export async function setShortName(agencyId: string, raw: unknown, actorId: string, actorName = "") {
  if (!isUuid(agencyId)) throw new HttpError(404, "No encontramos la inmobiliaria.");
  const name = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (name.length > 80) throw new HttpError(400, "El nombre corto va hasta 80 caracteres.");
  await saveExtra(agencyId, { short_name: name || null }, actorId);
  await audit("short_name", { id: actorId, name: actorName }, { agencyId, to: name || "el de la ficha" });
  return { shortName: name || null };
}


const RPC_ERRORS: Record<string, [number, string]> = {
  FOLLOWUP_ACTIVE_REQUIRED: [409, "La versión activa no se archiva sola: activá otra primero."],
  FOLLOWUP_VERSION_NOT_FOUND: [404, "No encontramos esa versión."],
  FOLLOWUP_VERSION_FROZEN: [409, "Una versión no cambia de etapa ni de número, y no se borra."],
};
function rpcFailure(error: { code?: string; message?: string }) {
  if (missing(error)) return new HttpError(409, MISSING);
  const known = Object.keys(RPC_ERRORS).find((k) => error.message?.includes(k));
  return known ? new HttpError(...RPC_ERRORS[known]) : new Error("FOLLOWUP_SAVE_FAILED");
}

/** «Guardar»: a new version of the stage, active (the previous active one is archived) or on test. */
export async function createVersion(input: Record<string, unknown>, actorId: string) {
  const v = cleanVersion(input);
  if ("error" in v) throw new HttpError(400, v.error!);
  const { data, error } = await adminClient().rpc("habita_followup_create", {
    p_actor: actorId,
    p_stage: v.stage,
    p_channel: v.channel,
    p_trigger: v.trigger,
    p_body: v.body,
    p_ctas: v.ctas,
    p_status: v.status,
    p_action: v.action,
  });
  if (error) throw rpcFailure(error);
  const made = data as FollowupVersion;
  if (!v.notes) return made;
  const saved = await adminClient().from("followup_versions").update({ notes: v.notes }).eq("id", made.id).select(VERSION_FIELDS).single();
  if (saved.error) throw rpcFailure(saved.error);
  return saved.data as unknown as FollowupVersion;
}

/**
 * «Editar»: changes a saved version's text, trigger, channel, CTAs or
 * observations. It keeps its number and its numbers; `edited_at` records that
 * the text changed (the observations alone don't count). To compare two texts,
 * a new version.
 */
export async function updateVersion(id: unknown, input: Record<string, unknown>, actor: { id: string; name?: string } = { id: "" }) {
  if (!isUuid(id)) throw new HttpError(404, "No encontramos esa versión.");
  const db = adminClient();
  const found = await db.from("followup_versions").select(VERSION_FIELDS).eq("id", id).maybeSingle();
  if (found.error) throw rpcFailure(found.error);
  const old = found.data as unknown as FollowupVersion | null;
  if (!old) throw new HttpError(404, "No encontramos esa versión.");
  const v = cleanVersion({ ...input, stage: old.stage });
  if ("error" in v) throw new HttpError(400, v.error!);
  const changed = v.body !== old.body || v.channel !== old.channel || v.trigger !== old.trigger_label || v.ctas.join() !== old.ctas.join();
  const saved = await db
    .from("followup_versions")
    .update({ body: v.body, channel: v.channel, trigger_label: v.trigger, ctas: v.ctas, notes: v.notes, ...(changed ? { edited_at: new Date().toISOString() } : {}) })
    .eq("id", id)
    .select(VERSION_FIELDS)
    .single();
  if (saved.error) throw rpcFailure(saved.error);
  if (actor.id) await audit("version", actor, { ref: `${old.stage}:${old.action ?? "principal"}:V${old.version}`, from: old.body, to: v.body });
  return saved.data as unknown as FollowupVersion;
}

/** «Hacerla la activa», «Detener prueba», «Probar 50/50». */
export async function setVersionStatus(id: unknown, status: unknown) {
  if (!isUuid(id)) throw new HttpError(404, "No encontramos esa versión.");
  if (status !== "active" && status !== "test" && status !== "archived") throw new HttpError(400, "Estado desconocido.");
  const { data, error } = await adminClient().rpc("habita_followup_set_status", { p_version: id, p_status: status });
  if (error) throw rpcFailure(error);
  return data as FollowupVersion;
}

/** The agency as it is now in Follow-up, for the corrections below. */
async function now(agencyId: string) {
  if (!isUuid(agencyId)) throw new HttpError(404, "No encontramos la inmobiliaria.");
  const [row, ds, extra] = await Promise.all([commercialRow(agencyId), prospectDataset().catch(() => null), extras(agencyId)]);
  if (!row) throw new HttpError(404, "No encontramos la inmobiliaria.");
  const account = accountsByAgency(ds).get(agencyId);
  return { row, account, extra: extra.get(agencyId), at: place(row, account, extra.get(agencyId)) };
}

async function saveExtra(agencyId: string, fields: Partial<Omit<AgencyExtra, "agency_id">>, actorId: string) {
  const { error } = await adminClient()
    .from("followup_agencies")
    .upsert({ agency_id: agencyId, ...fields, updated_by: actorId, updated_at: new Date().toISOString() }, { onConflict: "agency_id" });
  if (error) throw missing(error) ? new HttpError(409, MISSING) : new Error("FOLLOWUP_SAVE_FAILED");
}

/**
 * «Estado»: corrects the agency's stage (the extension checks it before each
 * execution). Choosing the funnel's own stage removes the correction. It holds
 * while the funnel says the same; «fuera» takes it out of Follow-up.
 */
export async function setStage(agencyId: string, stage: unknown, actorId: string, actorName = "") {
  if (!isOverrideStage(stage)) throw new HttpError(400, "Etapa desconocida.");
  const { at } = await now(agencyId);
  const funnelStep = at.derived.reached === null ? -1 : at.derived.reached;
  if (stage === at.derived.stage) await saveExtra(agencyId, { stage_override: null, override_step: null }, actorId);
  else await saveExtra(agencyId, { stage_override: stage, override_step: funnelStep }, actorId);
  await audit("stage", { id: actorId, name: actorName }, { agencyId, from: at.stage ?? "fuera", to: stage });
  return { stage: stage === OUT ? null : stage, manual: stage !== at.derived.stage };
}

/**
 * The score of an agency still to contact: the one of its prospecting account
 * (the extension loads it with the list), through the same function as the
 * rest of prospecting; without an account (added by hand), Follow-up's own.
 * The other stages show the lead score, which is not edited.
 */
export async function setScore(agencyId: string, raw: unknown, actorId: string, actorName = "") {
  const score = raw === null || raw === "" ? null : Number(raw);
  if (score !== null && (!Number.isFinite(score) || score < 0 || score > 100)) throw new HttpError(400, "El score va de 0 a 100.");
  const { at, account } = await now(agencyId);
  if (at.stage !== "no-contactado") throw new HttpError(409, "El score se edita en «No contactado». En las otras etapas es el lead score.");
  const value = score === null ? null : Math.round(score * 100) / 100;
  if (account) await prospectRpc("habita_prospect_update", { p_actor: actorId, p_account: account.id, p_version: account.version, p_patch: { score: value } });
  else await saveExtra(agencyId, { score: value }, actorId);
  await audit("score", { id: actorId, name: actorName }, { agencyId, from: account?.score ?? null, to: value });
  return { score: value };
}

/**
 * «Agregar»: an agency added by hand straight into a stage, with its WhatsApp,
 * contact, address, zone and web. It is created like «Nueva inmobiliaria»
 * (with its duplicate check) and stays in that stage until its funnel moves.
 */
export async function addAgency(input: Record<string, unknown>, actorId: string) {
  if (!isStageKey(input.stage)) throw new HttpError(400, "Etapa desconocida.");
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const whatsappRaw = text(input.whatsapp, 40);
  const whatsapp = whatsappRaw ? normalizeArNumber(whatsappRaw) : null;
  if (whatsappRaw && !whatsapp) throw new HttpError(400, "Revisá el WhatsApp: un celular de Argentina, con el código de área.");
  const score = input.score === undefined || input.score === null || input.score === "" ? null : Number(input.score);
  if (score !== null && (!Number.isFinite(score) || score < 0 || score > 100)) throw new HttpError(400, "El score va de 0 a 100.");
  const made = await createAgencyRecord(actorId, { key: input.key, name: input.name, website: input.website, contactName: input.contact, confirmDuplicates: input.confirmDuplicates });
  if (made.kind === "duplicates") return { duplicates: made.duplicates };
  if (whatsapp) {
    const { error } = await adminClient().from("agencies").update({ contact_whatsapp: `+${whatsapp}` }).eq("id", made.id);
    if (error) throw new Error("FOLLOWUP_AGENCY_WHATSAPP_FAILED");
  }
  const at = (await now(made.id)).at;
  const funnelStep = at.derived.reached === null ? -1 : at.derived.reached;
  await saveExtra(
    made.id,
    {
      stage_override: input.stage === at.derived.stage ? null : input.stage,
      override_step: input.stage === at.derived.stage ? null : funnelStep,
      address: text(input.address, 200) || null,
      zone: text(input.zone, 120) || null,
      score: input.stage === "no-contactado" ? score : null,
    },
    actorId,
  );
  return { id: made.id, name: made.name };
}

/** Follow-up → Script: the guide the extension reads before working. */
export async function readScript() {
  const { data, error } = await adminClient().from("followup_script").select("body,updated_at").eq("id", 1).maybeSingle();
  if (error) throw missing(error) ? new HttpError(409, MISSING) : new Error("FOLLOWUP_READ_FAILED");
  return (data as { body: string; updated_at: string } | null) ?? { body: "", updated_at: null };
}

export async function saveScript(body: unknown, actorId: string) {
  if (typeof body !== "string") throw new HttpError(400, "Falta el script.");
  if (body.length > 20000) throw new HttpError(400, "El script supera los 20.000 caracteres.");
  const { data, error } = await adminClient()
    .from("followup_script")
    .upsert({ id: 1, body, updated_by: actorId, updated_at: new Date().toISOString() }, { onConflict: "id" })
    .select("body,updated_at")
    .single();
  if (error) throw missing(error) ? new HttpError(409, MISSING) : new Error("FOLLOWUP_SAVE_FAILED");
  return data as { body: string; updated_at: string };
}
