import "server-only";
import { HttpError } from "@/lib/commerce/http";
import { adminClient } from "@/lib/supabase/server";
import { actorName } from "./actor";
import { GROUPS, SITUATIONS } from "./plan";
import { createStage, customStages } from "./commercial-catalog";
import { canonicalClassifierOptions, changeBaseSituation, readSituationOverrides, readStateCatalog, removeCustomSituation, updateStateCatalog } from "./state-catalog";
import {
  agentQueue,
  claimNext,
  confirmExecution,
  createVersion,
  failExecution,
  followupOverview,
  inbox,
  openExecution,
  processReply,
  registerReply,
  releaseClaim,
  saveRule,
  setPriority,
  setSituation,
  setVersionStatus,
  snooze,
  unsnooze,
  updateVersion,
  type QueueItem,
} from "./server";

// Follow-up para el panel comercial de Chapa Labs (/prospecting), de servidor a servidor por
// /api/prospeccion: las mismas funciones que usa la extensión con la sesión del equipo
// (/api/admin/followup/*), con los mismos nombres de campo. Quien opera en Chapa (Facu, Axel)
// queda como el usuario del equipo con ese nombre, así los claims, la auditoría y la evidencia
// dicen quién fue.

export type Operator = { id: string; name: string };
type TeamUser = { id: string; email?: string; user_metadata: Record<string, unknown> };

const plain = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .split(/\s+/)[0]
    ?.toLowerCase() ?? "";

/**
 * El usuario del equipo que corresponde a quien opera en Chapa: el que tiene ese nombre (el mismo
 * que usa {{sdr}}). Si nadie coincide, el usuario por defecto de la API con el nombre que mandó
 * Chapa: la evidencia lo nombra igual, y el claim lo distingue por nombre (`guardClaim`).
 */
export function operatorFor(by: string, team: TeamUser[], fallbackId: string): Operator {
  const name = by.trim().slice(0, 80) || "Chapa Labs";
  const want = plain(name);
  const match = want ? team.find((u) => plain(actorName(u)) === want) : undefined;
  return match ? { id: match.id, name: actorName(match) } : { id: fallbackId, name };
}

/** Dos personas que entran con el mismo usuario por defecto: el claim de una frena a la otra. */
function guardClaim(it: Pick<QueueItem, "name" | "claim"> | undefined, actor: Operator) {
  const c = it?.claim;
  if (c && c.until > new Date().toISOString() && c.actorId === actor.id && c.by && c.by !== actor.name) throw new HttpError(409, `${it!.name} la está ejecutando ${c.by}.`);
}

/** Envíos confirmados y conversiones por quien ejecutó (el usuario del equipo). */
async function byActor(team: TeamUser[]) {
  const { data, error } = await adminClient().from("followup_executions").select("actor_id,status,converted_at").eq("status", "sent").limit(20000);
  if (error) return [];
  const name = new Map(team.map((u) => [u.id, actorName(u)]));
  const out = new Map<string, { executions: number; conversions: number }>();
  for (const e of (data ?? []) as { actor_id: string | null; converted_at: string | null }[]) {
    const k = (e.actor_id && name.get(e.actor_id)) || "Equipo";
    const cur = out.get(k) ?? { executions: 0, conversions: 0 };
    cur.executions++;
    if (e.converted_at) cur.conversions++;
    out.set(k, cur);
  }
  return [...out].map(([actor, x]) => ({ actor, ...x, rate: x.executions ? x.conversions / x.executions : null }));
}

/** Lo que Chapa muestra: la cola, las bloqueadas, la bandeja, el embudo, las reglas y los resultados. */
export async function followupSnapshot(team: TeamUser[] = []) {
  const [o, actors, catalogStages, catalogStates, catalogOverrides] = await Promise.all([
    followupOverview(), byActor(team),
    customStages().catch(() => null),
    readStateCatalog().catch(() => null),
    readSituationOverrides().catch(() => null),
  ]);
  return {
    labels: { situations: SITUATIONS, groups: GROUPS },
    catalog: {
      stages: (catalogStages ?? []).map((stage) => ({
        ...stage,
        waiting: o.stages.find((s) => s.key === stage.technical_stage)?.queue.filter((q) => q.situation === stage.entry_situation).length ?? 0,
      })),
      states: catalogStates ?? [], overrides: catalogOverrides ?? [],
      canonical: canonicalClassifierOptions(),
      available: catalogStages !== null && catalogStates !== null && catalogOverrides !== null,
    },
    summary: o.summary,
    queue: o.queue,
    blocked: o.blocked,
    scheduled: o.stages.flatMap((s) => s.queue).filter((q) => q.dueAt && q.action && q.execution?.status !== "sent"),
    inbox: o.inbox,
    funnel: o.funnel,
    stages: o.stages.map((s) => ({ key: s.key, title: s.title, goal: s.goal, waiting: s.queue.length, versions: s.versions })),
    rules: o.rules,
    results: { ...o.results, byActor: actors },
    changes: o.changes,
  };
}

const ID = (b: Record<string, unknown>) => (typeof b.inmobiliaria === "string" ? b.inmobiliaria : "");

/**
 * Una operación de Follow-up: `op` + los campos de la ruta del agente que corresponde
 * (`inmobiliaria`, `etapa`, `tarea`, `version`, `texto`, `motivo`, `tipo`, `situacion`, `hasta`…).
 */
export async function runFollowupOp(op: unknown, b: Record<string, unknown>, actor: Operator, origin: string) {
  const task = { agencyId: b.inmobiliaria, stage: b.etapa, action: b.tarea, versionId: b.version };
  const guard = async () => {
    if (!ID(b)) return;
    const { queue } = await agentQueue(actor.id, 500);
    guardClaim(queue.find((q) => q.agencyId === ID(b)), actor);
  };
  switch (op) {
    case "queue":
      return agentQueue(actor.id, Number(b.limite) || 50);
    case "claim":
      await guard();
      return claimNext({ agencyId: b.inmobiliaria }, origin, actor);
    case "open":
      await guard();
      return openExecution(task, actor);
    case "confirm":
      await guard();
      return confirmExecution({ ...task, text: b.texto }, actor);
    case "fail":
      await guard();
      return failExecution({ ...task, reason: b.motivo, kind: b.tipo }, actor);
    case "release":
      await guard();
      return releaseClaim(b.inmobiliaria, actor.id);
    case "situation":
      if (!ID(b)) throw new HttpError(400, "Falta la inmobiliaria.");
      return setSituation(ID(b), b.situacion, b.texto, actor);
    case "reply":
      return typeof b.id === "string"
        ? processReply(b.id, { classification: b.clasificacion, until: b.hasta, contactName: b.contactoNombre, contactWhatsapp: b.contactoWhatsapp, facu: b.facu, note: b.nota }, actor)
        : registerReply(
            { agencyId: b.inmobiliaria, text: b.texto, receivedAt: b.hora, classification: b.clasificacion, confidence: b.confianza, note: b.nota, until: b.hasta, contactName: b.contactoNombre, contactWhatsapp: b.contactoWhatsapp },
            actor,
          );
    case "replies":
      return { replies: await inbox() };
    case "snooze":
      if (!ID(b)) throw new HttpError(400, "Falta la inmobiliaria.");
      return b.volver === true ? unsnooze(ID(b), actor.id, actor.name) : snooze(ID(b), b.hasta, b.motivo, actor);
    case "priority":
      if (!ID(b)) throw new HttpError(400, "Falta la inmobiliaria.");
      return setPriority(ID(b), b.prioridad, actor.id, actor.name);
    case "version-create":
      return createVersion((b.valores as Record<string, unknown>) ?? {}, actor.id);
    case "version-update":
      return updateVersion(b.id, (b.valores as Record<string, unknown>) ?? {}, actor);
    case "version-status":
      return setVersionStatus(b.id, b.estado);
    case "rule-save":
      return saveRule(b.key, (b.valores as Record<string, unknown>) ?? {}, actor);
    case "stage-create":
      return createStage((b.valores as Record<string, unknown>) ?? {});
    case "state-save": {
      const values = (b.valores as Record<string, unknown>) ?? {};
      return values.base ? changeBaseSituation(values, false) : updateStateCatalog(values, actor.id);
    }
    case "state-delete": {
      const values = (b.valores as Record<string, unknown>) ?? {};
      return values.base ? changeBaseSituation(values, true) : removeCustomSituation(values);
    }
    default:
      throw new HttpError(400, "Operación de Follow-up desconocida.");
  }
}
