import { AGENCY_STEPS as chartSteps, demosInPeriod, inPeriod, parsePeriod, funnelCounts as chartCounts, type Period } from "@/lib/agency/demo-funnel";
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
  commercialOf,
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
  allocateFirstContactSlots,
  remainingFirstContactSlots,
  SITUATIONS,
  actionLabel,
  byPriority,
  byQueueOrder,
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
import { DEFAULT_RULES, cleanRule, compatible, outsideWindow, type Rule } from "./rules";
import { WINDOWS, blockReasons, bySegment, cohorts, versionResults, weekly, type VersionResult, type WindowKey } from "./results";
import { cleanFilter, pickNext } from "./queue-filter";
import { customStages } from "./commercial-catalog";
import { readSituationOverrides, readStateCatalog, resolveCustomClassification } from "./state-catalog";

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
  rejection_stage?: StageKey | null;
  catalog_situation?: string | null;
  short_name: string | null;
  priority: Priority | null;
  snooze_until: string | null;
  snooze_reason: string | null;
};
const extras = async (agencyId?: string) => {
  let q = adminClient().from("followup_agencies").select("agency_id,stage_override,override_step,address,zone,score,situation,situation_step,situation_note,situation_at,rejection_stage,catalog_situation,short_name,priority,snooze_until,snooze_reason");
  if (agencyId) q = q.eq("agency_id", agencyId);
  const { data, error } = await q.limit(20000);
  if (error) throw missing(error) ? new HttpError(409, MISSING) : new Error("FOLLOWUP_READ_FAILED");
  return new Map(((data ?? []) as AgencyExtra[]).map((x) => [x.agency_id, { ...x, score: x.score === null ? null : Number(x.score) }]));
};

/** Las reglas activas e inactivas (Fase 3). Sin la tabla, la migración falta. */
const missingGenerationField = (error: { code?: string; message?: string } | null) =>
  Boolean(error && (error.code === "42703" || error.code === "PGRST204" || /min_demo_activity_level/i.test(error.message ?? "")));
async function readRules(): Promise<Rule[]> {
  const db = adminClient();
  const latest = await db.from("followup_rules")
    .select("key,name,stage,situations,action,after_hours,after_action,position,enabled,hours_from,hours_to,days,min_demo_activity_level,catalog_situation")
    .limit(500);
  if (!missingGenerationField(latest.error)) {
    if (latest.error) throw missing(latest.error) ? new HttpError(409, MISSING) : new Error("FOLLOWUP_READ_FAILED");
    return ((latest.data ?? []) as Rule[]).map((r) => ({
      ...r, after_hours: Number(r.after_hours), min_demo_activity_level: Number(r.min_demo_activity_level ?? 0),
    }));
  }
  const legacy = await db.from("followup_rules")
    .select("key,name,stage,situations,action,after_hours,after_action,position,enabled,hours_from,hours_to,days")
    .limit(500);
  if (legacy.error) throw missing(legacy.error) ? new HttpError(409, MISSING) : new Error("FOLLOWUP_READ_FAILED");
  return ((legacy.data ?? []) as Rule[]).map((r) => ({
    ...r, after_hours: Number(r.after_hours), min_demo_activity_level: 0,
  }));
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
  /** Verified demo generation, distinct from generic interaction. */
  demoGenerated: boolean;
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
  catalogSituation?: string | null;
  productSituations?: string[];
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
  /** Last recorded inbound reply/interest, not our last outbound. */
  lastReplyAt: string | null;
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
  outsideToday: number;
  cap: number;
  /** Real capacity in the rolling 24-hour window, not all waiting prospects. */
  newRemaining: number;
  newWaiting: number;
};

type Claim = { agency_id: string; actor_id: string; actor_name: string; stage: string; action: string; locked_until: string };
const claims = async () => {
  const { data, error } = await adminClient().from("followup_claims").select("agency_id,actor_id,actor_name,stage,action,locked_until").gt("locked_until", new Date().toISOString()).limit(5000);
  if (error) throw missing(error) ? new HttpError(409, MISSING) : new Error("FOLLOWUP_READ_FAILED");
  return new Map(((data ?? []) as Claim[]).map((c) => [c.agency_id, c]));
};

const DAY_MS = 86_400_000;
export type QuotaSettings = { cap: number; outsideToday: number; externalUpdatedAt: string | null };
export async function readQuotaSettings(now = new Date()): Promise<QuotaSettings> {
  const { data, error } = await adminClient().from("followup_quota_settings")
    .select("cap,external_count,external_updated_at").eq("id", true).single();
  if(error || !data) throw new HttpError(503, "No se pudo consultar el cupo. Verificá la migración de configuración.");
  const stamped = data.external_updated_at ? Date.parse(data.external_updated_at) : NaN;
  return { cap: data.cap, outsideToday: Number.isFinite(stamped) && stamped > now.getTime()-DAY_MS ? data.external_count : 0,
    externalUpdatedAt: data.external_updated_at };
}
export async function updateQuotaSettings(
  input: { cap?: unknown; outsideToday?: unknown },
  actor: { id: string; name: string },
) {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if(input.cap!==undefined){
    if(!Number.isInteger(input.cap)||Number(input.cap)<1||Number(input.cap)>500)throw new HttpError(400,"El límite debe ser un número entre 1 y 500.");
    patch.cap=input.cap;
  }
  if(input.outsideToday!==undefined){
    if(!Number.isInteger(input.outsideToday)||Number(input.outsideToday)<0||Number(input.outsideToday)>10000)throw new HttpError(400,"Indicá cuántos saludos enviaste fuera de Habita.");
    patch.external_count=input.outsideToday;
    patch.external_updated_at=new Date().toISOString();
  }
  const {error}=await adminClient().from("followup_quota_settings").update(patch).eq("id",true);
  if(error)throw new HttpError(503,"No se pudo guardar la configuración del cupo.");
  await audit("quota",actor,{to:JSON.stringify(patch)}).catch(()=>undefined);
  return readQuotaSettings();
}

const whenText = (iso: string) => new Date(iso).toLocaleString("es-AR", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });

/**
 * Everything Follow-up knows of every agency, computed once: its stage,
 * situation, next action, whether it can be executed now and why not. The
 * page, the agent's queue and each claim or confirmation read the same thing,
 * so the counters match the rows.
 */
async function board(now = new Date()) {
  const [rows, ds, vs, ex, extra, info, held, open, rules, overrides, catalog, extraStages, quota] = await Promise.all([
    commercialRows(),
    prospectDataset({ syncConversions: false }),
    versions(),
    executions(),
    extras(),
    details(),
    claims(),
    openReplies(),
    readRules(), readSituationOverrides(), readStateCatalog(), customStages(), readQuotaSettings(now),
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
  const surveyStarted = Math.min(...vs.filter((v) => v.action === "encuesta_cierre").map((v) => Date.parse(v.created_at)));
  // Only an explicit rejection classified after the survey was introduced can enter its queue.
  // Show them only in Contactado > No interesados, for audit and manual correction.
  const closedItems: QueueItem[] = [];
  for (const { r, account, own, at } of base) {
    const closingStage = own?.rejection_stage ?? "no-responde";
    const surveyReply = own?.situation === "rechazo" && own.situation_at && Date.parse(own.situation_at) >= surveyStarted &&
      ds && !r.test && !account?.suppressed && compatible(closingStage, "encuesta_cierre") && (!at.manual || at.stage === closingStage) && (!at.stage || at.stage === closingStage) &&
      !(account?.contacts.some(c => c.channel === "whatsapp") && account.contacts.filter(c => c.channel === "whatsapp").every(c => c.invalid));
    const placement = surveyReply ? { ...at, stage: closingStage, step: stageInfo(closingStage).step } : at;
    if (surveyReply) later(lastReply, r.id, own.situation_at);
    if (!placement.stage) {
      const lost = !r.test && !account?.suppressed && (r.prospectFunnel?.lost || account?.stage === "lost" || account?.stage === "discarded");
      if (lost) {
        const viewAt = { ...at, stage: "no-responde" as const, step: 0 };
        const closed = item(r, account, own, info, viewAt, vs, exOf.get(r.id) ?? [], sendsOf.get(r.id) ?? [], rules);
        if (closed.situation !== "proveedor_ia") closed.situation = "rechazo";
        closed.action = null;
        closed.actionLabel = null;
        closed.ruleKey = null;
        closed.versionId = null;
        closedItems.push(closed);
      }
      continue;
    }
    const productKeys = catalog.filter(s => s.active && s.source === "product" && s.product_stage === at.derived.stage && s.product_stage === placement.stage).map(s => s.key);
    const it = item(r, account, own, info, placement, vs, exOf.get(r.id) ?? [], sendsOf.get(r.id) ?? [], rules, Boolean(surveyReply), productKeys);
    const scopes = [commercialOf(it.stage) as string, ...extraStages.filter(s => s.technical_stage === it.stage && s.entry_situation === it.situation).map(s => s.key)];
    const disabled = overrides.some(o => scopes.includes(o.commercial_stage) && o.key === it.situation && o.enabled === false)
      || Boolean(it.catalogSituation && !catalog.some(s => s.key === it.catalogSituation && s.active));
    if (disabled && it.execution?.status !== "sent") {
      it.action = null; it.actionLabel = null; it.ruleKey = null; it.versionId = null;
      it.versionChannel = null; it.actionReason = "Situación deshabilitada en esta etapa.";
    }
    // A promised demo (interested, the demo still to make or to send) goes first; past 30 minutes it is late.
    const interest = lastInterest.get(r.id);
    if (interest && it.action !== "encuesta_cierre" && (it.stage === "sin-demo" || it.stage === "sin-enviar") && it.execution?.status !== "sent") {
      it.promisedAt = new Date(interest).toISOString();
      it.priority = own?.priority ?? "alta";
    }
    it.lastReplyAt = lastReply.get(r.id) ? new Date(lastReply.get(r.id)!).toISOString() : null;
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
  // Respect remaining first-contact capacity rather than calling every
  // prospect "ready" until the 50th send. Claims reserve capacity first.
  // This only governs registered sends; WhatsApp Web activity outside Habita
  // cannot be inferred or counted here.
  const allocated = allocateFirstContactSlots([...items.values()], fresh.size + quota.outsideToday, now.getTime(), quota.cap);
  for (const candidate of allocated.waiting)
    candidate.blocked = `Sin cupo para primer contacto: ${fresh.size} registrados y ${quota.outsideToday} externos en 24 h, máximo ${quota.cap}. Se habilitará al liberarse un cupo.`;

  // Fase 4: the moment each execution converted, recorded the first time it is seen (the exact time when known).
  const firstDemo = new Map<string, number>();
  for (const r of rows) for (const d of r.demos) if (d.createdAt) later(firstDemo, r.id, d.createdAt);
  // GETs must not mutate real conversion history. Credit only an observed
  // post-send interest or demo creation timestamp. For later steps we don't
  // know the exact event time; never fabricate one using the time of this GET.
  for (const e of ex) {
    if (e.status !== "sent" || !e.sent_at || e.converted_at || (stepNow.get(e.agency_id) ?? -1) <= e.from_step) continue;
    const sentAt = Date.parse(e.sent_at);
    const interest = lastInterest.get(e.agency_id);
    const demo = firstDemo.get(e.agency_id);
    const observed = e.from_step < 1 && interest && interest >= sentAt
      ? interest
      : e.from_step < 2 && demo && demo >= sentAt
        ? demo
        : null;
    if (observed !== null) e.converted_at = new Date(observed).toISOString();
  }
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
  return { rows, items, closedItems, vs, ex, stepNow, newToday: fresh.size, quota, open, names: new Map(rows.map((r) => [r.id, r.name])), rules, facts,
    // Catalog already fetched to calculate which actions are eligible; reuse it
    // in the Chapa snapshot instead of making three additional DB round trips.
    catalog: { stages: extraStages, states: catalog, overrides },
  };
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
  // Capacity is allocated once across the whole board using the DB-configured limit; no second hardcoded cap here.
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
  surveyReply = false,
  productKeys: string[] = [],
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
  const sit = surveyReply ? { situation: "rechazo" as const, manual: true } : currentSituation(derived, own?.situation && own.situation_step !== null ? { situation: own.situation, step: own.situation_step } : null, stepValue(at.derived.reached));
  // The steps already sent in this stage: the sequence goes on from there.
  const stageSent = executionsOf.filter((e) => e.stage === stage && e.status === "sent").sort((a, b) => (b.sent_at ?? "").localeCompare(a.sent_at ?? ""));
  const doneMap: Partial<Record<Action, boolean>> = {};
  for (const e of stageSent) doneMap[(e.action ?? "principal") as Action] = true;
  const demoGenerated = r.demos.some((d) => d.generated === true);
  const matchingRules = rules.filter(rule => !rule.catalog_situation || productKeys.includes(rule.catalog_situation) || (sit.manual && rule.catalog_situation === own?.catalog_situation));
  const alreadySurveyed = executionsOf.some(e => e.action === "encuesta_cierre" && e.status === "sent");
  if (alreadySurveyed) doneMap.encuesta_cierre = true;
  const next = nextAction(stage, sit.situation, doneMap, sit.situation === "rechazo" && !surveyReply ? [] : matchingRules, demoGenerated);
  // The rule's window, or the one of the rule that sent the last step (for the row of a finished sequence).
  const window = next.rule ?? rules.find((x) => x.stage === stage && x.action === (stageSent[0]?.action ?? "principal")) ?? null;
  // Nothing left to send but something went out: the row shows that last one as sent.
  const action = next.action ?? (surveyReply && stageSent.some(e => e.action === "encuesta_cierre") ? "encuesta_cierre" : null) ?? (!CLOSED_SITUATIONS.includes(sit.situation) && stageSent[0] ? ((stageSent[0].action ?? "principal") as Action) : null);
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
    demoGenerated,
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
    productSituations: productKeys,
    catalogSituation: sit.manual ? own?.catalog_situation : null,
    situationManual: sit.manual,
    situationNote: sit.manual ? (own?.situation_note ?? null) : null,
    action,
    actionLabel: action ? actionLabel(stage, action) : null,
    group: groupOf(stage, action),
    afterHours: next.action ? next.afterHours : 0,
    ruleKey: next.rule?.key ?? null,
    window: window ? { hours_from: window.hours_from, hours_to: window.hours_to, days: window.days } : null,
    promisedAt: null,
    lastReplyAt: null,
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
export async function followupOverview(period: Period = parsePeriod({})): Promise<{ chart: ReturnType<typeof chartCounts>; lostAt: number[]; chartRows: { agencyId: string; name: string; step: number | null; lost: boolean; score: number | null; whatsapp: string | null }[]; catalog: { stages: Awaited<ReturnType<typeof customStages>>; states: Awaited<ReturnType<typeof readStateCatalog>>; overrides: Awaited<ReturnType<typeof readSituationOverrides>> }; stages: StageView[]; queue: QueueItem[]; blocked: QueueItem[]; noInteresados: QueueItem[]; summary: QueueSummary; inbox: InboxItem[]; funnel: FunnelStep[]; rules: Rule[]; changes: Change[]; results: Results; generatedAt: string }> {
  const [b, changes] = await Promise.all([board(), auditOf(null, 20)]);
  const all = [...b.items.values()];
  const inboxItems = inboxOf(b);
  const reached = b.rows.filter(row => !row.test).map(row => {
    const prospect = row.prospectFunnel;
    return { agencyId: row.id, name: row.name, score: row.score, whatsapp: row.whatsapp ?? null, step: agencyStep(prospect && inPeriod(prospect.at, period) ? prospect.step : null, demosInPeriod(row.demos, period).step), lost: Boolean(prospect?.lost) };
  });
  return {
    catalog: b.catalog,
    chart: chartCounts(reached.flatMap(row => row.step === null ? [] : [row.step]), chartSteps),
    lostAt: chartSteps.map((_, i) => reached.filter(row => row.step === i && row.lost).length),
    chartRows: reached,
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
    noInteresados: [...b.closedItems, ...all.filter((q) => q.stage === "no-responde" && (q.situation === "rechazo" || q.situation === "proveedor_ia"))].sort(byPriority),
    summary: summarize(all, b.newToday, inboxItems.length, b.quota),
    inbox: inboxItems,
    funnel: funnelOf(b, all),
    rules: [...b.rules].sort((x, y) => x.position - y.position),
    changes,
    results: resultsOf(b, all),
    generatedAt: new Date().toISOString(),
  };
}

/** La cola de ejecución recalculada (lo que la pantalla vuelve a pedir cada 45 segundos y después de confirmar un envío). */
export async function followupQueueView() {
  const b = await board();
  const all = [...b.items.values()];
  return {
    queue: executable(all),
    blocked: all.filter((q) => pending(q) && q.blocked).sort(byPriority),
    noInteresados: [...b.closedItems, ...all.filter((q) => q.stage === "no-responde" && (q.situation === "rechazo" || q.situation === "proveedor_ia"))].sort(byPriority),
    summary: summarize(all, b.newToday, inboxOf(b).length, b.quota),
    rules: [...b.rules].sort((x, y) => x.position - y.position),
    generatedAt: new Date().toISOString(),
  };
}
export type QueueView = Awaited<ReturnType<typeof followupQueueView>>;

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
const executable = (all: QueueItem[]) => all.filter((q) => pending(q) && !q.blocked).sort((a, b) => byQueueOrder(a, b));
function summarize(all: QueueItem[], newToday: number, inboxCount = 0, quota: QuotaSettings = {cap:48,outsideToday:0,externalUpdatedAt:null}): QueueSummary {
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
    cap: quota.cap,
    outsideToday: quota.outsideToday,
    newRemaining: remainingFirstContactSlots(newToday+quota.outsideToday, quota.cap),
    newWaiting: all.filter((q) => q.stage === "no-contactado" && pending(q) &&
      (q.blocked?.startsWith("Sin cupo para primer contacto") || q.blocked?.startsWith("Tope de conversaciones"))).length,
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
export async function claimNext(input: { agencyId?: unknown; filter?: unknown; skip?: unknown }, origin: string, actor: { id: string; name: string }) {
  if (typeof input.agencyId === "string" && input.agencyId) {
    const { it, b } = await itemOf(input.agencyId);
    if (it.execution?.status === "sent") throw new HttpError(409, `Ya se confirmó «${it.actionLabel}» con ${it.name}.`);
    if (it.blocked) throw new HttpError(409, it.blocked);
    await lock(it, actor);
    return prepare(it, origin, actor, b.vs);
  }
  // La cola se recalcula ahora (no la que tiene la pantalla) y se toma solo lo que entra en el filtro elegido.
  // Filtering after the first 500 globally ranked prospects silently loses
  // stage-specific results. Rank and filter the entire executable board first.
  const currentBoard = await board();
  const queue = executable([...currentBoard.items.values()]);
  const skip = Array.isArray(input.skip) ? input.skip.filter((x): x is string => typeof x === "string").slice(0, 500) : [];
  const it = await pickNext(queue, { filter: cleanFilter(input.filter), rules: currentBoard.rules, skip, actorId: actor.id }, (x) =>
    lock(x, actor).then(
      () => true,
      (e) => {
        if (e instanceof HttpError && e.status === 409) return false;
        throw e;
      },
    ),
  );
  return it ? prepare(it, origin, actor) : null;
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
async function prepare(it: QueueItem, origin: string, actor: { id: string; name: string }, knownVersions?: FollowupVersion[]) {
  const vs = knownVersions ?? await versions();
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
    { key: "rechazo", label: "Situación habilitada para esta acción", ok: it.action === "encuesta_cierre" || !CLOSED_SITUATIONS.includes(it.situation), note: "" },
    { key: "reciente", label: "Sin mensaje equivalente reciente", ok: !it.blocked, note: it.blocked ?? (it.execution?.status === "opened" ? "Se abrió WhatsApp antes sin confirmar: revisá el chat" : "") },
    { key: "horario", label: "Horario permitido", ok: !hours, note: hours ?? (it.group === "nuevos" ? "Lunes a sábado, de 9 a 18" : "Lunes a sábado, de 9 a 19") },
    { key: "variables", label: "Variables completas", ok: !holes.length, note: holes.length ? holes.map((h) => `{{${h}}}`).join(", ") : `{{inmobiliaria}} = «${it.shortName}»` },
    { key: "enlaces", label: "Enlaces listos", ok: linkOk, note: need.demo || need.panel ? (linkOk ? "Demo y panel armados" : "No se pudo armar un enlace") : "Este mensaje no lleva enlaces" },
    { key: "mensaje", label: "Mensaje listo", ok: ready, note: `${messages.length} ${messages.length === 1 ? "mensaje" : "mensajes"} · V${v.version}` },
  ];
  // A demo to make: what the panel can check by itself, and the promise (30 minutes at most).
  if (it.action === "principal" && (it.stage === "sin-demo" || it.stage === "sin-enviar")) {
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
    /** La inmobiliaria como la ve la cola ahora (la pantalla la muestra aunque su lista esté desactualizada). */
    item: it,
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
  const rpc = status === "sent" && it.stage === "no-contactado"
    ? "habita_followup_mark_capped" : "habita_followup_mark";
  const { data, error } = await adminClient().rpc(rpc, {
    p_actor: actorId,
    p_version: v.id,
    p_agency: it.agencyId,
    p_from_step: it.step,
    p_status: status,
    p_reason: reason || null,
    p_body: body || null,
  });
  if (error?.message?.includes("FOLLOWUP_FIRST_CONTACT_CAP_REACHED"))
    throw new HttpError(409, "Se alcanzó el límite interno de 50 contactos nuevos en 24 horas. El contacto sigue pendiente; no confirmes otro envío.");
  if (error) throw missing(error) ? new HttpError(409, "Falta aplicar la migración 202612080001_followup_first_contact_cap.sql.") : new Error("FOLLOWUP_MARK_FAILED");
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
export async function confirmExecution(input: { agencyId: unknown; stage?: unknown; action?: unknown; versionId?: unknown; text?: unknown }, actor: { id: string; name: string }, options: { includeItem?: boolean } = {}) {
  if (typeof input.agencyId === "string") {
    const before = await itemOf(input.agencyId).catch(() => null);
    if (before?.it.execution?.status === "sent" && before.it.versionId === input.versionId)
      return { execution: { status: "sent" as const, at: before.it.execution.at }, warning: null, item: strip(before.it), replayed: true };
  }
  const { it, v } = await sameTask(input, actor.id);
  // Revalidate availability at confirmation: a claim or an open WhatsApp tab
  // never reserves permission to exceed the first-contact cap or send to a
  // newly closed contact.
  if (v.channel === "whatsapp" && it.blocked) throw new HttpError(409, `No confirmes el envío: ${it.blocked} Actualizá la cola.`);
  // Crear demo is confirmed by publication in the product, never by a manual task-send click.
  if (it.stage === "sin-demo" && it.action === "principal" && v.channel === "task") throw new HttpError(409, "La demo todavía no está publicada. Creala desde el panel: al publicarla, Habita avanzará automáticamente a «Demo creada, sin enviar».");
  const text = typeof input.text === "string" ? input.text.trim().slice(0, 8000) : "";
  const e = await mark(it, v, "sent", actor.id, null, text || null);
  const warnings: string[] = [];
  const early = it.stage === "no-contactado" || it.stage === "no-responde";
  if (v.channel === "whatsapp" && early && it.action !== "encuesta_cierre") {
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
  if (it.stage === "sin-enviar" && it.action === "principal") await setDemosSent(it.agencyId, true, actor.id, "followup").catch(() => warnings.push("No pudimos marcar su demo como enviada."));
  await release(it.agencyId, actor.id).catch(() => undefined);
  // Chapa only consumes execution.status and timestamp. Rebuilding the entire
  // board after a persisted confirmation added an avoidable heavy read.
  // Native panel callers retain the original item response.
  const after = options.includeItem === false ? null : await itemOf(it.agencyId).catch(() => null);
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
export async function setSituation(agencyId: string, raw: unknown, note: unknown, actor: { id: string; name: string }, receivedAt = new Date().toISOString()) {
  const custom = typeof raw === "string" && raw.startsWith("custom_") ? await resolveCustomClassification(raw) : null;
  if (custom) {
    const current = (await board()).items.get(agencyId);
    if (!current || !await classificationMatches(current, custom.definition.commercial_stage))
      throw new HttpError(409, "La situación ya no corresponde a la etapa de la inmobiliaria.");
    raw = custom.canonical;
  }
  if (!isSituation(raw)) throw new HttpError(400, "Situación desconocida.");
  const situation = raw;
  const text = typeof note === "string" ? note.trim().slice(0, 2000) : "";
  const { at, account, extra } = await now(agencyId);
  if ((situation === "recontactar_vacaciones" || situation === "recontactar_mas_adelante") &&
      (at.stage === "no-contactado" || at.stage === null))
    throw new HttpError(409, "Recontactar se habilita desde Contactado en adelante.");
  await saveExtra(agencyId, { situation, rejection_stage: situation === "rechazo" ? at.stage ?? extra?.rejection_stage ?? null : null, catalog_situation: custom?.definition.key ?? null, situation_step: stepValue(at.derived.reached), situation_note: text || null, situation_at: receivedAt }, actor.id);
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
  catalog_situation?: string | null;
  confidence: number | null;
  status: "pendiente" | "facu" | "procesada";
  note: string | null;
};
const REPLY_FIELDS = "id,agency_id,body,received_at,classification,catalog_situation,confidence,status,note";

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
async function classificationMatches(current: QueueItem, expected: string) {
  if (commercialOf(current.stage) === expected) return true;
  if (!expected.startsWith("etapa_")) return false;
  return (await customStages()).some(s => s.key === expected && s.technical_stage === current.stage && s.entry_situation === current.situation);
}

export async function registerReply(
  input: { agencyId: unknown; text: unknown; receivedAt?: unknown; classification?: unknown; confidence?: unknown; note?: unknown; until?: unknown; contactName?: unknown; contactWhatsapp?: unknown },
  actor: { id: string; name: string },
) {
  if (typeof input.agencyId !== "string" || !isUuid(input.agencyId)) throw new HttpError(400, "Falta la inmobiliaria.");
  const text = typeof input.text === "string" ? input.text.trim().slice(0, 4000) : "";
  if (!text) throw new HttpError(400, "Falta el texto de la respuesta (en un audio: «Audio»).");
  const at = input.receivedAt ? new Date(String(input.receivedAt)) : new Date();
  if (Number.isNaN(at.getTime()) || at.getTime() > Date.now() + 120_000) throw new HttpError(400, "Hora inválida.");
  const rawClassification = typeof input.classification === "string" ? input.classification.trim() : "";
  const custom = rawClassification.startsWith("custom_") ? await resolveCustomClassification(rawClassification) : null;
  if (rawClassification.startsWith("custom_") && !custom) throw new HttpError(400, "Estado personalizado desconocido o inactivo. Revisá el catálogo.");
  if (custom) {
    const current = (await board()).items.get(input.agencyId);
    if (!current || !await classificationMatches(current, custom.definition.commercial_stage)) {
      throw new HttpError(409, "Ese estado personalizado no corresponde a la etapa comercial actual.");
    }
  }
  const classification = !rawClassification ? null : custom ? custom.canonical : isReplyClass(rawClassification) ? rawClassification : undefined;
  if (classification === undefined) throw new HttpError(400, "Clasificación desconocida.");
  const confidence = input.confidence === undefined || input.confidence === null || input.confidence === "" ? null : Number(input.confidence);
  if (confidence !== null && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) throw new HttpError(400, "La confianza va de 0 a 1.");
  // Custom labels only map to the existing engine with explicit, sufficient confidence.
  // Missing confidence goes to human review; it must not auto-send a reply.
  const route = custom && confidence === null ? "facu" : replyRoute(classification, confidence);
  const key = `${input.agencyId}:${at.toISOString().slice(0, 16)}:${text.slice(0, 80)}`;
  const db = adminClient();
  const found = await db.from("followup_replies").select(REPLY_FIELDS).eq("client_key", key).maybeSingle();
  if (found.error) throw missing(found.error) ? new HttpError(409, MISSING) : new Error("FOLLOWUP_READ_FAILED");
  if (found.data) return { reply: found.data as ReplyRow, route: (found.data as ReplyRow).status, replayed: true, warning: null };
  const originalNote = typeof input.note === "string" ? input.note.trim() : "";
  const note = `${custom ? `Catálogo: ${custom.definition.key} (${custom.definition.label}). ` : ""}${originalNote}`.slice(0, 500);
  const made = await db
    .from("followup_replies")
    .insert({
      agency_id: input.agencyId,
      body: text,
      received_at: at.toISOString(),
      classification,
      catalog_situation: custom?.definition.key ?? null,
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
  const applied = await setSituation(reply.agency_id, reply.catalog_situation && c === reply.classification ? reply.catalog_situation : situation, reply.body, actor, reply.received_at);
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
  const clean = cleanRule(input, Object.keys(SITUATIONS).filter((x) => x === "rechazo" || !CLOSED_SITUATIONS.includes(x as Situation)), ["encuesta_cierre", "principal", "seguimiento_2", "presentacion", "presentacion_seguimiento", "precios"], FOLLOWUP_STAGES.map((x) => x.key));
  if ("error" in clean) throw new HttpError(400, clean.error);
  if (clean.enabled && clean.situations.length) {
    const hidden = (await readSituationOverrides()).find(o => o.commercial_stage === commercialOf(clean.stage) && (o.removed || !o.enabled) && clean.situations.includes(o.key));
    if (hidden) throw new HttpError(400, `Habilitá «${hidden.label}» en Etapas y situaciones antes de guardar esta regla.`);
  }
  const db = adminClient();
  // Una regla nueva solo puede tener una acción de su etapa (las existentes incompatibles se pueden apagar, no crear).
  if (!(typeof key === "string" && key) && !compatible(clean.stage, clean.action)) throw new HttpError(400, `«${clean.action}» no es una acción de esta etapa: no se puede crear una regla así.`);
  const id = typeof key === "string" && key ? key : `${clean.stage}:${clean.action}:${Date.now().toString(36)}`;
  if (id.length > 80) throw new HttpError(400, "Regla desconocida.");
  const before = typeof key === "string" && key ? (await db.from("followup_rules").select("*").eq("key", key).maybeSingle()).data : null;
  if (typeof key === "string" && key && !before) throw new HttpError(404, "No encontramos esa regla.");
  const catalogKey = typeof input.catalog_situation === "string" && input.catalog_situation ? input.catalog_situation : null;
  if (catalogKey) {
    const definition = (await readStateCatalog()).find(s => s.key === catalogKey && s.active);
    if (!definition) throw new HttpError(400, "Revisá la situación personalizada de la regla.");
    if (definition.source === "product") {
      if (definition.product_stage !== clean.stage) throw new HttpError(400, "La actividad de la demo corresponde a otra subetapa.");
    } else if (!definition.maps_to || !clean.situations.includes(definition.maps_to as Situation)) {
      throw new HttpError(400, "Revisá la situación de conversación de la regla.");
    }
    const scope = definition.commercial_stage;
    if (scope !== commercialOf(clean.stage) && !(await customStages()).some(s => s.key === scope && s.technical_stage === clean.stage))
      throw new HttpError(400, "La situación pertenece a otra etapa.");
  }
  const payload = { key: id, ...clean, catalog_situation: catalogKey, updated_by: actor.id, updated_at: new Date().toISOString() };
  // Only reordering may change an existing rule's position. An editor may have been open before a reorder.
  const { position, ...fields } = payload;
  const write = (values: typeof fields | Omit<typeof fields, "min_demo_activity_level">) => before
    ? db.from("followup_rules").update(values).eq("key", id)
    : db.from("followup_rules").insert({ ...values, position });
  const latest = await write(fields)
    .select("key,name,stage,situations,action,after_hours,after_action,position,enabled,hours_from,hours_to,days,min_demo_activity_level,catalog_situation").single();
  let saved: Rule;
  if (missingGenerationField(latest.error)) {
    if (clean.min_demo_activity_level === 3) throw new HttpError(409, "Aplicá la migración de estados antes de activar «Generó imagen».");
    const { min_demo_activity_level: ignored, ...legacyPayload } = fields;
    void ignored;
    const legacy = await write(legacyPayload)
      .select("key,name,stage,situations,action,after_hours,after_action,position,enabled,hours_from,hours_to,days").single();
    if (legacy.error) throw missing(legacy.error) ? new HttpError(409, MISSING) : new Error("FOLLOWUP_SAVE_FAILED");
    saved = legacy.data as Rule;
  } else {
    if (latest.error) throw missing(latest.error) ? new HttpError(409, MISSING) : latest.error.code === "23514" ? new HttpError(400, "La base rechazó la regla: revisá los valores.") : new Error("FOLLOWUP_SAVE_FAILED");
    saved = latest.data as Rule;
  }
  await audit("rule", actor, { ref: id, from: before, to: clean });
  return { ...saved, after_hours: Number(saved.after_hours), min_demo_activity_level: Number(saved.min_demo_activity_level ?? 0) };
}

/**
 * Quita una regla. El motor deja de evaluarla en la próxima lectura. Las
 * versiones, las ejecuciones y las métricas no dependen de la regla y se
 * conservan. Queda en la auditoría con la regla completa, para poder volver a
 * crearla igual.
 */
export async function reorderRules(before: unknown, after: unknown, actor: { id: string; name: string }) {
  if (![before, after].every(a => Array.isArray(a) && a.length > 0 && a.length <= 1000 && a.every(k => typeof k === "string" && k.length <= 80)))
    throw new HttpError(400, "Orden de reglas inválido.");
  const { error } = await adminClient().rpc("habita_reorder_rules", { p_before: before, p_after: after, p_actor: actor.id });
  if (error) throw new HttpError(error.message.includes("ORDER_CHANGED") ? 409 : 400,
    error.message.includes("ORDER_CHANGED") ? "El orden cambió en otra sesión. Revisá la lista actualizada." : "No pudimos guardar el orden.");
  await audit("rule", actor, { from: before, to: after });
  return { ok: true };
}

export async function deleteRule(key: unknown, actor: { id: string; name: string }) {
  if (typeof key !== "string" || !key || key.length > 80) throw new HttpError(400, "Regla desconocida.");
  const db = adminClient();
  const before = (await db.from("followup_rules").select("*").eq("key", key).maybeSingle()).data;
  if (!before) throw new HttpError(404, "No encontramos esa regla.");
  const { error } = await db.from("followup_rules").delete().eq("key", key);
  if (error) throw missing(error) ? new HttpError(409, MISSING) : new Error("FOLLOWUP_DELETE_FAILED");
  await audit("rule", actor, { ref: key, from: before, to: null });
  return { key };
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
