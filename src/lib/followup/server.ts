import "server-only";
import { HttpError } from "@/lib/commerce/http";
import { agencyStep } from "@/lib/agency/demo-funnel";
import { commercialRow, commercialRows } from "@/lib/agency/commercial-server";
import type { CommercialRow } from "@/lib/agency/commercial";
import { agencyDemoLink, setDemosSent } from "@/lib/agency/external";
import { agencyPanelLink } from "@/lib/agency/panel-link";
import { normalizeArNumber } from "@/lib/demos/send";
import { isUuid } from "@/lib/demos/shared";
import { contactFor } from "@/lib/prospecting/external";
import { recordSend } from "@/lib/prospecting/record-send";
import { prospectDataset } from "@/lib/prospecting/server";
import type { Dataset, ProspectAccount } from "@/lib/prospecting/types";
import { adminClient } from "@/lib/supabase/server";
import {
  FOLLOWUP_STAGES,
  cleanVersion,
  fillMessage,
  isStageKey,
  linksNeeded,
  missingVariables,
  personName,
  lastActionOf,
  stageInfo,
  stageOf,
  stepValue,
  versionFor,
  versionStats,
  type ExecutionStatus,
  type FollowupExecution,
  type FollowupVersion,
  type LastAction,
  type StageKey,
  type VersionStats,
} from "./stages";

/**
 * Follow-up (/admin/follow-up): each funnel stage with its next best action,
 * its versions measured and the agencies waiting in it. The agencies and
 * their step come from commercialRows, the same rows as /admin/inmobiliarias
 * («Todo»), so a stage holds exactly the orange part of that bar.
 */

export const MIGRATION = "202611300001_followup.sql";
const MISSING = `Para Follow-up falta aplicar la migración ${MIGRATION} en Supabase.`;
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
const versions = () => readAll<FollowupVersion>("followup_versions", "id,stage,version,channel,trigger_label,body,ctas,status,created_at,status_at");
const executions = (agencyId?: string) =>
  agencyId
    ? adminClient()
        .from("followup_executions")
        .select("id,version_id,stage,agency_id,from_step,status,reason,created_at,updated_at,sent_at")
        .eq("agency_id", agencyId)
        .then(({ data, error }) => {
          if (error) throw missing(error) ? new HttpError(409, MISSING) : new Error("FOLLOWUP_READ_FAILED");
          return (data ?? []) as FollowupExecution[];
        })
    : readAll<FollowupExecution>("followup_executions", "id,version_id,stage,agency_id,from_step,status,reason,created_at,updated_at,sent_at");

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
function place(r: CommercialRow, account: ProspectAccount | undefined) {
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

/** Who to write to: the prospecting WhatsApp (the reviewed one first), else the agency's contact WhatsApp. */
function recipient(r: CommercialRow, account: ProspectAccount | undefined) {
  const contact = account ? contactFor(account, "whatsapp") : null;
  const raw = contact?.address ?? r.whatsapp ?? null;
  const wa = normalizeArNumber(raw) ?? (raw && /^\d{10,15}$/.test(raw.replace(/\D/g, "")) ? raw.replace(/\D/g, "") : null);
  // The prospecting «decisor» is usually a category («Por confirmar», «Marca comercial»): only a real name counts.
  const person = personName(contact?.person_name) ?? personName(account?.decision_maker) ?? null;
  return { wa, phone: raw, person, needsReview: Boolean(contact?.needs_review), fromProspect: Boolean(contact) };
}

export type QueueItem = {
  agencyId: string;
  name: string;
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
  versionId: string | null;
  execution: { status: ExecutionStatus; at: string; reason: string | null } | null;
};
export type StageView = {
  key: StageKey;
  title: string;
  goal: string;
  versions: (FollowupVersion & { stats: VersionStats })[];
  queue: QueueItem[];
};

/** The whole page: one view per stage, with its versions measured and its queue (the ones still to do first, the longest waiting first). */
export async function followupOverview(): Promise<{ stages: StageView[] }> {
  const [rows, ds, vs, ex] = await Promise.all([commercialRows(), prospectDataset().catch(() => null), versions(), executions()]);
  const accounts = accountsByAgency(ds);
  const stepNow = new Map<string, number>();
  const byStage = new Map<StageKey, QueueItem[]>(FOLLOWUP_STAGES.map((s) => [s.key, []]));
  const exOf = new Map<string, FollowupExecution[]>();
  for (const e of ex) exOf.set(e.agency_id, [...(exOf.get(e.agency_id) ?? []), e]);
  const accountIds = new Map<string, Set<string>>();
  for (const a of ds?.accounts ?? []) accountIds.set(a.agency_id, (accountIds.get(a.agency_id) ?? new Set()).add(a.id));
  const sendsOf = new Map<string, NonNullable<typeof ds>["attempts"]>();
  for (const t of ds?.attempts ?? []) if (t.status === "sent") sendsOf.set(t.account_id, [...(sendsOf.get(t.account_id) ?? []), t]);
  for (const r of rows) {
    const account = accounts.get(r.id);
    const { reached, stage } = place(r, account);
    stepNow.set(r.id, stepValue(reached));
    if (!stage) continue;
    const mine = (exOf.get(r.id) ?? []).filter((e) => e.stage === stage);
    const version = versionFor(r.id, vs.filter((v) => v.stage === stage), mine);
    const done = version ? mine.find((e) => e.version_id === version.id) : undefined;
    const to = recipient(r, account);
    const lastAction = lastActionOf({
      executions: exOf.get(r.id) ?? [],
      versions: vs,
      attempts: [...(accountIds.get(r.id) ?? [])].flatMap((id) => sendsOf.get(id) ?? []),
      activity: r.lastActivity,
    });
    byStage.get(stage)!.push({
      agencyId: r.id,
      name: r.name,
      person: to.person,
      phone: to.phone,
      wa: to.wa,
      needsReview: to.needsReview,
      hasDemo: Boolean(r.shareDemo),
      hasAccount: r.hasOwner,
      lastActivity: r.lastActivity,
      lastAction,
      since: lastAction?.at ?? r.prospectFunnel?.at ?? r.createdAt,
      versionId: version?.id ?? null,
      execution: done ? { status: done.status, at: done.updated_at, reason: done.reason } : null,
    });
  }
  // Still to do and with a WhatsApp first, then the ones without a number, then the ones already sent.
  const order = (q: QueueItem) => (q.execution?.status === "sent" ? 2 : q.wa ? 0 : 1);
  return {
    stages: FOLLOWUP_STAGES.map((s) => {
      const own = vs.filter((v) => v.stage === s.key).sort((a, b) => a.version - b.version);
      const stats = versionStats(own, ex.filter((e) => e.stage === s.key), stepNow);
      return {
        key: s.key,
        title: s.title,
        goal: s.goal,
        versions: own.map((v, i) => ({ ...v, stats: stats[i] })),
        queue: byStage.get(s.key)!.sort((a, b) => order(a) - order(b) || a.since.localeCompare(b.since)),
      };
    }),
  };
}

/** One agency, as it is now: its row, its prospecting account, its stage and its follow-up so far. */
async function current(agencyId: string, stage: unknown) {
  if (!isUuid(agencyId)) throw new HttpError(404, "No encontramos la inmobiliaria.");
  if (!isStageKey(stage)) throw new HttpError(400, "Etapa desconocida.");
  const [row, ds, vs, ex] = await Promise.all([commercialRow(agencyId), prospectDataset().catch(() => null), versions(), executions(agencyId)]);
  if (!row) throw new HttpError(404, "No encontramos la inmobiliaria.");
  const account = accountsByAgency(ds).get(agencyId);
  const at = place(row, account);
  if (at.stage !== stage)
    throw new HttpError(409, at.stage ? `Ya no está en «${stageInfo(stage).title}»: pasó a «${stageInfo(at.stage).title}». Actualizá la lista.` : `Ya no está en «${stageInfo(stage).title}». Actualizá la lista.`);
  const own = vs.filter((v) => v.stage === stage);
  const mine = ex.filter((e) => e.stage === stage);
  return { row, ds, account, reached: at.reached, versions: own, mine, version: versionFor(agencyId, own, mine) };
}

/**
 * «Ejecutar»: the message for this agency, with its links resolved (the same
 * ones as «Link demo» and «Link panel» in the list), its WhatsApp and the
 * version it gets. Nothing is recorded yet.
 */
export async function prepareExecution(agencyId: string, stage: unknown, origin: string, actor: { id: string; name: string }) {
  const c = await current(agencyId, stage);
  const v = c.version;
  if (!v) throw new HttpError(409, "Esta etapa no tiene una versión activa: creá una arriba.");
  const need = linksNeeded(v);
  const [demo, panel] = await Promise.all([
    need.demo ? agencyDemoLink(agencyId, actor.id, origin).then((l) => l.url).catch(() => null) : null,
    need.panel ? agencyPanelLink(agencyId, actor.id, origin).then((l) => l.url).catch(() => null) : null,
  ]);
  const to = recipient(c.row, c.account);
  const message = fillMessage(v.body, {
    inmobiliaria: c.row.name,
    decisor: to.person,
    sdr: c.account?.sdr || actor.name,
    demo,
    panel,
  });
  const holes = missingVariables(message);
  const prospectStage = v.stage === "no-contactado" || v.stage === "no-responde";
  const warnings: string[] = [];
  if (holes.includes("demo")) warnings.push("Todavía no tiene una demo publicada: publicala antes de mandar este mensaje.");
  if (holes.includes("panel")) warnings.push("No pudimos armar el link a su panel.");
  if (v.channel === "whatsapp" && !to.wa) warnings.push("Falta su WhatsApp: cargalo en la ficha de la inmobiliaria.");
  if (v.channel === "whatsapp" && prospectStage && c.account && to.needsReview) warnings.push("El número está por revisar: verificalo en Adquisición para que el envío se registre.");
  const ready = !holes.length && (v.channel === "task" || Boolean(to.wa));
  const previous = c.mine.find((e) => e.version_id === v.id);
  return {
    agencyId,
    stage: v.stage,
    versionId: v.id,
    version: v.version,
    channel: v.channel,
    ctas: v.ctas,
    person: to.person,
    phone: to.phone,
    message,
    ready,
    warnings,
    whatsappUrl: v.channel === "whatsapp" && to.wa && ready ? `https://wa.me/${to.wa}?text=${encodeURIComponent(message)}` : null,
    links: { demo, panel, createDemo: `/admin/inmobiliarias/${agencyId}/propiedades/nueva` },
    execution: previous ? { status: previous.status, at: previous.updated_at } : null,
  };
}

/**
 * Records what happened with the agency: «opened» (WhatsApp opened with the
 * message), «sent» (confirmed: it counts as an execution) or «failed» (it did
 * not go out). A confirmed send also moves what the rest of the panel reads:
 * a prospecting send in the first two stages, the demo marked as sent in
 * «Demo creada, sin enviar». Those are best effort: the execution counts
 * anyway and the answer says what could not be registered.
 */
export async function markExecution(
  input: { agencyId: string; stage: unknown; versionId: unknown; status: unknown; reason?: unknown; text?: unknown },
  actor: { id: string; name: string },
) {
  const status = input.status === "opened" || input.status === "sent" || input.status === "failed" ? (input.status as ExecutionStatus) : null;
  if (!status) throw new HttpError(400, "Estado desconocido.");
  const c = await current(input.agencyId, input.stage);
  const v = c.versions.find((x) => x.id === input.versionId);
  if (!v) throw new HttpError(409, "Esa versión ya no está en esta etapa. Actualizá la lista.");
  const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 300) : "";
  if (status === "failed" && !reason) throw new HttpError(400, "Contá por qué no salió.");
  const { data, error } = await adminClient().rpc("habita_followup_mark", {
    p_actor: actor.id,
    p_version: v.id,
    p_agency: input.agencyId,
    p_from_step: stepValue(c.reached),
    p_status: status,
    p_reason: reason || null,
  });
  if (error) throw missing(error) ? new HttpError(409, MISSING) : new Error("FOLLOWUP_MARK_FAILED");
  const execution = data as FollowupExecution;
  let warning: string | null = null;
  if (status === "sent" && execution.status === "sent") {
    const text = typeof input.text === "string" ? input.text.trim().slice(0, 4000) : "";
    try {
      if ((v.stage === "no-contactado" || v.stage === "no-responde") && v.channel === "whatsapp" && c.account && c.ds)
        await recordSend(actor.id, c.ds, c.account, { channel: "whatsapp", text: text || v.body }, actor.name, "Follow-up");
      if (v.stage === "sin-enviar") await setDemosSent(input.agencyId, true, actor.id, "followup");
    } catch (e) {
      warning = `La ejecución quedó registrada, pero no el envío en Adquisición: ${e instanceof HttpError ? e.message : "probá registrarlo desde su ficha."}`;
    }
  }
  return { execution: { status: execution.status, at: execution.updated_at }, warning };
}

const RPC_ERRORS: Record<string, [number, string]> = {
  FOLLOWUP_ACTIVE_REQUIRED: [409, "La versión activa no se archiva sola: activá otra primero."],
  FOLLOWUP_VERSION_NOT_FOUND: [404, "No encontramos esa versión."],
  FOLLOWUP_VERSION_FROZEN: [409, "Una versión guardada no se edita: creá una nueva."],
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
  });
  if (error) throw rpcFailure(error);
  return data as FollowupVersion;
}

/** «Hacerla la activa», «Detener prueba», «Probar 50/50». */
export async function setVersionStatus(id: unknown, status: unknown) {
  if (!isUuid(id)) throw new HttpError(404, "No encontramos esa versión.");
  if (status !== "active" && status !== "test" && status !== "archived") throw new HttpError(400, "Estado desconocido.");
  const { data, error } = await adminClient().rpc("habita_followup_set_status", { p_version: id, p_status: status });
  if (error) throw rpcFailure(error);
  return data as FollowupVersion;
}
