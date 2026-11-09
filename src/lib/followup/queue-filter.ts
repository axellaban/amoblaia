/**
 * Los filtros de la cola de ejecución: etapa, regla, situación, tipo de trabajo
 * y búsqueda. La pantalla y el servidor usan esta misma función, así «Tomar la
 * próxima» toma solo lo que se ve con los filtros elegidos.
 */
import { GROUPS, SITUATIONS, type Group, type Situation } from "./plan";
import { compatible, type Rule } from "./rules";
import { FOLLOWUP_STAGES, type StageKey } from "./stages";

/** Lo que el motor eligió para una inmobiliaria, lo justo para filtrarla. */
export type Filterable = { stage: StageKey; ruleKey: string | null; situation: Situation; group: Group; name: string };

export type QueueFilter = {
  stage: StageKey | null;
  /** La clave de la regla (`ruleKey`), u `OTHER_RULES`: las que no salen de una regla activa de la etapa. */
  rule: string | null;
  situation: Situation | null;
  group: Group | null;
  search: string;
};
export const OTHER_RULES = "otras";
export const NO_FILTER: QueueFilter = { stage: null, rule: null, situation: null, group: null, search: "" };

/** Las reglas de la etapa que pueden elegir una acción: activas, de su etapa y en orden. */
export function stageRules(rules: Rule[], stage: StageKey) {
  return rules.filter((r) => r.enabled && r.stage === stage && compatible(stage, r.action) && (!r.after_action || compatible(stage, r.after_action))).sort((a, b) => a.position - b.position);
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/** Si la inmobiliaria entra en el filtro. `rules`: todas (para saber qué es «Otras»). */
export function matchesFilter(q: Filterable, f: QueueFilter, rules: Rule[]) {
  if (f.stage && q.stage !== f.stage) return false;
  if (f.rule) {
    if (f.rule === OTHER_RULES) {
      if (q.ruleKey && stageRules(rules, q.stage).some((r) => r.key === q.ruleKey)) return false;
    } else if (q.ruleKey !== f.rule) return false;
  }
  if (f.situation && q.situation !== f.situation) return false;
  if (f.group && q.group !== f.group) return false;
  const term = norm(f.search);
  if (term && !norm(q.name).includes(term)) return false;
  return true;
}

/** El filtro que manda la pantalla (o la extensión), limpio: lo desconocido se ignora. */
export function cleanFilter(raw: unknown): QueueFilter {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const stage = str(o.etapa ?? o.stage);
  const situation = str(o.situacion ?? o.situation);
  const group = str(o.grupo ?? o.group);
  const rule = str(o.regla ?? o.rule);
  return {
    stage: FOLLOWUP_STAGES.some((s) => s.key === stage) ? (stage as StageKey) : null,
    rule: rule ? rule.slice(0, 120) : null,
    situation: situation in SITUATIONS ? (situation as Situation) : null,
    group: group in GROUPS ? (group as Group) : null,
    search: str(o.buscar ?? o.search).slice(0, 120),
  };
}

export const isEmptyFilter = (f: QueueFilter) => !f.stage && !f.rule && !f.situation && !f.group && !f.search.trim();

/**
 * La próxima para tomar: la primera de la cola (ya recalculada y en orden) que
 * entra en el filtro, no está en `skip` y no la tiene otra sesión. `lock` la
 * reserva en la base; si otra sesión la ganó (false), sigue con la siguiente.
 * Recorre la cola una sola vez: termina aunque ninguna se pueda tomar.
 */
export async function pickNext<T extends Filterable & { agencyId: string; claim: { actorId: string; until: string } | null }>(
  queue: T[],
  f: { filter: QueueFilter; rules: Rule[]; skip?: Iterable<string>; actorId: string; now?: string },
  lock: (it: T) => Promise<boolean>,
): Promise<T | null> {
  const skip = new Set(f.skip ?? []);
  for (const it of queue) {
    if (skip.has(it.agencyId) || !matchesFilter(it, f.filter, f.rules)) continue;
    if (it.claim && it.claim.until > (f.now ?? new Date().toISOString()) && it.claim.actorId !== f.actorId) continue;
    if (await lock(it)) return it;
  }
  return null;
}
