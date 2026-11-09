"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Building2, CalendarDays, CheckCheck, ChevronDown, ChevronRight, ClipboardCopy, Copy, GripVertical, Info, KeyRound, Layers, Link2, MessageCircle, MessageSquare, MoreVertical, Pencil, Phone, Plus, RefreshCw, Send, Tag, Target, Trash2, Undo2, Video, X } from "lucide-react";
import { api } from "@/components/admin-demos";
import { CTA_KEYS, CTA_LABEL, COMMERCIAL_STAGES, FOLLOWUP_STAGES, OUT, VARIABLES, commercialOf, technicalOf, technicalStateLabel, fillMessage, missingVariables, pct, type Channel, type Cta, type CommercialStageKey, type StageKey, type VersionStatus } from "@/lib/followup/stages";
import { GROUPS, REPLY_CLASSES, SITUATIONS, QUEUE_ORDERS, actionLabel, actionsOf, byQueueOrder, commercialTier, compatible, splitMessages, type QueueOrder, type Action, type ReplyClass, type Situation } from "@/lib/followup/plan";
import type { Change, FunnelStep, InboxItem, Prepared, QueueItem, QueueSummary, QueueView, Results, StageView } from "@/lib/followup/server";
import { NO_FILTER, OTHER_RULES, isEmptyFilter, matchesFilter, stageRules, type QueueFilter } from "@/lib/followup/queue-filter";
import type { CohortRow, WindowKey } from "@/lib/followup/results";
import { daysText, type Rule } from "@/lib/followup/rules";


/** Presentational-only stage glyphs; stage filters keep their original callbacks. */
const STAGE_GLYPH: Record<CommercialStageKey, typeof Layers> = {
  prospectado: Send,
  contactado: MessageCircle,
  interesado: Target,
  "demo-enviada": Video,
  "cuenta-creada": Building2,
  "cuenta-activa": CheckCheck,
  cliente: Layers,
};

type Version = StageView["versions"][number];
type Exec = QueueItem["execution"];

const STATUS_LABEL: Record<VersionStatus | "draft", string> = { active: "Activa", test: "A prueba", archived: "Archivada", draft: "Borrador" };
const EXEC_LABEL = { pending: "Pendiente", opened: "Abierto", sent: "Enviado", failed: "No salió" } as const;
const PAGE = 25;

function ago(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return days <= 0 ? "hoy" : days === 1 ? "hace 1 día" : `hace ${days} días`;
}
const SOURCE_LABEL = { followup: "Follow-up", adquisicion: "Adquisición", inmobiliaria: "La inmobiliaria" } as const;
const day = (iso: string) => new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "short", timeZone: "America/Argentina/Buenos_Aires" });
async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

type View = "cola" | "respuestas" | Mode;
const VIEWS: { key: View; label: string; soon?: string }[] = [
  { key: "cola", label: "Cola de ejecución" },
  { key: "respuestas", label: "Respuestas" },
  { key: "embudo", label: "Embudo" },
  { key: "reglas", label: "Estados y reglas" },
  { key: "resultados", label: "Resultados" },
];

/** /admin/follow-up: pestañas como en la especificación; la cola de ejecución es la pantalla principal. */
export function FollowupBoard({
  stages,
  queue,
  blocked,
  noInteresados,
  summary,
  inbox,
  funnel,
  rules,
  changes,
  results,
  generatedAt,
}: {
  stages: StageView[];
  queue: QueueItem[];
  blocked: QueueItem[];
  noInteresados: QueueItem[];
  summary: QueueSummary;
  inbox: InboxItem[];
  funnel: FunnelStep[];
  rules: Rule[];
  changes: Change[];
  results: Results;
  generatedAt: string;
}) {
  const [queueState, setQueueState] = useState<QueueState>(QUEUE_START);
  const initial = useMemo<QueueView>(() => ({ queue, blocked, noInteresados, summary, rules, generatedAt }), [queue, blocked, noInteresados, summary, rules, generatedAt]);
  const [view, setView] = useState<View>(() => {
    if (typeof window === "undefined") return "cola";
    const v = new URLSearchParams(window.location.search).get("vista");
    return v === "respuestas" || v === "embudo" || v === "reglas" || v === "resultados" ? v : "cola";
  });
  function go(v: View) {
    setView(v);
    const url = new URL(window.location.href);
    if (v === "cola") url.searchParams.delete("vista");
    else url.searchParams.set("vista", v);
    window.history.replaceState(null, "", url);
  }
  return (
    <>
      <nav className="fu-tabs" aria-label="Vistas de Follow-up" data-testid="followup-tabs">
        {VIEWS.map((t) =>
          t.soon ? (
            <span key={t.key} className="fu-tab is-soon" aria-disabled="true" title={`Llega en la ${t.soon}`}>
              {t.label} <small>· {t.soon}</small>
            </span>
          ) : (
            <button key={t.key} type="button" className={`fu-tab${view === t.key ? " is-on" : ""}`} aria-current={view === t.key ? "page" : undefined} data-testid={`followup-tab-${t.key}`} onClick={() => go(t.key as View)}>
              {t.label}
              {t.key === "respuestas" && inbox.length > 0 ? ` · ${inbox.length}` : ""}
            </button>
          ),
        )}
      </nav>
      {view === "cola" ? (
        <ExecCenter initial={initial} stages={stages} inboxCount={inbox.length} state={queueState} setState={setQueueState} onReplies={() => go("respuestas")} />
      ) : view === "respuestas" ? (
        <Inbox inbox={inbox} agencies={[...queue, ...blocked, ...noInteresados]} />
      ) : view === "embudo" ? (
        <Funnel funnel={funnel} stages={stages} rules={rules} onRules={() => go("reglas")} />
      ) : view === "resultados" ? (
        <ResultsView results={results} />
      ) : (
        <>
          <p className="fu-note fu-viewnote">
            Cuándo se dispara cada paso (las reglas: se cambian acá, sin deploy) y su mensaje de cada paso, sus versiones A/B, sus observaciones para la extensión y sus call to actions. La versión es la variante del mensaje; el paso (seguimiento 1, 2…) es el momento de la secuencia.
          </p>
          <RulesWorkspace stages={stages} rules={rules} changes={changes} />
        </>
      )}
    </>
  );
}

type Filter = "listas" | "respuestas" | "demos" | "bloqueadas";
const QPAGE = 25;
const PRIORITY_LABEL = { alta: "Alta", media: "Media", baja: "Baja" } as const;
const isReply = (q: QueueItem) => q.group === "respuestas";
/** Cada cuánto se vuelve a pedir la cola mientras la pestaña está a la vista. */
const POLL_MS = 45_000;

/** Los filtros elegidos en la cola: quedan aunque se cambie de pestaña o se ejecute una tras otra. */
export type QueueState = { kpi: Filter; f: QueueFilter };
export const QUEUE_START: QueueState = { kpi: "listas", f: NO_FILTER };

/** La regla de la inmobiliaria (la que eligió su próxima acción), si existe. */
const ruleOf = (rules: Rule[], q: QueueItem) => (q.ruleKey ? rules.find((r) => r.key === q.ruleKey) ?? null : null);

/** Qué pasa al confirmar el envío, sin prometer que avance de etapa: solo lo que hacen el registro y las reglas. */
function afterConfirm(q: QueueItem, rules: Rule[]) {
  if (!q.action) return "";
  const next = stageRules(rules, q.stage).find((r) => r.after_action === q.action && (!r.situations.length || r.situations.includes(q.situation)));
  const first = q.stage === "no-contactado" ? " Como es el primer contacto, la inmobiliaria pasa a «Contactado»." : "";
  const demo = q.stage === "sin-enviar" ? " Su demo queda marcada como enviada." : "";
  const tail = next
    ? ` Si no responde, «${actionLabel(q.stage, next.action)}» se programa ${next.after_hours ? `a las ${next.after_hours} h` : "enseguida"}, según las reglas vigentes.`
    : " Si no responde, esta etapa no tiene otro paso programado después de este.";
  return `Al confirmar el envío de «${q.actionLabel}», Habita registra esta acción.${first}${demo}${tail}`;
}

/**
 * Centro de ejecución: los 4 números (cada uno filtra), la cola por etapa y por
 * regla, la tabla y, a la derecha, la siguiente recomendada o la que se está
 * ejecutando. «Tomar la próxima» y «Siguiente contacto» piden al servidor la
 * próxima que entra en los filtros elegidos (no la de la lista guardada acá).
 */
function ExecCenter({
  initial,
  stages,
  inboxCount,
  state,
  setState,
  onReplies,
}: {
  initial: QueueView;
  stages: StageView[];
  inboxCount: number;
  state: QueueState;
  setState: (s: QueueState) => void;
  onReplies: () => void;
}) {
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [pollError, setPollError] = useState("");
  const [shown, setShown] = useState(QPAGE);
  const [order, setOrder] = useState<QueueOrder>("comercial");
  const [showClosed, setShowClosed] = useState(false);
  // La que se está ejecutando: queda en el panel aunque la cola actualizada ya no la traiga (se confirmó, avanzó).
  const [detail, setDetail] = useState<{ id: string; item: QueueItem; prepared: Prepared | null } | null>(null);
  const [done, setDone] = useState<Record<string, Exec>>({});
  const [taking, setTaking] = useState(false);
  const [error, setError] = useState("");
  // Lo que trae la página (al volver a cargarla) reemplaza a lo consultado si es más nuevo.
  useEffect(() => {
    setData((d) => (initial.generatedAt > d.generatedAt ? initial : d));
  }, [initial]);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const fresh = await api<QueueView>("/api/admin/follow-up/cola");
      setData(fresh);
      setPollError("");
    } catch (e) {
      setPollError(e instanceof Error ? e.message : "No pudimos actualizar la cola.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const t = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, POLL_MS);
    return () => window.clearInterval(t);
  }, [refresh]);

  const { kpi, f } = state;
  const { queue, blocked, noInteresados, summary, rules } = data;
  const live = new Date().toISOString();
  const statusOf = (q: QueueItem) => (q.agencyId in done ? done[q.agencyId] : q.execution);
  const all = [...queue, ...blocked, ...noInteresados];
  const closedView = showClosed && kpi === "listas" && (f.commercial === "contactado" || f.stage === "no-responde");
  const base =
    closedView ? noInteresados : kpi === "bloqueadas"
      ? blocked
      : kpi === "respuestas"
        ? all.filter((q) => isReply(q) && !q.snoozedUntil)
        : kpi === "demos"
          ? all.filter((q) => q.group === "demos" && !q.snoozedUntil)
          : queue;
  const fits = (q: QueueItem, g: QueueFilter) => matchesFilter(q, g, rules);
  const list = base.filter((q) => fits(q, f)).sort((a, b) => byQueueOrder(a, b, order));
  const stage = f.stage ? stages.find((s) => s.key === f.stage) ?? null : null;
  const commercial = f.commercial ?? (f.stage ? commercialOf(f.stage) : null);
  const selectedTechnical = commercial ? technicalOf(commercial) : [];
  const own = f.stage ? stageRules(rules, f.stage) : [];
  const rule = f.rule && f.rule !== OTHER_RULES ? rules.find((r) => r.key === f.rule) ?? null : null;
  const count = (g: QueueFilter) => base.filter((q) => fits(q, g)).length;
  const others = f.stage ? count({ ...f, rule: OTHER_RULES }) : 0;
  const isFree = (q: QueueItem) => statusOf(q)?.status !== "sent" && !q.blocked && !(q.claim && q.claim.until > live);
  const free = closedView ? [] : list.filter(isFree);
  const kpiGroup = kpi === "respuestas" ? "respuestas" : kpi === "demos" ? "demos" : null;
  const situations = (Object.keys(SITUATIONS) as Situation[]).map((k) => ({ key: k, n: count({ ...f, situation: k }) })).filter((x) => x.n > 0 || x.key === f.situation);
  const groupCounts = (Object.keys(GROUPS) as (keyof typeof GROUPS)[]).map((k) => ({ key: k, n: count({ ...f, group: k }) }));
  const setF = (patch: Partial<QueueFilter>) => {
    setState({ kpi, f: { ...f, ...patch } });
    setShown(QPAGE);
  };

  /** Toma la próxima que entra en los filtros (el servidor recalcula la cola y la reserva). `skip`: las que ya se trabajaron. */
  async function takeNext(skip: string[] = []) {
    setTaking(true);
    setError("");
    try {
      const filtro = { etapa: f.stage, etapaComercial: f.commercial, imagen: f.demoImage, regla: f.rule, situacion: f.situation, grupo: f.group ?? kpiGroup, buscar: f.search, orden: order };
      const p = await api<Prepared | null>("/api/admin/followup/claim", { method: "POST", body: JSON.stringify({ filtro, saltar: skip }) });
      if (!p) {
        setDetail(null);
        setError(skip.length ? "Listo: no queda ninguna libre con estos filtros." : "No queda ninguna libre con estos filtros.");
        void refresh();
      } else setDetail({ id: p.agencyId, item: p.item, prepared: p });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos tomar la próxima.");
    } finally {
      setTaking(false);
    }
  }
  const execute = (q: QueueItem) => {
    setError("");
    setDetail({ id: q.agencyId, item: q, prepared: null });
  };

  const kpis: { key: Filter; label: string; value: number; hint: string }[] = [
    { key: "listas", label: "Acciones listas", value: summary.ready, hint: summary.claimed ? `listas ahora · ${summary.claimed} tomadas por otra sesión` : "contactos listos para ejecutar ahora" },
    { key: "respuestas", label: "Respuestas nuevas", value: summary.replies, hint: "en la bandeja y por contestar" },
    { key: "demos", label: "Demos pendientes", value: summary.demos, hint: "por crear o por enviar" },
    { key: "bloqueadas", label: "Bloqueadas", value: summary.blocked, hint: summary.scheduled ? `con motivo · ${summary.scheduled} programadas` : "cada una con su motivo" },
  ];
  const reasons = Object.entries(
    blocked.reduce<Record<string, number>>((acc, q) => {
      const k = (q.blocked ?? "").replace(/[:(].*$/, "").replace(/\.$/, "").trim();
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);
  const ruleName = rule && f.stage ? ruleTitle(f.stage, rule) : f.rule === OTHER_RULES ? "Otras" : null;
  const heading = closedView ? `Contactado — ${list.length} no interesados` : `${stage?.title ?? "Todas las etapas"}${ruleName ? ` — ${ruleName}` : ""} — ${list.length} ${kpi === "bloqueadas" ? (list.length === 1 ? "bloqueada" : "bloqueadas") : list.length === 1 ? "lista" : "listos"}`;
  const banner = closedView ? "Oportunidades cerradas como No interesado. Podés corregir etapa y estado; estas inmobiliarias no reciben acciones automáticas." : !stage
    ? "Estás viendo todas las etapas. Elegí una etapa y una regla para trabajar sus contactos uno detrás de otro."
    : rule
      ? `Estás viendo la etapa ${stage.title} con la regla ${ruleTitle(stage.key, rule)}. Se muestran solo los contactos cuya próxima acción es «${actionLabel(stage.key, rule.action as Action)}»: ${ruleWhen(stage.key, rule).replace(/^Si /, "si ")}.`
      : f.rule === OTHER_RULES
        ? `Estás viendo la etapa ${stage.title}: los contactos cuya próxima acción no sale de una de sus reglas activas.`
        : `Estás viendo la etapa ${stage.title} con todas sus reglas.`;
  const item = detail ? all.find((q) => q.agencyId === detail.id) ?? detail.item : null;
  const recommended = free[0] ?? null;

  return (
    <section className="fu-center" data-testid="followup-queue">
      <div className="fu-kpis">
        {kpis.map((k) => (
          <button
            key={k.key}
            type="button"
            className={`fu-kpi${kpi === k.key ? " is-on" : ""} is-${k.key}`}
            data-testid={`followup-kpi-${k.key}`}
            aria-pressed={kpi === k.key}
            onClick={() => {
              if (k.key === "respuestas" && kpi === "respuestas") return onReplies();
              setState({ kpi: k.key, f: { ...f, group: null } });
              setShown(QPAGE);
            }}
          >
            <span className="fu-workspace-kpi-label">
              <span className="fu-workspace-kpi-symbol" aria-hidden="true">
                {k.key === "listas" ? <Target size={19} /> : k.key === "respuestas" ? <MessageSquare size={19} /> : k.key === "demos" ? <Video size={19} /> : <KeyRound size={19} />}
              </span>
              <span>{k.label}</span>
            </span>
            <b>{k.value}</b>
            <small>{k.hint}</small>
          </button>
        ))}
      </div>

      <div className="fu-qbar" data-testid="followup-queue-stages">
        <span className="fu-qbarlabel">Cola por etapa comercial</span>
        <div className="fu-qchips">
          <button type="button" className={`fu-qchip${!commercial ? " is-on" : ""}`} aria-pressed={!commercial} data-testid="followup-queue-stage" data-stage="" onClick={() => setF({ commercial: null, stage: null, demoImage: null, rule: null })}>
            <span className="fu-stage-glyph" aria-hidden="true"><Layers size={19} /></span>
            <span className="fu-stage-tile-copy"><span>Todas</span><b>{count({ ...f, commercial: null, stage: null, rule: null })}</b></span>
          </button>
          {COMMERCIAL_STAGES.map((s) => {
            const Icon = STAGE_GLYPH[s.key];
            return (
              <button key={s.key} type="button" className={`fu-qchip${commercial === s.key ? " is-on" : ""}`}
                aria-pressed={commercial === s.key} data-testid="followup-queue-stage" data-stage={s.key}
                onClick={() => setF({ commercial: s.key, stage: null, demoImage: null, rule: null })}>
                <span className="fu-stage-glyph" aria-hidden="true"><Icon size={19} /></span>
                <span className="fu-stage-tile-copy"><span>{s.title}</span><b>{count({ ...f, commercial: s.key, stage: null, rule: null })}</b></span>
              </button>
            );
          })}
        </div>
        <button type="button" className="fu-qchip is-replies" data-testid="followup-queue-replies" onClick={onReplies}>
          <MessageSquare size={14} aria-hidden="true" /> Respuestas nuevas <b>{inboxCount}</b>
        </button>
      </div>

      {commercial && (
        <div className="fu-qbar is-rules" data-testid="followup-queue-substages">
          <span className="fu-qbarlabel">Estado de avance</span>
          <div className="fu-qchips">
            <button type="button" className={`fu-qchip is-sm${!f.stage ? " is-on" : ""}`} aria-pressed={!f.stage} onClick={() => setF({ stage: null, demoImage: null, rule: null })}>
              Todos <b>{count({ ...f, commercial, stage: null, rule: null })}</b>
            </button>
            {selectedTechnical.map((key) => (
              <button key={key} type="button" className={`fu-qchip is-sm${f.stage === key ? " is-on" : ""}`}
                data-testid="followup-queue-technical-stage" data-stage={key} aria-pressed={f.stage === key}
                onClick={() => setF({ stage: key, demoImage: null, rule: null })}>
                {technicalStateLabel(key)} <b>{count({ ...f, commercial, stage: key, rule: null })}</b>
              </button>
            ))}
          </div>
        </div>
      )}

      {commercial === "demo-enviada" && (
        <div className="fu-qbar is-rules" data-testid="followup-queue-demo-image">
          <span className="fu-qbarlabel">Interacción de la demo</span>
          <div className="fu-qchips">
            <button type="button" className={`fu-qchip is-sm${!f.demoImage ? " is-on" : ""}`} onClick={() => setF({ demoImage: null, stage: "sin-cuenta", rule: null })}>
              Todas <b>{count({ ...f, commercial, stage: "sin-cuenta", demoImage: null, rule: null })}</b>
            </button>
            <button type="button" className={`fu-qchip is-sm${f.demoImage === "interacted" ? " is-on" : ""}`} data-testid="followup-demo-interacted" onClick={() => setF({ stage: "sin-cuenta", demoImage: "interacted", rule: null })}>
              Interactuó <b>{count({ ...f, commercial, stage: "sin-cuenta", demoImage: "interacted", rule: null })}</b>
            </button>
            <button type="button" className={`fu-qchip is-sm${f.demoImage === "generated" ? " is-on" : ""}`} data-testid="followup-demo-generated" onClick={() => setF({ stage: "sin-cuenta", demoImage: "generated", rule: null })}>
              Generó imagen <b>{count({ ...f, commercial, stage: "sin-cuenta", demoImage: "generated", rule: null })}</b>
            </button>
          </div>
        </div>
      )}

      {stage && (
        <div className="fu-qbar is-rules" data-testid="followup-queue-rules" data-stage={stage.key}>
          <span className="fu-qbarlabel">Reglas de {stage.title}</span>
          <div className="fu-qchips">
            <button type="button" className={`fu-qchip is-sm${!f.rule ? " is-on" : ""}`} aria-pressed={!f.rule} data-testid="followup-queue-rule" data-rule="" onClick={() => setF({ rule: null })}>
              Todas <b>{count({ ...f, rule: null })}</b>
            </button>
            {own.map((r) => (
              <button
                key={r.key}
                type="button"
                className={`fu-qchip is-sm${f.rule === r.key ? " is-on" : ""}`}
                aria-pressed={f.rule === r.key}
                data-testid="followup-queue-rule"
                data-rule={r.key}
                title={ruleWhen(stage.key, r)}
                onClick={() => setF({ rule: r.key })}
              >
                {ruleTitle(stage.key, r)} <b>{count({ ...f, rule: r.key })}</b>
              </button>
            ))}
            {(others > 0 || f.rule === OTHER_RULES) && (
              <button type="button" className={`fu-qchip is-sm${f.rule === OTHER_RULES ? " is-on" : ""}`} aria-pressed={f.rule === OTHER_RULES} data-testid="followup-queue-rule" data-rule={OTHER_RULES} onClick={() => setF({ rule: OTHER_RULES })}>
                Otras <b>{others}</b>
              </button>
            )}
          </div>
        </div>
      )}

      {(commercial === "contactado") && (
        <div className="fu-qbar" data-testid="followup-contact-closed">
          <span className="fu-qbarlabel">Resultado del contacto</span>
          <button type="button" className={`fu-qchip is-sm${!closedView ? " is-on" : ""}`} aria-pressed={!closedView}
            onClick={() => { setShowClosed(false); setShown(QPAGE); }}>Pendientes de acción</button>
          <button type="button" className={`fu-qchip is-sm${closedView ? " is-on" : ""}`} aria-pressed={closedView}
            data-testid="followup-no-interesados" onClick={() => { setShowClosed(true); setDetail(null); setF({ situation: null, rule: null, group: null }); setShown(QPAGE); }}>
            No interesados <b>{noInteresados.length}</b>
          </button>
          <span className="fu-note">Cerrados para esta campaña · sin envíos automáticos</span>
        </div>
      )}

      {commercial === "prospectado" && (
        <div className="fu-qbanner" data-testid="followup-first-contact-capacity">
          <Info size={16} aria-hidden="true" />
          <span>Primeros contactos · ventana móvil de 24 h: <b>{summary.newToday}/{summary.cap}</b> registrados.
            <b> {summary.newRemaining} cupos restantes</b>{summary.newWaiting ? ` · ${summary.newWaiting} esperan cupo` : ""}.
            Los mensajes enviados fuera de Habita no se pueden contar automáticamente.
          </span>
        </div>
      )}
      <div className="fu-qbanner" data-testid="followup-queue-banner">
        <Info size={16} aria-hidden="true" />
        <span className="fu-grow">{banner}</span>
        <span className={`fu-qsync${pollError ? " is-error" : ""}`} data-testid="followup-queue-sync" role={pollError ? "alert" : "status"}>
          <span className="fu-qdot" aria-hidden="true" />
          {loading ? "Actualizando…" : pollError ? `No se pudo actualizar (${pollError})` : `Actualizada a las ${hhmm(data.generatedAt)} · cada 45 s`}
        </span>
        <button type="button" className="fu-iconbtn" aria-label="Actualizar la cola" title="Actualizar" data-testid="followup-queue-refresh" disabled={loading} onClick={() => void refresh()}>
          <RefreshCw size={15} aria-hidden="true" className={loading ? "fu-spin" : undefined} />
        </button>
      </div>

      {error && (
        <p className="fu-error" role="alert" data-testid="followup-queue-error">
          {error}
        </p>
      )}

      <div className={`fu-qgrid${kpi === "bloqueadas" ? " is-wide" : ""}`}>
        <div className="fu-qcard">
          <div className="fu-qcardhead">
            <h2 data-testid="followup-queue-heading">{heading}</h2>
            <div className="fu-qtools">
              <label className="fu-qsel">
                <span>Ordenar</span>
                <select data-testid="followup-queue-order" value={order} onChange={(e) => { setOrder(e.target.value as QueueOrder); setShown(QPAGE); }}>
                  {(Object.entries(QUEUE_ORDERS) as [QueueOrder, string][]).map(([key, title]) => <option key={key} value={key}>{title}</option>)}
                </select>
              </label>
              <label className="fu-qsel">
                <span>Situación</span>
                <select data-testid="followup-filter-situation" value={f.situation ?? ""} onChange={(e) => setF({ situation: (e.target.value || null) as Situation | null })}>
                  <option value="">Todas</option>
                  {situations.map((x) => (
                    <option key={x.key} value={x.key}>
                      {SITUATIONS[x.key]} · {x.n}
                    </option>
                  ))}
                </select>
              </label>
              <label className="fu-qsel">
                <span>Tipo</span>
                <select data-testid="followup-filter-group" value={f.group ?? ""} onChange={(e) => setF({ group: (e.target.value || null) as QueueFilter["group"] })}>
                  <option value="">Todos</option>
                  {groupCounts.map((g) => (
                    <option key={g.key} value={g.key} disabled={!g.n && f.group !== g.key}>
                      {GROUPS[g.key]} · {g.n}
                    </option>
                  ))}
                </select>
              </label>
              <label className="fu-search">
                <span className="sr-only">Buscar inmobiliaria</span>
                <input type="search" data-testid="followup-filter-search" placeholder="Buscar inmobiliaria" value={f.search} onChange={(e) => setF({ search: e.target.value })} />
              </label>
              <button type="button" className="button button-primary button-small" data-testid="followup-take-next" disabled={taking || kpi === "bloqueadas" || !free.length} onClick={() => void takeNext()}>
                {taking ? "Tomando…" : "Tomar la próxima →"}
              </button>
            </div>
          </div>
          {kpi === "bloqueadas" && reasons.length > 0 && (
            <div className="fu-reasons" data-testid="followup-block-reasons">
              {reasons.map(([r, n]) => (
                <span key={r}>
                  {r} · <b>{n}</b>
                </span>
              ))}
            </div>
          )}
          {list.length === 0 ? (
            <p className="fu-empty">{kpi === "listas" ? (isEmptyFilter(f) ? "No hay nada para ejecutar ahora. Mirá las bloqueadas para ver por qué." : "No hay contactos listos con estos filtros.") : "No hay inmobiliarias en este filtro."}</p>
          ) : (
            <div className="fu-qlist">
              <div className="fu-qwide fu-qwide-q">
                <div className="fu-qrow fu-qrow-q fu-qth" aria-hidden="true">
                  <span>Score</span>
                  <span>Inmobiliaria</span>
                  <span>Ciudad</span>
                  <span>Situación</span>
                  <span>Próxima acción</span>
                  <span>Última acción</span>
                  <span>WhatsApp</span>
                  <span>Prioridad</span>
                  <span />
                </div>
                {list.slice(0, shown).map((q) => {
                  const exec = statusOf(q);
                  const status = exec?.status ?? "pending";
                  const busy = Boolean(q.claim && q.claim.until > live) && q.agencyId !== detail?.id;
                  const isBlocked = Boolean(q.blocked) && status !== "sent";
                  return (
                    <div
                      key={q.agencyId}
                      className={`fu-qi${q.agencyId === detail?.id ? " is-on" : ""}`}
                      data-testid="followup-queue-item"
                      data-agency={q.agencyId}
                      data-stage={q.stage}
                      data-action={q.action ?? ""}
                      data-rule={q.ruleKey ?? ""}
                      data-situation={q.situation}
                      data-status={status}
                      data-priority={q.priority}
                      data-blocked={isBlocked ? q.blocked : ""}
                    >
                      <div className="fu-qrow fu-qrow-q">
                        <span className="fu-score">{score(q.score)}</span>
                        <div className="fu-qname">
                          <Link href={`/admin/inmobiliarias/${q.agencyId}`}>{q.name}</Link>
                          <span>{f.stage ? (q.person ?? "—") : stageTitle(q.stage)}</span>
                          <QueueCorrection item={q} onSaved={() => void refresh()} />
                        </div>
                        <span className="fu-cell">{q.zone ?? "—"}</span>
                        <span className="fu-cell">
                          <span className="fu-pill is-sit">{SITUATIONS[q.situation]}</span>
                        </span>
                        <span className="fu-cell fu-bold" title={commercialTier(q).reason}>
                          {closedView ? "Sin seguimiento" : q.actionLabel ?? "—"}
                          {!closedView && <small style={{ display: "block", fontSize: "11px", fontWeight: 400, opacity: 0.75 }}>P{commercialTier(q).tier} · {commercialTier(q).reason}</small>}
                        </span>
                        <div className="fu-qact">
                          <span>{q.lastAction ? q.lastAction.text : "Sin acciones"}</span>
                          <span className={q.lastAction && daysSince(q.lastAction.at) > LATE_DAYS ? "is-late" : undefined}>{q.lastAction ? `${day(q.lastAction.at)} · ${ago(q.lastAction.at)}` : "—"}</span>
                        </div>
                        <div className="fu-qcontact">
                          <span className="fu-mono">{q.phone ?? "—"}</span>
                          <WhatsAppShortcut item={q} />
                          <span>{!q.wa ? "Sin WhatsApp" : q.needsReview ? "Sin validar" : "Validado"}</span>
                        </div>
                        <span>
                          <span className={`fu-pill is-${q.priority}`} title={q.priorityManual ? "Puesta a mano" : "Por su grupo"}>
                            {PRIORITY_LABEL[q.priority]}
                            {q.priorityManual ? " ·" : ""}
                          </span>
                        </span>
                        {closedView || !q.action ? (
                          <span className="fu-qst is-blocked">Sin acciones</span>
                        ) : isBlocked ? (
                          q.snoozedUntil ? (
                            <button type="button" className="button button-small button-outline" data-testid="followup-unsnooze" onClick={() => api("/api/admin/follow-up/inmobiliarias", { method: "POST", body: JSON.stringify({ accion: "volver", inmobiliaria: q.agencyId }) }).then(() => void refresh())}>
                              Volver a la cola
                            </button>
                          ) : (
                            <span className="fu-qst is-blocked" title={q.blocked ?? undefined}>
                              Bloqueada
                            </span>
                          )
                        ) : (
                          <button
                            type="button"
                            className={`button button-small${status === "pending" && !busy ? " button-primary" : " button-outline"}`}
                            data-testid="followup-execute"
                            disabled={busy || q.agencyId === detail?.id}
                            title={busy ? `La está ejecutando ${q.claim!.by}` : undefined}
                            onClick={() => execute(q)}
                          >
                            {busy ? `Tomada · ${q.claim!.by}` : q.agencyId === detail?.id ? "Abierta" : status === "sent" ? "Ver" : "Ejecutar"}
                          </button>
                        )}
                      </div>
                      {isBlocked && (
                        <p className="fu-blocked" data-testid="followup-blocked">
                          {q.blocked}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
              {list.length > shown && (
                <button type="button" className="fu-more" onClick={() => setShown(shown + QPAGE)}>
                  Ver {Math.min(QPAGE, list.length - shown)} más · quedan {list.length - shown}
                </button>
              )}
            </div>
          )}
          <p className="fu-note fu-qfoot">
            Conversaciones nuevas en 24 h: <b>{summary.newToday}</b> de {summary.cap} · confirmadas hoy: <b>{summary.doneToday}</b>
          </p>
        </div>

        {kpi !== "bloqueadas" && (
          <aside className="fu-qside" aria-label={item ? "Ejecución" : "Siguiente recomendada"}>
            {item ? (
              <ExecPanel
                key={item.agencyId}
                item={item}
                rules={rules}
                initialPrepared={detail?.prepared ?? null}
                exec={statusOf(item)}
                onDone={(e) => {
                  setDone((d) => ({ ...d, [item.agencyId]: e }));
                  void refresh();
                }}
                onClose={() => {
                  setDetail(null);
                  void refresh();
                }}
                onNext={() => void takeNext([...new Set([...Object.keys(done), item.agencyId])])}
                taking={taking}
              />
            ) : (
              <Recommended item={recommended} stage={recommended ? stages.find((s) => s.key === recommended.stage) ?? null : null} rules={rules} onExecute={execute} />
            )}
          </aside>
        )}
      </div>
    </section>
  );
}

/** La regla que eligió la acción, con su condición, en el recuadro verde del panel. */
function RuleBox({ q, rules }: { q: QueueItem; rules: Rule[] }) {
  const r = ruleOf(rules, q);
  return (
    <div className="fu-qrulebox" data-testid="followup-applied-rule" data-rule={q.ruleKey ?? ""}>
      <Tag size={15} aria-hidden="true" />
      <span>
        <b>Regla aplicada: {r ? ruleTitle(q.stage, r) : (q.actionLabel ?? "—")}</b>
        <small>{r ? ruleWhen(q.stage, r) : "La acción no sale de una regla activa de la etapa."}</small>
      </span>
    </div>
  );
}

/** El encabezado del panel: nombre, ciudad, score, WhatsApp y etapa. */
function PanelIdent({ q }: { q: QueueItem }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="fu-qident">
      <div className="fu-grow">
        <Link href={`/admin/inmobiliarias/${q.agencyId}`} className="fu-qidentname">
          {q.name}
        </Link>
        <span>
          {q.zone ?? "Sin ciudad"} · Score {score(q.score)}
        </span>
      </div>
      <div className="fu-qwa">
        <small>WhatsApp</small>
        <span className="fu-mono" data-testid="followup-phone">
          {q.phone ?? "sin WhatsApp"}
        </span>
        <small>{!q.wa ? "Sin WhatsApp" : q.needsReview ? "Sin validar" : "Validado"}</small>
      </div>
      {q.phone && (
        <button type="button" className="fu-iconbtn" aria-label="Copiar el número" title={copied ? "Copiado" : "Copiar el número"} onClick={() => void copy(q.phone!).then(setCopied)}>
          <ClipboardCopy size={15} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/** Sin nada tomado: la primera libre con los filtros elegidos, para ver qué sale antes de tomarla. */
function Recommended({ item: q, stage, rules, onExecute }: { item: QueueItem | null; stage: StageView | null; rules: Rule[]; onExecute: (q: QueueItem) => void }) {
  if (!q)
    return (
      <div className="fu-qpanel" data-testid="followup-recommended">
        <div className="fu-qpanelhead">
          <Target size={17} aria-hidden="true" />
          <b>Siguiente recomendada</b>
        </div>
        <p className="fu-empty">No queda ningún contacto libre con estos filtros.</p>
      </div>
    );
  const v = stage?.versions.find((x) => x.id === q.versionId) ?? null;
  const preview = v ? splitMessages(fillMessage(v.body, { inmobiliaria: q.shortName, decisor: q.person })) : [];
  const hours = q.window ? `${daysText(q.window.days)}, de ${q.window.hours_from} a ${q.window.hours_to}` : "Lunes a sábado";
  const checks = [
    { label: "Número validado", ok: Boolean(q.wa) && !q.needsReview, note: !q.wa ? "Falta su WhatsApp" : q.needsReview ? "Se valida al confirmar el envío" : "" },
    { label: `Situación: ${SITUATIONS[q.situation]}`, ok: true, note: "" },
    { label: `Regla: ${ruleOf(rules, q) ? ruleTitle(q.stage, ruleOf(rules, q)!) : (q.actionLabel ?? "—")}`, ok: Boolean(q.ruleKey), note: "" },
    { label: "Horario permitido", ok: !q.blocked, note: hours },
  ];
  return (
    <div className="fu-qpanel" data-testid="followup-recommended" data-agency={q.agencyId}>
      <div className="fu-qpanelhead">
        <Target size={17} aria-hidden="true" />
        <b>Siguiente recomendada</b>
        <span className="fu-grow" />
        <span className="fu-qstage">{stageTitle(q.stage)}</span>
      </div>
      <PanelIdent q={q} />
      <RuleBox q={q} rules={rules} />
      <button type="button" className="button button-primary fu-qbig" data-testid="followup-recommended-execute" onClick={() => onExecute(q)}>
        <Send size={15} aria-hidden="true" /> Ejecutar esta
      </button>
      <div className="fu-qline">
        <span className="fu-lbl">Situación</span>
        <span className="fu-pill is-sit">{SITUATIONS[q.situation]}</span>
      </div>
      <details className="fu-recommended-details" data-testid="followup-recommended-context">
        <summary>Contexto e historial <ChevronDown size={15} aria-hidden="true" /></summary>
        <div className="fu-qtwo">
        <div className="fu-qbox">
          <b>Contexto</b>
          <span>
            {q.website ? host(q.website) : "Sin web"} · {q.properties} propiedades
          </span>
          {q.address && <span>{q.address}</span>}
          <span>En el mensaje: «{q.shortName}»</span>
        </div>
        <div className="fu-qbox">
          <b>Última acción</b>
          {q.lastAction ? (
            <>
              <span>{ago(q.lastAction.at)}</span>
              <span>{q.lastAction.text}</span>
            </>
          ) : (
            <span>Sin acciones todavía</span>
          )}
        </div>
      </div>
      </details>
      <details className="fu-recommended-details" data-testid="followup-recommended-flow">
        <summary>Próximo paso del flujo <ChevronDown size={15} aria-hidden="true" /></summary>
        <p className="fu-qflow">
          <ArrowRight size={14} aria-hidden="true" /> {afterConfirm(q, rules)}
        </p>
      </details>
      <details className="fu-recommended-details" data-testid="followup-recommended-preparation">
        <summary>Validaciones y mensaje <ChevronDown size={15} aria-hidden="true" /></summary>
        <div className="fu-qtwo is-msg">
        <div className="fu-qbox">
          <b>Antes de enviar</b>
          <ul className="fu-qchecks">
            {checks.map((c) => (
              <li key={c.label} className={c.ok ? "is-ok" : "is-pending"}>
                <span className="fu-tick" aria-hidden="true">
                  {c.ok ? "✓" : ""}
                </span>
                <span>
                  {c.label}
                  {c.note && <small>{c.note}</small>}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="fu-qbox">
          <b>
            Mensaje a enviar ({q.actionLabel}
            {v ? ` · V${v.version}` : ""})
          </b>
          {preview.length ? preview.map((m, i) => <div key={i} className="fu-qmsg">{m}</div>) : <span>Sin texto cargado.</span>}
        </div>
      </div>
      </details>
      <p className="fu-qinfo">
        <Info size={14} aria-hidden="true" /> Al ejecutarla queda tomada por vos 10 minutos y se arma el mensaje con sus enlaces. Después: 1. Abrir WhatsApp, 2. Confirmar envío.
      </p>
    </div>
  );
}

const SNOOZE = [
  { key: "manana", label: "Mañana a las 9" },
  { key: "3dias", label: "En 3 días" },
  { key: "semana", label: "En una semana" },
  { key: "fecha", label: "Otra fecha" },
] as const;
/** 9 de la mañana de Argentina (12 UTC), dentro de `days` días. */
function nineAm(days: number) {
  const d = new Date(Date.now() + days * 86400000);
  d.setUTCHours(12, 0, 0, 0);
  return d.toISOString();
}
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });
const when = (iso: string) => new Date(iso).toLocaleString("es-AR", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });

/**
 * La ejecución, en el panel de la derecha: el contexto, la regla, el mensaje y el
 * checklist, y los botones (Abrir WhatsApp, Confirmar envío, No se envió,
 * Omitir o reprogramar). Al abrirla, la inmobiliaria queda tomada 10 minutos.
 */
function ExecPanel({
  item,
  rules,
  initialPrepared,
  exec,
  onDone,
  onClose,
  onNext,
  taking,
}: {
  item: QueueItem;
  rules: Rule[];
  initialPrepared: Prepared | null;
  exec: Exec;
  onDone: (e: Exec) => void;
  onClose: () => void;
  onNext: () => void;
  taking: boolean;
}) {
  const [prepared, setPrepared] = useState<Prepared | null>(initialPrepared);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(exec?.status ?? "pending");
  const [panel, setPanel] = useState<"none" | "fail" | "snooze">("none");
  const [kind, setKind] = useState<keyof typeof FAIL_KINDS>("otro");
  const [reason, setReason] = useState("");
  const [snoozeKey, setSnoozeKey] = useState<(typeof SNOOZE)[number]["key"]>("manana");
  const [snoozeDate, setSnoozeDate] = useState("");
  const [priority, setPriority] = useState(item.priority);
  const sent = status === "sent";

  const load = () =>
    api<Prepared>("/api/admin/follow-up/ejecuciones", { method: "POST", body: JSON.stringify({ accion: "preparar", inmobiliaria: item.agencyId }) })
      .then(setPrepared)
      .catch((e) => setError(e instanceof Error ? e.message : "No pudimos armar el mensaje."));
  useEffect(() => {
    if (!initialPrepared && exec?.status !== "sent") void load();
    // Opening the panel takes the agency; loading it once is enough.
  }, [item.agencyId]);

  async function post<T>(url: string, body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      return await api<T>(url, { method: "POST", body: JSON.stringify(body) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos guardarlo.");
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function mark(estado: "opened" | "sent" | "failed") {
    if (!prepared) return;
    const r = await post<{ execution: NonNullable<Exec>; warning: string | null }>("/api/admin/follow-up/ejecuciones", {
      accion: "registrar",
      inmobiliaria: item.agencyId,
      etapa: prepared.stage,
      tarea: prepared.action,
      version: prepared.versionId,
      estado,
      motivo: reason,
      tipo: kind === "otro" ? null : kind,
      texto: prepared.message,
    });
    if (!r) return;
    setStatus(r.execution.status);
    if (r.warning) setNotice(r.warning);
    if (estado !== "opened") onDone({ status: r.execution.status, at: r.execution.at, reason: estado === "failed" ? reason || FAIL_KINDS[kind] : null });
    if (estado === "failed") setPanel("none");
  }
  async function snooze() {
    const hasta = snoozeKey === "manana" ? nineAm(1) : snoozeKey === "3dias" ? nineAm(3) : snoozeKey === "semana" ? nineAm(7) : snoozeDate ? new Date(`${snoozeDate}T09:00:00-03:00`).toISOString() : "";
    if (!hasta) return setError("Elegí la fecha.");
    const r = await post<{ snoozedUntil: string }>("/api/admin/follow-up/inmobiliarias", { accion: "reprogramar", inmobiliaria: item.agencyId, hasta, motivo: reason });
    if (r) {
      onDone({ status: "failed", at: new Date().toISOString(), reason: `Reprogramada para el ${when(r.snoozedUntil)}` });
      onNext();
    }
  }
  async function changePriority(p: string) {
    setPriority(p as QueueItem["priority"]);
    await post("/api/admin/follow-up/inmobiliarias", { accion: "prioridad", inmobiliaria: item.agencyId, prioridad: p === "auto" ? null : p });
  }
  async function close() {
    if (prepared && !sent) await api("/api/admin/follow-up/ejecuciones", { method: "POST", body: JSON.stringify({ accion: "soltar", inmobiliaria: item.agencyId }) }).catch(() => undefined);
    onClose();
  }
  async function copyText(text: string, what: string) {
    setNotice((await copy(text)) ? `${what} copiado.` : `No pudimos copiarlo: ${text}`);
  }
  async function rename() {
    const name = window.prompt("Nombre corto para {{inmobiliaria}} (vacío: el de la ficha sin paréntesis)", prepared?.context.shortName ?? item.shortName);
    if (name === null) return;
    if (await post("/api/admin/follow-up/inmobiliarias", { accion: "nombre", inmobiliaria: item.agencyId, nombre: name })) {
      setPrepared(null);
      await load();
    }
  }

  const ctx = prepared?.context;
  const task = prepared?.channel === "task";
  const creatingDemo = task && prepared?.stage === "sin-demo" && prepared?.action === "principal";
  const many = (prepared?.messages.length ?? 0) > 1;
  const closed = sent || status === "failed";
  return (
    <div className="fu-qpanel is-exec" data-testid="followup-detail" data-agency={item.agencyId} data-status={status} style={{ maxHeight: "calc(100vh - 155px)", overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
      <div className="fu-qpanelhead">
        <Target size={17} aria-hidden="true" />
        <b>{sent ? "Enviado" : "Ejecutando"}</b>
        {prepared && !sent && <span className="fu-pill is-lock">Tomada por vos · libre a las {hhmm(prepared.lockedUntil)}</span>}
        <span className="fu-grow" />
        <span className="fu-qstage">{stageTitle(item.stage)}</span>
        <button type="button" className="fu-iconbtn" aria-label="Cerrar y volver a la cola" title="Cerrar (la deja libre)" data-testid="followup-back" onClick={close}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <PanelIdent q={item} />
      <div className="fu-qline" style={{ margin: "6px 0" }}>
        <span className="fu-lbl">Estado</span>
        <SituationCell item={item} />
      </div>
      <div className="fu-qbox" data-testid="followup-execution-focus" style={{ padding: 14, margin: "8px 0", border: "1px solid #a9cab7", borderRadius: 10 }}>
        <b>{task ? `Tarea · ${prepared?.actionLabel ?? item.actionLabel ?? "Pendiente"}` : `Mensaje a enviar · ${prepared?.actionLabel ?? item.actionLabel ?? "Pendiente"}${prepared ? ` · V${prepared.version}` : ""}`}</b>
        {!prepared ? (
          <span>{error || (sent ? "Confirmada." : "Cargando acción…")}</span>
        ) : task ? (
          <p className="fu-note">Acción interna. {creatingDemo ? "Creá y publicá la demo desde la ficha; no se envía un WhatsApp." : "Revisá las instrucciones y ejecutá la tarea."}</p>
        ) : (
          prepared.messages.map((m, i) => (
            <div key={i} className="fu-qmsgrow" style={{ marginTop: 7 }}>
              <div className="fu-qmsg" data-testid="followup-message" data-index={i}>{m}</div>
              <button type="button" className="fu-iconbtn" aria-label={`Copiar mensaje ${i + 1}`} data-testid="followup-copy-part" onClick={() => copyText(m, `Mensaje ${i + 1}`)}>
                <ClipboardCopy size={16} aria-hidden="true" />
              </button>
            </div>
          ))
        )}
      </div>
      <details data-testid="followup-execution-checks" className="fu-qbox" style={{ margin: "6px 0", padding: 10 }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>
          Validaciones · {prepared ? `${prepared.checklist.filter((x) => x.ok).length} correctas · ${prepared.checklist.filter((x) => !x.ok).length} pendientes` : "Cargando"}
        </summary>
        {prepared && prepared.checklist.some((x) => !x.ok) && <p className="fu-note" style={{ color: "#9c631b" }}>Revisá los puntos pendientes antes de confirmar el envío.</p>}
        <ul className="fu-qchecks" data-testid="followup-checklist">
          {(prepared?.checklist ?? []).map((check) => (
            <li key={check.key} className={check.ok ? "is-ok" : "is-pending"} data-check={check.key} data-ok={check.ok}>
              <span className="fu-tick" aria-hidden="true">{check.ok ? "✓" : ""}</span>
              <span>{check.label}{check.note && <small>{check.note}</small>}</span>
            </li>
          ))}
        </ul>
      </details>
      <details data-testid="followup-execution-notes" className="fu-qbox" style={{ margin: "6px 0", padding: 10 }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Instrucciones para la extensión · {prepared?.notes ? "Leer" : "Sin observaciones"}</summary>
        <p className="fu-obs" data-testid="followup-notes" style={{ whiteSpace: "pre-wrap" }}>{prepared?.notes || "Esta acción no tiene observaciones adicionales."}</p>
      </details>
      <details data-testid="followup-execution-context" className="fu-qbox" style={{ margin: "6px 0", padding: 10 }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Contexto de la inmobiliaria</summary>
        <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
          <span>Web: {item.website ? <a href={href(item.website)} target="_blank" rel="noreferrer">{host(item.website)}</a> : "sin web"} · {item.properties} propiedades</span>
          <span>{item.hasDemo ? "Con demo publicada" : "Sin demo publicada"} · {item.hasAccount ? "Con cuenta" : "Sin cuenta"}</span>
          {item.address && <span>{item.address}</span>}
          <span>En el mensaje: «{ctx?.shortName ?? item.shortName}» <button type="button" className="fu-link" data-testid="followup-short-name" onClick={rename}>cambiar</button></span>
          {item.situationNote && <span>Respuesta: «{item.situationNote}»</span>}
        </div>
      </details>
      <details data-testid="followup-execution-history" className="fu-qbox" style={{ margin: "6px 0", padding: 10 }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Historial y últimas acciones · {prepared?.history.length ?? 0}</summary>
        {prepared?.history.length ? (
          <ol className="fu-timeline" data-testid="followup-history">
            {prepared.history.slice(0, 8).map((h, i) => <li key={i} className={`is-${h.kind}`}><span>{when(h.at)}</span> {h.text}</li>)}
          </ol>
        ) : <span>Sin acciones registradas.</span>}
      </details>
      <details data-testid="followup-execution-rule" className="fu-qbox" style={{ margin: "6px 0", padding: 10 }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Regla: {ruleOf(rules, item) ? ruleTitle(item.stage, ruleOf(rules, item)!) : (item.actionLabel ?? "—")} · Ver detalles</summary>
        <RuleBox q={item} rules={rules} />
        <p className="fu-qflow" data-testid="followup-after-confirm"><ArrowRight size={14} aria-hidden="true" /> {afterConfirm(item, rules)}</p>
      </details>
      {notice && (
        <p className="fu-note" role="status">
          {notice}
        </p>
      )}
      {prepared && error && (
        <p className="fu-error" role="alert" data-testid="followup-error">
          {error}
        </p>
      )}
      <div className="fu-qbtns" style={{ position: "sticky", bottom: 0, zIndex: 4, background: "#fff", borderTop: "1px solid #d8e3dc", boxShadow: "0 -5px 15px #0000000e", padding: "12px 8px", marginTop: 8 }}>
        {prepared && !task && (
          <>
            {prepared.whatsappUrl ? (
              <a className={`button button-small${status === "pending" || status === "failed" ? " button-primary" : " button-outline"}`} data-testid="followup-open" href={prepared.whatsappUrl} target="habita-whatsapp" rel="noreferrer" onClick={() => !sent && void mark("opened")}>
                <MessageCircle size={16} aria-hidden="true" /> 1. Abrir WhatsApp{many ? " con el mensaje 1" : ""}
              </a>
            ) : (
              <span className="button button-small button-outline is-disabled" data-testid="followup-open" aria-disabled="true">
                <MessageCircle size={16} aria-hidden="true" /> 1. Abrir WhatsApp
              </span>
            )}
            <button type="button" className={`button button-small${status === "opened" ? " button-primary" : " button-outline"}`} data-testid="followup-confirm" disabled={sent || busy || !prepared.ready} onClick={() => mark("sent")}>
              <Send size={15} aria-hidden="true" /> {sent ? "Enviado" : many ? `2. Confirmar: salieron los ${prepared.messages.length}` : "2. Confirmar envío"}
            </button>
          </>
        )}
        {prepared && task && (
          <>
            {(prepared.ctas.includes("create_demo") || creatingDemo) && (
              <Link className="button button-small button-primary" href={prepared.links.createDemo} target="_blank" onClick={() => void mark("opened")}>
                <Plus size={16} aria-hidden="true" /> Crear demo
              </Link>
            )}
            {creatingDemo ? (
              <p className="fu-note" data-testid="followup-demo-auto-progress">Al publicar la demo se actualizará el estado automáticamente; no hace falta marcar la tarea como hecha.</p>
            ) : (
              <button type="button" className="button button-small button-outline" data-testid="followup-confirm" disabled={sent || busy} onClick={() => mark("sent")}>
                {sent ? "Hecha" : "Marcar hecha"}
              </button>
            )}
          </>
        )}
        {prepared && !sent && (
          <div className="fu-two">
            <button type="button" className={`button button-small button-outline${panel === "fail" ? " is-active" : ""}`} data-testid="followup-failed" onClick={() => setPanel(panel === "fail" ? "none" : "fail")}>
              {task ? "No se pudo" : "No se envió"}
            </button>
            <button type="button" className={`button button-small button-outline${panel === "snooze" ? " is-active" : ""}`} data-testid="followup-snooze" onClick={() => setPanel(panel === "snooze" ? "none" : "snooze")}>
              Omitir / reprogramar
            </button>
          </div>
        )}
        {panel === "fail" && !sent && (
          <div className="fu-form">
            <select data-testid="followup-failed-kind" value={kind} onChange={(e) => setKind(e.target.value as keyof typeof FAIL_KINDS)} aria-label="Qué pasó">
              {Object.entries(FAIL_KINDS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
            <input data-testid="followup-failed-reason" value={reason} maxLength={300} placeholder={kind === "otro" ? "Por qué no salió" : "Detalle (opcional)"} onChange={(e) => setReason(e.target.value)} aria-label="Por qué no salió" />
            <button type="button" className="button button-small button-outline" data-testid="followup-failed-save" disabled={busy || (kind === "otro" && !reason.trim())} onClick={() => mark("failed")}>
              Guardar
            </button>
          </div>
        )}
        {panel === "snooze" && !sent && (
          <div className="fu-form" data-testid="followup-snooze-form">
            <select value={snoozeKey} onChange={(e) => setSnoozeKey(e.target.value as (typeof SNOOZE)[number]["key"])} aria-label="Hasta cuándo">
              {SNOOZE.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
            {snoozeKey === "fecha" && <input type="date" value={snoozeDate} onChange={(e) => setSnoozeDate(e.target.value)} aria-label="Fecha" />}
            <input value={reason} maxLength={300} placeholder="Motivo (ej.: pidió hablar después)" onChange={(e) => setReason(e.target.value)} aria-label="Motivo" />
            <button type="button" className="button button-small button-outline" data-testid="followup-snooze-save" disabled={busy} onClick={snooze}>
              Reprogramar
            </button>
          </div>
        )}
        {closed && (
          <button type="button" className="button button-small button-primary" data-testid="followup-next" disabled={taking} onClick={onNext}>
            {taking ? "Buscando…" : "Siguiente contacto →"}
          </button>
        )}
      </div>
      {!task && (
        <div className="fu-stop" data-testid="followup-stop">
          <b>Si el chat no coincide, no envíes.</b> El encabezado de WhatsApp tiene que mostrar {item.phone ?? "su número"}.
        </div>
      )}
      {prepared && (
        <div className="fu-qmore">
          <div className="fu-quick">
            {!task && (
              <button type="button" onClick={() => copyText(prepared.messages.join("\n\n"), many ? "Los mensajes" : "Mensaje")}>
                {many ? `Copiar los ${prepared.messages.length}` : "Copiar mensaje"}
              </button>
            )}
            {prepared.links.demo && (
              <button type="button" data-testid="followup-link-demo" onClick={() => copyText(prepared.links.demo!, "Link demo")}>
                Link demo
              </button>
            )}
            {prepared.links.panel && (
              <button type="button" data-testid="followup-link-panel" onClick={() => copyText(prepared.links.panel!, "Link panel")}>
                Link panel
              </button>
            )}
          </div>
          <label className="fu-prio">
            <span className="fu-lbl">Prioridad</span>
            <select data-testid="followup-priority" value={item.priorityManual ? priority : "auto"} onChange={(e) => changePriority(e.target.value)}>
              <option value="auto">Automática ({PRIORITY_LABEL[item.priorityManual ? priority : item.priority]})</option>
              <option value="alta">Alta</option>
              <option value="media">Media</option>
              <option value="baja">Baja</option>
            </select>
          </label>
        </div>
      )}
      <p className="fu-qinfo">
        <Info size={14} aria-hidden="true" /> Al confirmar el envío, la cola se actualiza y «Siguiente contacto» toma el próximo con los mismos filtros. Si llega una respuesta y se registra, Habita recalcula su situación y su próxima acción.
      </p>
    </div>
  );
}

/**
 * Bandeja de respuestas (Fase 2): las que la extensión registró sin
 * clasificar o mandó a Facu. Clasificarla aplica la situación (con el texto
 * como evidencia) y la cola sabe qué hacer después.
 */
function Inbox({ inbox, agencies }: { inbox: InboxItem[]; agencies: QueueItem[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(inbox[0]?.id ?? null);
  const [adding, setAdding] = useState(false);
  const r = inbox.find((x) => x.id === selected) ?? null;
  const pendientes = inbox.filter((x) => x.status === "pendiente").length;
  return (
    <section className="fu-inbox" data-testid="followup-inbox">
      <div className="fu-kpis">
        <div className="fu-kpi">
          <span>Sin clasificar</span>
          <b>{pendientes}</b>
          <small>la extensión no estaba segura o no las clasificó</small>
        </div>
        <div className="fu-kpi">
          <span>Para Facu</span>
          <b>{inbox.length - pendientes}</b>
          <small>audios, preguntas no cubiertas, confianza baja</small>
        </div>
        <div className="fu-kpi">
          <span>Mínimo para aplicar sola</span>
          <b>70%</b>
          <small>de confianza en la clasificación</small>
        </div>
        <button type="button" className="fu-kpi" data-testid="followup-reply-add" onClick={() => setAdding(!adding)} aria-expanded={adding}>
          <span>¿Llegó una respuesta?</span>
          <b>+</b>
          <small>Registrala a mano</small>
        </button>
      </div>
      {adding && <ReplyForm agencies={agencies} onDone={() => (setAdding(false), router.refresh())} />}
      {inbox.length === 0 ? (
        <p className="fu-empty">No hay respuestas sin resolver. Las que la extensión clasifica con confianza se aplican solas.</p>
      ) : (
        <div className="fu-inboxgrid">
          <div className="fu-convs" aria-label="Respuestas">
            {inbox.map((x) => (
              <button key={x.id} type="button" className={`fu-conv${x.id === selected ? " is-on" : ""}`} data-testid="followup-reply" data-reply={x.id} data-status={x.status} onClick={() => setSelected(x.id)}>
                <span className="fu-convhead">
                  <b>{x.name}</b>
                  <span>{when(x.received_at)}</span>
                </span>
                <span className="fu-convtext">«{x.body}»</span>
                <span className="fu-convtags">
                  <span className={`fu-pill ${x.status === "facu" ? "is-media" : "is-sit"}`}>{x.status === "facu" ? "Para Facu" : x.classification ? REPLY_CLASSES[x.classification] : "Sin clasificar"}</span>
                  {x.confidence !== null && <small>confianza {Math.round(x.confidence * 100)}%</small>}
                </span>
              </button>
            ))}
          </div>
          {r && <ReplyDetail key={r.id} reply={r} onDone={() => router.refresh()} />}
        </div>
      )}
    </section>
  );
}

function ReplyDetail({ reply: r, onDone }: { reply: InboxItem; onDone: () => void }) {
  const [c, setC] = useState<ReplyClass | "">(r.classification ?? "");
  const [until, setUntil] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactWa, setContactWa] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const res = await api<{ warning: string | null }>("/api/admin/followup/reply", { method: "POST", body: JSON.stringify({ id: r.id, ...body }) });
      if (res.warning) setNotice(res.warning);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos guardarlo.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="fu-card fu-replydetail" data-testid="followup-reply-detail">
      <div className="fu-convhead">
        <span>
          <Link href={`/admin/inmobiliarias/${r.agency_id}`}>
            <b>{r.name}</b>
          </Link>
          <span className="fu-mono"> {r.phone ?? ""}</span>
        </span>
        <span>{r.stage ? `Etapa ${stageTitle(r.stage)}` : ""}</span>
      </div>
      <div className="fu-bubble">
        {r.body}
        <small>{when(r.received_at)}</small>
      </div>
      {r.note && <p className="fu-note">Nota: {r.note}</p>}
      <fieldset className="fu-classes">
        <legend>
          Clasificación
          {r.classification && r.confidence !== null ? ` · la extensión sugirió «${REPLY_CLASSES[r.classification]}» con ${Math.round(r.confidence * 100)}%` : ""}
        </legend>
        {(Object.keys(REPLY_CLASSES) as ReplyClass[]).map((k) => (
          <label key={k} className={`fu-class${c === k ? " is-on" : ""}`}>
            <input type="radio" name={`clase-${r.id}`} checked={c === k} onChange={() => setC(k)} /> {REPLY_CLASSES[k]}
          </label>
        ))}
      </fieldset>
      {c === "mas_adelante" && (
        <label className="fu-form">
          <span className="fu-lbl">¿Para cuándo? (opcional)</span>
          <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
        </label>
      )}
      {c === "derivo" && (
        <div className="fu-form">
          <span className="fu-lbl">Contacto nuevo (queda en la misma inmobiliaria)</span>
          <input value={contactName} placeholder="Nombre" maxLength={120} onChange={(e) => setContactName(e.target.value)} />
          <input value={contactWa} placeholder="WhatsApp" inputMode="tel" maxLength={40} onChange={(e) => setContactWa(e.target.value)} />
        </div>
      )}
      {notice && <p className="fu-warn">{notice}</p>}
      {error && (
        <p className="fu-error" role="alert">
          {error}
        </p>
      )}
      <div className="fu-actions">
        <button
          type="button"
          className="button button-primary button-small"
          data-testid="followup-reply-save"
          disabled={busy || !c}
          onClick={() => send({ clasificacion: c, hasta: until ? new Date(`${until}T09:00:00-03:00`).toISOString() : null, contactoNombre: contactName, contactoWhatsapp: contactWa })}
        >
          Guardar y pasar a la cola
        </button>
        {r.status !== "facu" && (
          <button type="button" className="button button-small button-outline" data-testid="followup-reply-facu" disabled={busy} onClick={() => send({ facu: true })}>
            Asignar a Facu
          </button>
        )}
      </div>
    </div>
  );
}

function ReplyForm({ agencies, onDone }: { agencies: QueueItem[]; onDone: () => void }) {
  const [agency, setAgency] = useState("");
  const [text, setText] = useState("");
  const [c, setC] = useState<ReplyClass | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const options = [...agencies].sort((a, b) => a.name.localeCompare(b.name));
  async function save() {
    setBusy(true);
    setError("");
    try {
      await api("/api/admin/followup/reply", { method: "POST", body: JSON.stringify({ inmobiliaria: agency, texto: text, clasificacion: c || null, confianza: c ? 1 : null }) });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos registrarla.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="fu-add" data-testid="followup-reply-form">
      <p className="fu-lbl">Registrar una respuesta</p>
      <div className="fu-add-grid">
        <label>
          <span>Inmobiliaria</span>
          <select value={agency} onChange={(e) => setAgency(e.target.value)}>
            <option value="">Elegí…</option>
            {options.map((q) => (
              <option key={q.agencyId} value={q.agencyId}>
                {q.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Clasificación (vacía: queda en la bandeja)</span>
          <select value={c} onChange={(e) => setC(e.target.value as ReplyClass | "")}>
            <option value="">Sin clasificar</option>
            {(Object.keys(REPLY_CLASSES) as ReplyClass[]).map((k) => (
              <option key={k} value={k}>
                {REPLY_CLASSES[k]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="fu-textarea">
        <span>Lo que respondió (tal cual)</span>
        <textarea value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} />
      </label>
      {error && (
        <p className="fu-error" role="alert">
          {error}
        </p>
      )}
      <div className="fu-actions">
        <button type="button" className="button button-primary button-small" disabled={busy || !agency || !text.trim()} onClick={save}>
          Registrar
        </button>
      </div>
    </div>
  );
}

const SITUATION_OPTIONS = ["sin_respuesta", "confirmo_numero", "neutro", "pregunta_precios", "mas_adelante", "derivo", "interesado"] as const;
const ruleSituations = (r: Rule) => (r.situations.length ? r.situations.map((x) => SITUATIONS[x as Situation]).join(", ") : "Cualquier situación");

/** Embudo y etapas (Fase 3): las etapas en tarjetas con su avance; la elegida, con sus reglas, sus versiones y sus inmobiliarias. */
function Funnel({ funnel, stages, rules, onRules }: { funnel: FunnelStep[]; stages: StageView[]; rules: Rule[]; onRules: () => void }) {
  const [selectedCommercial, setSelectedCommercial] = useState<CommercialStageKey>("contactado");
  const [selectedTechnical, setSelectedTechnical] = useState<StageKey>("no-responde");
  const technical = technicalOf(selectedCommercial);
  const selected = technical.includes(selectedTechnical) ? selectedTechnical : technical[0] ?? null;
  const stage = selected ? stages.find((s) => s.key === selected) ?? null : null;
  const step = selected ? funnel.find((f) => f.key === selected) ?? null : null;
  const own = selected ? rules.filter((r) => r.stage === selected).sort((a, b) => a.position - b.position) : [];
  const latestTechnical = funnel[funnel.length - 1];
  const clientReached = latestTechnical?.rate === null ? 0 : Math.round((latestTechnical?.reached ?? 0) * (latestTechnical?.rate ?? 0));
  const byCommercial = COMMERCIAL_STAGES.map((item, index) => {
    const first = item.technical[0];
    const reached = first ? (funnel.find((f) => f.key === first)?.reached ?? 0) : clientReached;
    const waiting = item.technical.reduce((sum, key) => sum + (funnel.find((f) => f.key === key)?.waiting ?? 0), 0);
    const next = COMMERCIAL_STAGES[index + 1];
    const nextReached = next?.technical[0]
      ? (funnel.find((f) => f.key === next.technical[0])?.reached ?? 0) : clientReached;
    return { ...item, waiting: item.key === "cliente" ? reached : waiting, reached,
      rate: next && reached ? Math.min(1, nextReached / reached) : null, next: next?.title ?? null };
  });
  return (
    <section className="fu-funnel" data-testid="followup-funnel">
      <div className="fu-fcards" aria-label="Siete etapas comerciales">
        {byCommercial.map((f) => (
          <button key={f.key} type="button" className={`fu-fcard${f.key === selectedCommercial ? " is-on" : ""}`}
            aria-pressed={f.key === selectedCommercial} data-testid="followup-funnel-stage" data-stage={f.key}
            onClick={() => { setSelectedCommercial(f.key); const first = technicalOf(f.key)[0]; if (first) setSelectedTechnical(first); }}>
            <span>{f.title}</span>
            <b>{f.waiting}</b>
            <small>{f.next ? `${pct(f.rate)} pasa a ${f.next}` : "Etapa final"}</small>
          </button>
        ))}
      </div>
      {technical.length > 1 && (
        <div className="fu-qbar" data-testid="followup-funnel-substages">
          <span className="fu-qbarlabel">Estado de avance</span>
          <div className="fu-qchips">
            {technical.map((key) => (
              <button key={key} type="button" className={`fu-qchip is-sm${key === selected ? " is-on" : ""}`}
                aria-pressed={key === selected} onClick={() => setSelectedTechnical(key)}>
                {technicalStateLabel(key)} <b>{funnel.find((x) => x.key === key)?.waiting ?? 0}</b>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="fu-card fu-fdetail">
        <div className="fu-fhead">
          <h2>{selectedCommercial === "cliente" ? "Cliente" : step?.title ?? selectedCommercial}</h2>
          <span className="fu-pill is-media">{byCommercial.find((x) => x.key === selectedCommercial)?.waiting ?? 0} en la etapa comercial</span>
          {step && <span className="fu-note">Objetivo: que pase a «{step.goal}»</span>}
          <span className="fu-grow" />
          {selected && <button type="button" className="fu-link" onClick={onRules}>Editar reglas y mensajes →</button>}
        </div>
        {selected ? (
          <div className="fu-frules">
            {own.length === 0 ? (
              <p className="fu-note">No hay reglas configuradas para este estado de avance.</p>
            ) : own.map((r) => {
              const versions = stage?.versions.filter((v) => (v.action ?? "principal") === r.action) ?? [];
              const active = versions.find((v) => v.status === "active");
              const test = versions.find((v) => v.status === "test");
              return (
                <div key={r.key} className={`fu-frule${r.enabled ? "" : " is-off"}`} data-testid="followup-funnel-rule" data-rule={r.key}>
                  <small>{ruleSituations(r)}{r.after_hours ? ` · a las ${r.after_hours} h` : " · enseguida"}</small>
                  <b>{actionLabel(selected, r.action as Action)}</b>
                  <span>{active ? `V${active.version} activa` : "Sin versión activa: no se puede ejecutar"}{!r.enabled ? " · regla apagada" : ""}</span>
                  <span><b className="fu-big">{pct(active?.stats.rate ?? null)}</b> avance registrado · {active?.stats.executions ?? 0} ejecuciones{active?.stats.smallSample ? " · muestra chica" : ""}</span>
                  <span className={`fu-pill ${test ? "is-baja" : "is-sit"}`}>{test ? `Prueba A/B: V${test.version} contra V${active?.version ?? "?"}` : "Sin prueba"}</span>
                </div>
              );
            })}
          </div>
        ) : <p className="fu-note">Una inmobiliaria que ya es cliente no tiene más acciones de captación en este funnel.</p>}
      </div>
      {stage && <Queue stage={stage} />}
    </section>
  );
}

/* ------------------------------------------------------------------ Mensajes y reglas (rediseño) */

const NEW_RULE = "__nueva";
const NEW_VERSION = "__nueva";
const DISCARD = "Hay cambios sin guardar. ¿Descartarlos?";
type MsgTab = "mensaje" | "versiones" | "observaciones";

/** Qué espera cada etapa, en una línea (la misma lectura que la tabla de docs/FOLLOWUP.md). */
/** Cuándo se ejecuta una regla, en una frase. Misma lectura en la lista, el resumen y el editor. */
function ruleWhen(stage: StageKey, r: Rule) {
  const after = r.after_action ? ` y ya salió «${actionLabel(stage, r.after_action as Action)}»` : "";
  const timing = r.after_hours ? `a las ${r.after_hours} h de nuestro último mensaje` : "enseguida";
  return `Si ${ruleSituations(r).toLowerCase()}${after} · ${timing} · ${daysText(r.days)} de ${r.hours_from} a ${r.hours_to}`;
}

/** Cómo se llama una regla: su nombre, o la acción si no tiene. */
const ruleTitle = (stage: StageKey, r: Rule) => r.name?.trim() || actionLabel(stage, r.action as Action);

/** Las reglas de otras etapas que se pueden traer a esta: su acción y su paso previo existen acá. */
const importable = (stage: StageKey, rules: Rule[]) => rules.filter((r) => r.stage !== stage && compatible(stage, r.action as Action) && (!r.after_action || compatible(stage, r.after_action as Action)));

/** La condición de una regla en una línea corta, para su tarjeta. */
function ruleShort(stage: StageKey, r: Rule) {
  const sits = r.situations.length ? r.situations.map((x) => SITUATIONS[x]).join(", ").toLowerCase() : "";
  if (r.after_action) return `${r.after_hours ? `${r.after_hours} h después de` : "Después de"} «${actionLabel(stage, r.after_action as Action)}»`;
  const timing = r.after_hours ? `a las ${r.after_hours} h` : "enseguida";
  return sits ? `Si ${sits} · ${timing}` : timing.charAt(0).toUpperCase() + timing.slice(1);
}

/** La misma etapa, con solo las versiones de una acción: lo que el editor de esa acción necesita. */
const versionsOf = (stage: StageView, action: Action): StageView => ({ ...stage, versions: stage.versions.filter((v) => (v.action ?? "principal") === action) });

/**
 * Mensajes y reglas: las etapas en una barra horizontal; dentro de la etapa, sus
 * reglas (izquierda) y el editor de la regla elegida (derecha). Cambia solo la
 * interfaz: las reglas y las versiones se guardan con los mismos endpoints.
 */
type CatalogState = {
  key: string; label: string; description: string; examples: string;
  commercial_stage: string; source: "whatsapp" | "manual";
  maps_to: Situation | null; active: boolean; updated_at: string;
};
type CatalogDraft = { key: string; label: string; description: string; examples: string; source: "whatsapp" | "manual"; maps_to: Situation | ""; active: boolean };
const EMPTY_CATALOG: CatalogDraft = { key: "", label: "", description: "", examples: "", source: "whatsapp", maps_to: "", active: false };
/** Catalog editor is separate from the message editor: it does not rewrite past events or send messages. */
function StateCatalogManager({ commercial }: { commercial: string }) {
  const [states, setStates] = useState<CatalogState[]>([]);
  const [draft, setDraft] = useState<CatalogDraft>(EMPTY_CATALOG);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(async () => {
    try {
      const result = await api<{ states: CatalogState[] }>("/api/admin/follow-up/estados");
      setStates(result.states);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el catálogo.");
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  const own = states.filter((s) => s.commercial_stage === commercial);
  function edit(state?: CatalogState) {
    setDraft(state ? { key: state.key, label: state.label, description: state.description, examples: state.examples, source: state.source, maps_to: state.maps_to ?? "", active: state.active } : EMPTY_CATALOG);
    setEditing(true);
  }
  async function save() {
    const slug = draft.label.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 45);
    const key = draft.key || `custom_${slug}`;
    setBusy(true);
    setError("");
    try {
      await api("/api/admin/follow-up/estados", { method: "PUT", body: JSON.stringify({ ...draft, key, create: !draft.key, commercial_stage: commercial, maps_to: draft.maps_to || null }) });
      setEditing(false);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos guardar el estado.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div data-testid="followup-state-catalog" style={{ marginTop: 16 }}>
      <div className="fu-rules-head">
        <div><b>Clasificaciones personalizadas</b><p className="fu-note">Se reconocen en WhatsApp y se asocian a una situación existente.</p></div>
        <button type="button" className="button button-small button-outline" onClick={() => edit()}><Plus size={14} /> Estado</button>
      </div>
      {own.map((s) => (
        <button key={s.key} type="button" className="fu-qchip is-sm" data-testid="followup-custom-state" onClick={() => edit(s)}
          style={{ width: "100%", textAlign: "left", marginTop: 6, display: "flex", justifyContent: "space-between" }}>
          <span>{s.label}</span><small>{s.active ? "Activa" : "Inactiva"}</small>
        </button>
      ))}
      {!loaded && <p className="fu-note">Cargando catálogo…</p>}
      {error && <p className="fu-error" role="alert">{error}</p>}
      {editing && (
        <div className="fu-box" style={{ marginTop: 12, display: "grid", gap: 9 }} data-testid="followup-state-editor">
          <label>Nombre<input aria-label="Nombre del estado" value={draft.label} maxLength={80} onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))} /></label>
          <label>Descripción<textarea aria-label="Descripción para el clasificador" value={draft.description} maxLength={800} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} /></label>
          <label>Ejemplos de respuestas<textarea aria-label="Ejemplos del estado" value={draft.examples} maxLength={2000} onChange={(e) => setDraft((d) => ({ ...d, examples: e.target.value }))} /></label>
          <label>Situación que entiende el motor
            <select aria-label="Mapear a situación existente" value={draft.maps_to} onChange={(e) => setDraft((d) => ({ ...d, maps_to: e.target.value as Situation | "" }))}>
              <option value="">Sin mapear (revisión manual)</option>
              {(Object.keys(SITUATIONS) as Situation[]).map((s) => <option key={s} value={s}>{SITUATIONS[s]}</option>)}
            </select>
          </label>
          <label>Origen
            <select value={draft.source} onChange={(e) => setDraft((d) => ({ ...d, source: e.target.value as "whatsapp" | "manual" }))}>
              <option value="whatsapp">WhatsApp</option><option value="manual">Manual</option>
            </select>
          </label>
          <label><input type="checkbox" checked={draft.active} onChange={(e) => setDraft((d) => ({ ...d, active: e.target.checked }))} /> Activa para clasificación</label>
          <p className="fu-note">Una clasificación nueva no crea una acción automáticamente. Se aplican las reglas existentes de la situación elegida y sus restricciones de envío.</p>
          <div className="fu-actions"><button type="button" className="button button-small button-outline" onClick={() => setEditing(false)}>Cancelar</button>
            <button type="button" className="button button-small button-primary" disabled={busy || !draft.label.trim() || (draft.active && !draft.maps_to)} onClick={() => void save()}>{busy ? "Guardando…" : "Guardar estado"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Edición unificada: etapa → situación (estado de conversación) → reglas → mensaje.
 * Las situaciones siguen siendo el catálogo tipado actual; esta interfaz no finge
 * que es posible agregar nuevas clasificaciones sin migrar el contrato del backend.
 */
/** Configuración de automatizaciones: dos columnas, reglas y editor.
 * Las situaciones comerciales se eligen como condiciones dentro de cada regla,
 * no como una tercera lista de 'estados' que compita con el avance del funnel. */
function RulesWorkspace({ stages, rules, changes }: { stages: StageView[]; rules: Rule[]; changes: Change[] }) {
  const [commercial, setCommercial] = useState<CommercialStageKey>("contactado");
  const [stageKey, setStageKey] = useState<StageKey>("no-responde");
  const [selected, setSelected] = useState<string | null>(null);
  const [template, setTemplate] = useState<Rule | null>(null);
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const steps = technicalOf(commercial);
  const stage = stages.find((s) => s.key === stageKey) ?? stages[0];
  const own = rules.filter((r) => commercialOf(r.stage) === commercial && compatible(r.stage, r.action)).sort((a, b) => a.position - b.position);
  const adding = selected === NEW_RULE;
  const isDirty = Object.values(dirty).some(Boolean);
  const current = adding ? null : own.find((r) => r.key === selected) ?? own[0] ?? null;
  const effectiveStage = current ? stages.find((s) => s.key === current.stage) ?? stage : stage;
  const sameStepRules = rules.filter((r) => r.stage === effectiveStage.key);
  const nextPosition = Math.max(0, ...sameStepRules.map((r) => r.position)) + 10;
  const sample = effectiveStage.queue.find((q) => q.wa) ?? effectiveStage.queue[0] ?? null;
  const waiting = (s: StageView) => s.queue.filter((q) => q.execution?.status !== "sent").length;
  const markDirty = (id: string) => (d: boolean) => setDirty((p) => (p[id] === d ? p : { ...p, [id]: d }));
  const seedOf = (t: Rule | null): Draft | undefined => {
    if (!t || effectiveStage.versions.some((v) => (v.action ?? "principal") === t.action)) return undefined;
    const from = stages.find((s) => s.key === t.stage)?.versions.find((v) => (v.action ?? "principal") === t.action && v.status === "active");
    return from ? draftOf(from) : undefined;
  };
  function go(next: () => void) {
    if (isDirty && !window.confirm(DISCARD)) return;
    setDirty({});
    next();
  }
  function chooseCommercial(key: CommercialStageKey) {
    if (key === commercial) return;
    go(() => {
      setCommercial(key);
      setStageKey(technicalOf(key)[0] ?? "no-responde");
      setSelected(null);
      setTemplate(null);
    });
  }
  return (
    <>
      <div className="fu-flowrow">
        <span className="fu-lbl fu-flowlabel">Etapas comerciales</span>
        <nav className="fu-flow" aria-label="Etapas comerciales" data-testid="followup-flow">
          {COMMERCIAL_STAGES.map((s, i) => (
            <Fragment key={s.key}>
              <button type="button" className={`fu-flowstep${commercial === s.key ? " is-on" : ""}`}
                aria-pressed={commercial === s.key} data-testid="followup-commercial-stage" data-stage={s.key}
                onClick={() => chooseCommercial(s.key)}>
                <span className="fu-num">{i + 1}</span>
                <span className="fu-flowtext">
                  <b>{s.title}</b>
                  <small>{s.technical.reduce((n, key) => n + waiting(stages.find((x) => x.key === key)!), 0)} esperando</small>
                </span>
              </button>
              {i < COMMERCIAL_STAGES.length - 1 && <ChevronRight className="fu-flowarrow" size={16} aria-hidden="true" />}
            </Fragment>
          ))}
        </nav>
      </div>
      <section className="fu-stagehead" data-testid="followup-stage-head" data-stage={commercial}>
        <div>
          <div className="fu-name">
            <span className="fu-num">{COMMERCIAL_STAGES.findIndex((s) => s.key === commercial) + 1}</span>
            <span className="fu-title">{COMMERCIAL_STAGES.find((s) => s.key === commercial)?.title}</span>
            <span className="fu-badge-on">Reglas de la etapa</span>
          </div>
          <p className="fu-note">Las condiciones de avance, las respuestas de WhatsApp y los eventos de producto se configuran dentro de cada regla.</p>
        </div>
        <p className="fu-note">Seleccioná una regla para editarla o creá una nueva. La cola de ejecución muestra a quién corresponde aplicarla.</p>
      </section>
      <div className="fu-state-workspace" data-testid="followup-rules-workspace"
        style={{ display: "grid", gridTemplateColumns: "minmax(300px, 0.85fr) minmax(680px, 2fr)", gap: 14, alignItems: "start", overflowX: "auto" }}>
        <section className="fu-detail-card" style={{ padding: 14, minWidth: 0 }} data-testid="followup-rules-list">
          <RulesEditor
            stage={stageKey}
            rules={own}
            others={importable(stageKey, rules)}
            stageTitle={(key) => stages.find((s) => s.key === key)?.title ?? key}
            selected={current?.key ?? null}
            adding={adding}
            addingName={adding && template ? `${ruleTitle(template.stage, template)} de ${stages.find((s) => s.key === template.stage)?.title ?? template.stage}` : null}
            isDirty={isDirty}
            onSelect={(key) => go(() => { setSelected(key); setTemplate(null); })}
            onAdd={(t) => go(() => { setTemplate(t); setSelected(NEW_RULE); })}
            disabled={!steps.length}
          />
          <details style={{ marginTop: 18 }} data-testid="followup-classifier-settings">
            <summary className="fu-note" style={{ cursor: "pointer" }}>Administrar clasificaciones de WhatsApp</summary>
            <StateCatalogManager commercial={commercial} />
          </details>
        </section>
        <div className="fu-rdetail" data-testid="followup-rule-detail" style={{ minWidth: 680 }}>
          {adding && steps.length ? (
            <RuleEditor key={`${stage.key}:new:${template?.key ?? ""}`} stage={stage} rule={null} template={template} seed={seedOf(template)} sample={sample}
              nextPosition={nextPosition} siblings={sameStepRules} defaultSituation={stage.key === "no-contactado" ? "sin_respuesta" : stage.key === "no-responde" ? "confirmo_numero" : "interesado"}
              availableStages={steps} onStageChange={(key) => go(() => setStageKey(key))}
              onDirty={markDirty("regla")} onAdded={() => setSelected(null)} />
          ) : current ? (
            <RuleEditor key={`${effectiveStage.key}:${current.key}:${JSON.stringify(current)}`} stage={effectiveStage} rule={current}
              sample={sample} nextPosition={nextPosition} siblings={sameStepRules} availableStages={steps} onDirty={markDirty("regla")}
              onDeleted={() => { setDirty({}); setSelected(null); }} />
          ) : (
            <div className="fu-detail-card"><p className="fu-note">
              {steps.length ? "No hay reglas para esta etapa. Agregá una regla y elegí en su editor el estado de avance, las condiciones y la acción." : "Cliente es el último hito del funnel; no hay reglas de seguimiento técnico configurables para esta etapa."}
            </p></div>
          )}
        </div>
      </div>
      <ChangeLog changes={changes} />
    </>
  );
}

/** Las reglas de la etapa: se evalúan en orden y gana la primera que cumple. Elegir una abre su editor. */
function RulesEditor({
  stage,
  rules,
  others,
  stageTitle,
  selected,
  adding,
  addingName,
  isDirty,
  onSelect,
  onAdd,
  disabled = false,
}: {
  stage: StageKey;
  rules: Rule[];
  /** Reglas de otras etapas que se pueden traer a esta. */
  others: Rule[];
  stageTitle: (k: StageKey) => string;
  selected: string | null;
  adding: boolean;
  addingName: string | null;
  isDirty: boolean;
  onSelect: (key: string) => void;
  /** Agregar: `null` es una regla nueva; una regla, una copia de esa. */
  onAdd: (template: Rule | null) => void;
  disabled?: boolean;
}) {
  const [menu, setMenu] = useState(false);
  const [picking, setPicking] = useState(false);
  const groups = [...new Set(others.map((r) => r.stage))].map((k) => ({ key: k, rules: others.filter((r) => r.stage === k).sort((a, b) => a.position - b.position) }));
  return (
    <div className="fu-rules" data-testid="followup-rules" data-stage={stage}>
      <div className="fu-rules-head">
        <div>
          <h3>Reglas de esta etapa</h3>
          <p className="fu-note">Se evalúan en orden. Se ejecuta la primera que cumpla.</p>
        </div>
        <div className="fu-kebabwrap">
          <button type="button" className="button button-small button-outline" data-testid="followup-rule-add" disabled={disabled} aria-expanded={menu} onClick={() => setMenu(!menu)}>
            <Plus size={15} aria-hidden="true" /> Agregar regla <ChevronDown size={14} aria-hidden="true" />
          </button>
          {menu && (
            <div className="fu-menu fu-addmenu" role="menu">
              <button type="button" role="menuitem" data-testid="followup-rule-add-new" onClick={() => { setMenu(false); onAdd(null); }}>
                <Plus size={15} aria-hidden="true" />
                <span>
                  <b>Crear una regla nueva</b>
                  <small>Desde cero, para esta etapa.</small>
                </span>
              </button>
              <button type="button" role="menuitem" data-testid="followup-rule-add-existing" onClick={() => { setMenu(false); setPicking(true); }}>
                <Copy size={15} aria-hidden="true" />
                <span>
                  <b>Usar una regla existente</b>
                  <small>Copiar una regla de otra etapa.</small>
                </span>
              </button>
            </div>
          )}
        </div>
      </div>
      {picking && (
        <div className="fu-dlg" role="dialog" aria-modal="true" aria-labelledby="fu-pick-title" data-testid="followup-rule-pick">
          <div className="fu-pick">
            <h4 id="fu-pick-title">Usar una regla existente</h4>
            <p>Elegí una regla de otra etapa. Se copia a esta con sus condiciones; la revisás y la guardás. La original no cambia.</p>
            <div className="fu-picklist">
              {groups.map((g) => (
                <section key={g.key}>
                  <span className="fu-lbl">{stageTitle(g.key)}</span>
                  {g.rules.map((r) => (
                    <button
                      key={r.key}
                      type="button"
                      className="fu-pickrow"
                      data-testid="followup-rule-pick-item"
                      onClick={() => {
                        setPicking(false);
                        onAdd(r);
                      }}
                    >
                      <span className="fu-rulepos">{r.position}</span>
                      <span className="fu-rulemain">
                        <b>{ruleTitle(r.stage, r)}</b>
                        <span>{ruleShort(r.stage, r)}</span>
                      </span>
                      {!r.enabled && <small className="fu-note">Apagada</small>}
                    </button>
                  ))}
                </section>
              ))}
              {!groups.length && <p className="fu-empty">Ninguna regla de otra etapa se puede usar en esta. Creá una nueva.</p>}
            </div>
            <div className="fu-actions">
              <button type="button" className="button button-small button-outline" onClick={() => setPicking(false)}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
      {rules.map((r) => (
        <RuleRow key={r.key} stage={r.stage} rule={r} selected={selected === r.key} isDirty={isDirty} onSelect={() => onSelect(r.key)} />
      ))}
      {adding && (
        <div className="fu-rulecard is-on is-new">
          <span className="fu-rulepos">+</span>
          <span className="fu-rulemain">
            <b>{addingName ? `Copia de «${addingName}` : "Nueva regla"}</b>
            <span>{addingName ? "Revisala a la derecha y guardala." : "Completala a la derecha y guardala."}</span>
          </span>
        </div>
      )}
      {!rules.length && !adding && <p className="fu-empty">Esta etapa no tiene reglas. Agregá una para que el motor la ejecute.</p>}
    </div>
  );
}

/** Una regla en la lista: orden, acción, condición en una línea y el interruptor de activa. */
function RuleRow({ stage, rule, selected, isDirty, onSelect }: { stage: StageKey; rule: Rule; selected: boolean; isDirty: boolean; onSelect: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function toggle(enabled: boolean) {
    if (selected && isDirty && !window.confirm(DISCARD)) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/admin/follow-up/reglas", { method: "PUT", body: JSON.stringify({ ...rule, enabled }) });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos guardar la regla.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={`fu-rulecard${selected ? " is-on" : ""}${rule.enabled ? "" : " is-off"}`} data-testid="followup-rule" data-rule={rule.key}>
      <GripVertical className="fu-grip" size={16} aria-hidden="true" />
      <button type="button" className="fu-rulecard-main" aria-pressed={selected} data-testid="followup-rule-edit" onClick={onSelect}>
        <span className="fu-rulepos">{rule.position}</span>
        <span className="fu-rulemain">
          <b>{ruleTitle(stage, rule)}</b>
          <span>{ruleShort(stage, rule)}</span>
        </span>
      </button>
      <label className="fu-switch" title={rule.enabled ? "Activa" : "Apagada"}>
        <input
          type="checkbox"
          checked={rule.enabled}
          disabled={busy}
          onChange={(e) => toggle(e.target.checked)}
          data-testid="followup-rule-toggle"
          aria-label={`${rule.enabled ? "Apagar" : "Activar"} la regla ${rule.position}`}
        />
      </label>
      {error && <small className="fu-error">{error}</small>}
    </div>
  );
}

const DAY_PRESETS = [
  { label: "Lunes – Sábado", days: [1, 2, 3, 4, 5, 6] },
  { label: "Lunes – Viernes", days: [1, 2, 3, 4, 5] },
  { label: "Todos los días", days: [0, 1, 2, 3, 4, 5, 6] },
];
const HOUR_PRESETS: [number, number][] = [
  [9, 18],
  [9, 19],
  [9, 20],
  [10, 19],
  [8, 20],
];

/**
 * El editor de una regla, como el diseño: «Cuándo se ejecuta» y «Qué se
 * ejecuta» lado a lado, el mensaje debajo y la vista previa de WhatsApp a la
 * derecha. «Guardar cambios» guarda la regla; el mensaje se guarda con sus
 * botones (son versiones: APIs separadas). Desde ⋮ se duplica o se quita.
 */
function RuleEditor({
  stage,
  rule,
  template = null,
  seed,
  sample,
  nextPosition,
  defaultSituation = "sin_respuesta",
  availableStages = [],
  onStageChange,
  siblings = [],
  onDirty,
  onAdded,
  onDeleted,
}: {
  stage: StageView;
  rule: Rule | null;
  /** Al agregar: la regla de otra etapa que se copia (null: una nueva). */
  template?: Rule | null;
  /** Al copiar: el mensaje con el que arranca, si la acción no tiene ninguno en esta etapa. */
  seed?: Draft;
  sample: QueueItem | null;
  nextPosition: number;
  defaultSituation?: Situation;
  availableStages?: StageKey[];
  onStageChange?: (key: StageKey) => void;
  siblings?: Rule[];
  onDirty: (dirty: boolean) => void;
  onAdded?: () => void;
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const available = actionsOf(stage.key);
  const blank: Rule = template
    ? { ...template, key: "", name: template.name ?? null, stage: stage.key, position: nextPosition, enabled: true, days: [...template.days], situations: [...template.situations] }
    : { key: "", name: null, stage: stage.key, situations: [defaultSituation], action: available[0], after_hours: 48, after_action: null, position: nextPosition, enabled: true, hours_from: 9, hours_to: 19, days: [1, 2, 3, 4, 5, 6] };
  const base = rule ? { ...rule, name: rule.name ?? null } : blank;
  const [r, setR] = useState<Rule>(base);
  const createDemoTask = stage.key === "sin-demo" && r.action === "principal";
  const [msgDirty, setMsgDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [menu, setMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const msg = useRef<MsgController | null>(null);
  // El mensaje es de la acción: otras reglas con la misma acción usan el mismo texto.
  const sharedWith = siblings.filter((x) => x.key !== base.key && x.action === r.action);
  const ruleDirty = JSON.stringify(r) !== JSON.stringify(base);
  const report = useRef(onDirty);
  useEffect(() => {
    report.current = onDirty;
  });
  useEffect(() => {
    report.current(ruleDirty || msgDirty);
  }, [ruleDirty, msgDirty]);
  useEffect(() => () => report.current(false), []);

  const set = (patch: Partial<Rule>) => setR({ ...r, ...patch });
  const toggleSituation = (x: Rule["situations"][number]) => set({ situations: r.situations.includes(x) ? r.situations.filter((y) => y !== x) : [...r.situations, x] });
  const remaining = SITUATION_OPTIONS.filter((x) => !r.situations.includes(x));
  const dayPreset = DAY_PRESETS.find((p) => p.days.join() === [...r.days].sort((a, b) => a - b).join());
  const hourValue = `${r.hours_from}-${r.hours_to}`;
  const hourOptions = HOUR_PRESETS.some(([f, t]) => `${f}-${t}` === hourValue) ? HOUR_PRESETS : [[r.hours_from, r.hours_to] as [number, number], ...HOUR_PRESETS];
  function setAction(a: Action) {
    if (a === r.action) return;
    if (msgDirty && !window.confirm(DISCARD)) return;
    setMsgDirty(false);
    set({ action: a, after_action: r.after_action === a ? null : r.after_action });
  }
  async function call(work: () => Promise<unknown>, after?: () => void) {
    setBusy(true);
    setError("");
    try {
      await work();
      after?.();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos guardar la regla.");
    } finally {
      setBusy(false);
    }
  }
  /** Guarda lo que cambió: la regla y su mensaje (dos APIs, una después de la otra). Si una falla, lo dice y no se pierde el borrador. */
  const save = () =>
    call(async () => {
      if (!rule || ruleDirty) await api("/api/admin/follow-up/reglas", { method: "PUT", body: JSON.stringify(r) });
      if (msgDirty && msg.current) {
        try {
          await msg.current.save();
        } catch (e) {
          throw new Error(`${!rule || ruleDirty ? "La regla quedó guardada, pero el mensaje no: " : ""}${e instanceof Error ? e.message : "no pudimos guardar el mensaje."}`, { cause: e });
        }
      }
    }, () => !rule && onAdded?.());
  const duplicate = () => {
    setMenu(false);
    void call(() => api("/api/admin/follow-up/reglas", { method: "PUT", body: JSON.stringify({ ...base, key: undefined, name: base.name ? `${base.name} (copia)`.slice(0, 80) : null, position: base.position + 5 }) }));
  };
  const remove = () => call(() => api("/api/admin/follow-up/reglas", { method: "DELETE", body: JSON.stringify({ key: base.key }) }), () => { setConfirmDelete(false); onDeleted?.(); });

  return (
    <div className="fu-detail-card fu-ruleform" data-testid="followup-rule-form">
      <header className="fu-rdhead">
        <div className="fu-rdtitle">
          <div className="fu-rdline">
            <span className="fu-ruletag">{rule ? `Regla ${r.position}` : "Nueva regla"}</span>
            <input
              className="fu-rdname"
              value={r.name ?? ""}
              maxLength={80}
              size={Math.max(8, (r.name || actionLabel(stage.key, r.action as Action)).length + 1)}
              placeholder={actionLabel(stage.key, r.action as Action)}
              onChange={(e) => set({ name: e.target.value || null })}
              data-testid="followup-rule-name"
              aria-label="Nombre de la regla"
              title="Nombre de la regla (opcional). Sin nombre se muestra la acción."
            />
            <Pencil className="fu-rdpen" size={14} aria-hidden="true" />
          </div>
          <p className="fu-note">{ruleWhen(stage.key, r)}</p>
        </div>
        <div className="fu-rdtools">
          <label className="fu-switch">
            <input type="checkbox" checked={r.enabled} onChange={(e) => set({ enabled: e.target.checked })} data-testid="followup-rule-enabled" /> Activa
          </label>
          {rule && (
            <div className="fu-kebabwrap">
              <button type="button" className="fu-kebab" aria-label="Opciones de la regla" aria-expanded={menu} data-testid="followup-rule-menu" onClick={() => setMenu(!menu)}>
                <MoreVertical size={17} aria-hidden="true" />
              </button>
              {menu && (
                <div className="fu-menu" role="menu">
                  <button type="button" role="menuitem" onClick={duplicate} disabled={busy}>
                    <Copy size={15} aria-hidden="true" /> Duplicar regla
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="is-danger"
                    data-testid="followup-rule-delete"
                    onClick={() => {
                      setMenu(false);
                      setConfirmDelete(true);
                    }}
                  >
                    <Trash2 size={15} aria-hidden="true" /> Eliminar regla
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      <div className="fu-rgrid">
        <section className="fu-box fu-when" data-testid="followup-part-when">
          <h4>
            <CalendarDays size={16} aria-hidden="true" /> Cuándo se ejecuta
          </h4>
          <label className="fu-f">
            <span>Estado de avance (etapa técnica)</span>
            <select aria-label="Estado de avance de la regla" value={stage.key} disabled={Boolean(rule) || !onStageChange}
              onChange={(e) => onStageChange?.(e.target.value as StageKey)}>
              {(availableStages.length ? availableStages : [stage.key]).map((key) => (
                <option key={key} value={key}>{technicalStateLabel(key)}</option>
              ))}
            </select>
            {rule && <small>Para mover una regla a otro estado, creá una nueva con las mismas condiciones; así se conserva el historial.</small>}
          </label>
          <div className="fu-f">
            <span>Situación (cualquiera de)</span>
            <div className="fu-chips">
              {r.situations.map((x) => (
                <button key={x} type="button" className="fu-chipbtn is-on" aria-pressed="true" title="Quitar" onClick={() => toggleSituation(x)}>
                  ✓ {SITUATIONS[x]}
                </button>
              ))}
              {!r.situations.length && <span className="fu-chipbtn is-on is-static">✓ Cualquier situación</span>}
              {remaining.length > 0 && (
                <select className="fu-chipadd" value="" aria-label="Agregar situación" onChange={(e) => e.target.value && toggleSituation(e.target.value as Rule["situations"][number])}>
                  <option value="">+ Agregar</option>
                  {remaining.map((x) => (
                    <option key={x} value={x}>
                      {SITUATIONS[x]}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
          <label className="fu-f">
            <span>Paso previo</span>
            <select value={r.after_action ?? ""} onChange={(e) => set({ after_action: (e.target.value || null) as Rule["after_action"] })}>
              <option value="">Ningún paso</option>
              {available
                .filter((a) => a !== r.action)
                .map((a) => (
                  <option key={a} value={a}>
                    {actionLabel(stage.key, a)}
                  </option>
                ))}
            </select>
          </label>
          <div className="fu-f">
            <span>Espera</span>
            <div className="fu-wait">
              <input type="number" min={0} max={720} step={1} value={r.after_hours} onChange={(e) => set({ after_hours: Number(e.target.value) })} data-testid="followup-rule-hours" aria-label="Espera en horas" />
              <small>horas desde nuestro último mensaje</small>
            </div>
          </div>
          <div className="fu-f">
            <span>Horario de envío</span>
            <div className="fu-hours2">
              <select
                value={dayPreset?.label ?? "custom"}
                aria-label="Días"
                onChange={(e) => {
                  const p = DAY_PRESETS.find((x) => x.label === e.target.value);
                  if (p) set({ days: p.days });
                }}
              >
                {DAY_PRESETS.map((p) => (
                  <option key={p.label} value={p.label}>
                    {p.label}
                  </option>
                ))}
                {!dayPreset && <option value="custom">{daysText(r.days)}</option>}
              </select>
              <select
                value={hourValue}
                aria-label="Horas"
                onChange={(e) => {
                  const [from, to] = e.target.value.split("-").map(Number);
                  set({ hours_from: from, hours_to: to });
                }}
              >
                {hourOptions.map(([f, t]) => (
                  <option key={`${f}-${t}`} value={`${f}-${t}`}>
                    {f}:00 – {t}:00
                  </option>
                ))}
              </select>
            </div>
          </div>
          {["no-abrio", "sin-interaccion", "sin-cuenta"].includes(stage.key) && (
            <label className="fu-f">
              <span>Condición de interacción con la demo</span>
              <select aria-label="Condición de generación de imagen" value={r.min_demo_activity_level ?? 0} onChange={(e) => set({ min_demo_activity_level: Number(e.target.value) })}>
                <option value={0}>Cualquier nivel de interacción</option>
                <option value={3}>Solo si generó una imagen</option>
              </select>
            </label>
          )}
          <label className="fu-f fu-order">
            <span>Orden de prioridad</span>
            <input type="number" min={0} max={1000} value={r.position} onChange={(e) => set({ position: Number(e.target.value) })} />
          </label>
        </section>

        <Editor
          key={`${stage.key}:${r.action}`}
          stage={versionsOf(stage, r.action as Action)}
          action={r.action as Action}
          taskOnly={createDemoTask}
          seed={template && r.action === template.action ? seed : undefined}
          sample={sample}
          onDirty={setMsgDirty}
          controller={msg}
          sharedNote={sharedWith.length ? `Este mensaje también lo usa ${sharedWith.length === 1 ? "la regla" : "las reglas"} ${sharedWith.map((x) => x.position).join(", ")}: cambiarlo acá lo cambia para ${sharedWith.length === 1 ? "las dos" : "todas"}.` : undefined}
          actionField={
            <label className="fu-f">
              <span>Acción que se ejecuta</span>
              <select value={r.action} onChange={(e) => setAction(e.target.value as Action)} data-testid="followup-rule-action">
                {available.map((a) => (
                  <option key={a} value={a}>
                    {actionLabel(stage.key, a)}
                  </option>
                ))}
              </select>
            </label>
          }
        />
      </div>

      <footer className="fu-footer">
        {error && (
          <p className="fu-error" role="alert">
            {error}
          </p>
        )}
        {msgDirty && <p className="fu-hint">«Guardar cambios» guarda la regla y el mensaje.</p>}
        <div className="fu-actions">
          <button
            type="button"
            className="button button-small button-outline"
            disabled={busy || (!ruleDirty && !msgDirty)}
            onClick={() => {
              setR(base);
              msg.current?.discard();
              setError("");
            }}
          >
            Cancelar
          </button>
          <button type="button" className="button button-primary button-small" data-testid="followup-rule-save" disabled={busy || (!!rule && !ruleDirty && !msgDirty)} onClick={save}>
            {rule ? "Guardar cambios" : "Crear regla"}
          </button>
        </div>
      </footer>

      {confirmDelete && (
        <div className="fu-dlg" role="dialog" aria-modal="true" aria-labelledby="fu-dlg-title">
          <div>
            <h4 id="fu-dlg-title">
              ¿Quitar la regla {base.position} · {ruleTitle(stage.key, base)}?
            </h4>
            <p>La regla deja de existir y el motor ya no la evalúa. Sus mensajes, versiones, ejecuciones y métricas se conservan. Si después hace falta, se vuelve a agregar.</p>
            <div className="fu-actions">
              <button type="button" className="button button-small button-outline" disabled={busy} onClick={() => setConfirmDelete(false)}>
                Cancelar
              </button>
              <button type="button" className="button button-small fu-danger" data-testid="followup-rule-delete-confirm" disabled={busy} onClick={remove}>
                Quitar regla
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * El mensaje de una acción, en tres partes: «Qué se ejecuta» (acción, versión,
 * editar y nueva versión), el mensaje con sus pestañas (texto, otras versiones,
 * observaciones y CTA) y la vista previa de WhatsApp. Los botones de guardar
 * son los de siempre: crear una versión, editarla o cambiar su estado.
 */
/** Lo que la regla le pide al editor del mensaje: guardarlo y descartarlo desde su pie. */
type MsgController = { save: () => Promise<void>; discard: () => void };

function Editor({
  stage,
  action,
  sample,
  onDirty,
  actionField,
  controller,
  sharedNote,
  seed,
  taskOnly = false,
}: {
  stage: StageView;
  action: Action;
  sample: QueueItem | null;
  onDirty?: (dirty: boolean) => void;
  actionField?: React.ReactNode;
  controller?: { current: MsgController | null };
  sharedNote?: string;
  /** Mensaje con el que arranca si la acción todavía no tiene ninguno. */
  seed?: Draft;
  taskOnly?: boolean;
}) {
  const router = useRouter();
  const live = stage.versions.find((v) => v.status === "active") ?? stage.versions.at(-1) ?? null;
  const [selected, setSelected] = useState<string | null>(live?.id ?? null);
  const [draft, setDraft] = useState<Draft | null>(() => (!live && seed ? { ...seed, editing: undefined } : null));
  const [tab, setTab] = useState<MsgTab>("mensaje");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const current = stage.versions.find((v) => v.id === selected) ?? live;
  const original = stage.versions.find((v) => v.version === 1) ?? null;
  const shown: Draft | Version | null = draft ?? current;
  const active = stage.versions.find((v) => v.status === "active");
  const nextNumber = Math.max(0, ...stage.versions.map((v) => v.version)) + 1;
  const bodyId = `fu-body-${stage.key}-${action}`;
  const editing = draft?.editing ? stage.versions.find((v) => v.id === draft.editing) ?? null : null;
  const dirtyDraft = draft !== null && (editing ? JSON.stringify(draft) !== JSON.stringify(draftOf(editing, editing.id)) : draft.body.trim() !== "" || draft.notes.trim() !== "" || draft.trigger.trim() !== "");
  const report = useRef(onDirty);
  useEffect(() => {
    report.current = onDirty;
  });
  useEffect(() => {
    report.current?.(dirtyDraft);
  }, [dirtyDraft]);
  useEffect(() => () => report.current?.(false), []);

  const confirmDiscard = () => !dirtyDraft || window.confirm(DISCARD);
  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await work();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos guardar.");
    } finally {
      setBusy(false);
    }
  }
  const save = (status: "active" | "test") =>
    run(async () => {
      const v = await api<Version>("/api/admin/follow-up/versiones", { method: "POST", body: JSON.stringify({ stage: stage.key, action, ...draft, status }) });
      setDraft(null);
      setSelected(v.id);
    });
  /** Guarda el borrador: edita la versión que se estaba viendo, o crea la nueva como activa. Tira el error para quien lo llama. */
  async function persist() {
    if (!draft) return;
    if (draft.editing) {
      await api<Version>("/api/admin/follow-up/versiones", { method: "PUT", body: JSON.stringify({ id: draft.editing, ...draft }) });
    } else {
      const v = await api<Version>("/api/admin/follow-up/versiones", { method: "POST", body: JSON.stringify({ stage: stage.key, action, ...draft, editing: undefined, status: "active" }) });
      setSelected(v.id);
    }
    setDraft(null);
  }
  const update = () => run(persist);
  /** Escribir abre la edición de la versión que se ve (o un mensaje nuevo si no hay ninguna). */
  const ensure = (patch: Partial<Draft>) => setDraft((d) => ({ ...(d ?? (current ? draftOf(current, current.id) : EMPTY)), ...patch }));
  useEffect(() => {
    if (controller) controller.current = { save: persist, discard: () => setDraft(null) };
  });
  const setStatus = (id: string, status: VersionStatus) => run(() => api("/api/admin/follow-up/versiones", { method: "PATCH", body: JSON.stringify({ id, status }) }));
  function pick(id: string) {
    if (!confirmDiscard()) return;
    setDraft(null);
    setSelected(id);
    setTab("mensaje");
  }
  function newVersion() {
    if (!confirmDiscard()) return;
    setDraft(current ? { ...draftOf(current), editing: undefined } : EMPTY);
    setTab("mensaje");
  }
  function editVersion(v: Version) {
    if (!confirmDiscard()) return;
    setDraft(draftOf(v, v.id));
    setTab("mensaje");
  }
  function insert(name: string) {
    const base = draft ?? (current ? draftOf(current, current.id) : EMPTY);
    const el = document.getElementById(bodyId) as HTMLTextAreaElement | null;
    const at = el?.selectionStart ?? base.body.length;
    setDraft({ ...base, body: `${base.body.slice(0, at)}{{${name}}}${base.body.slice(at)}` });
  }

  const selectValue = draft ? draft.editing ?? NEW_VERSION : current?.id ?? "";
  const pill = editing ? `Editando V${editing.version}` : draft ? `Nueva versión (V${nextNumber})` : current ? `V${current.version} (${STATUS_LABEL[current.status].toLowerCase()})` : "";
  const inRule = Boolean(controller);
  const actionButtons = editing ? (
    <>
      {!inRule && (
        <button type="button" className="button button-primary button-small" disabled={busy || !draft?.body.trim() || !dirtyDraft} onClick={update}>
          Guardar mensaje
        </button>
      )}
      {dirtyDraft && (
        <button type="button" className="button button-small button-outline" disabled={busy || !draft?.body.trim()} onClick={() => save("active")}>
          Guardar como V{nextNumber} (nueva)
        </button>
      )}
      <button type="button" className="fu-link" disabled={busy} onClick={() => setDraft(null)}>
        {dirtyDraft ? "Descartar" : "Cancelar"}
      </button>
      {editing.stats.executions > 0 && (
        <p className="fu-note">
          V{editing.version} ya tiene {editing.stats.executions} {editing.stats.executions === 1 ? "ejecución" : "ejecuciones"}: si cambiás el texto, sus números van a juntar el anterior y el nuevo. Para comparar dos textos, mejor «Nueva versión».
        </p>
      )}
    </>
  ) : draft ? (
    <>
      {!inRule && (
        <button type="button" className="button button-primary button-small" disabled={busy || !draft.body.trim()} onClick={() => save("active")}>
          Guardar V{nextNumber} como activa
        </button>
      )}
      {active && (
        <button type="button" className="button button-small button-outline" disabled={busy || !draft.body.trim()} onClick={() => save("test")}>
          Guardar y probar A/B contra V{active.version}
        </button>
      )}
      <button type="button" className="fu-link" disabled={busy} onClick={() => setDraft(null)}>
        Descartar
      </button>
    </>
  ) : current?.status === "test" ? (
    <>
      <button type="button" className="button button-primary button-small" disabled={busy} onClick={() => setStatus(current.id, "active")}>
        Hacerla la activa
      </button>
      <button type="button" className="button button-small button-outline" disabled={busy} onClick={() => setStatus(current.id, "archived")}>
        Detener prueba
      </button>
    </>
  ) : current && current.status !== "active" ? (
    <>
      <button type="button" className="button button-small button-outline" disabled={busy} onClick={() => setStatus(current.id, "active")}>
        Volver a activarla
      </button>
      {active && (
        <button type="button" className="button button-small button-outline" disabled={busy} onClick={() => setStatus(current.id, "test")}>
          Probar A/B contra V{active.version}
        </button>
      )}
    </>
  ) : null;

  // Crear demo is an internal task. It needs only extension instructions here;
  // WhatsApp text, A/B controls and previews remain unchanged for message actions.
  if (taskOnly) {
    const instructions = draft?.notes ?? current?.notes ?? "";
    return (
      <div className="fu-mededit" data-testid="followup-task-editor" data-action={action}>
        <section className="fu-box fu-what" data-testid="followup-part-what">
          <h4><Building2 size={16} aria-hidden="true" /> Acción interna</h4>
          {actionField}
          <p className="fu-note">Crear una demo para la inmobiliaria. Esta tarea aparece en la cola y abre la creación desde su ficha.</p>
          <label className="fu-f">
            <span>Observaciones para la extensión</span>
            <textarea aria-label="Observaciones para crear demo" data-testid="followup-create-demo-notes" rows={6} maxLength={4000}
              value={instructions} placeholder="Ej.: elegí una propiedad atractiva, importá sus fotos, generá tres ambientes y publicá la demo."
              onChange={(e) => ensure({ notes: e.target.value, channel: "task", ctas: ["create_demo"] })} />
          </label>
          {sharedNote && <p className="fu-warn">{sharedNote}</p>}
          <p className="fu-hint">Estas instrucciones se guardan al tocar «Guardar cambios». No se envía ningún mensaje desde esta acción.</p>
          {error && <p className="fu-error" role="alert">{error}</p>}
        </section>
        <section className="fu-box" data-testid="followup-task-preview">
          <h4><Target size={16} aria-hidden="true" /> Vista previa de la tarea</h4>
          <p><b>Crear demo</b> · {sample?.name ?? "Inmobiliaria de ejemplo"}</p>
          <p className="fu-note" style={{ whiteSpace: "pre-wrap" }}>{instructions || "Agregá observaciones para indicarle a la extensión cómo crear la demo."}</p>
          <p className="fu-hint">En la cola, «Crear demo» abre la ficha de la inmobiliaria. La etapa avanza al publicar la demo.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="fu-mededit" data-testid="followup-message-editor" data-action={action}>
      <section className="fu-box fu-what" data-testid="followup-part-what">
        <h4>
          <Send size={16} aria-hidden="true" /> Qué se ejecuta
        </h4>
        {actionField}
        <label className="fu-f fu-vsel">
          <span>Versión del mensaje</span>
          <select value={selectValue} onChange={(e) => { if (e.target.value !== NEW_VERSION) pick(e.target.value); }} data-testid="followup-version-select">
            {!stage.versions.length && !draft && <option value="">Sin versión</option>}
            {stage.versions.map((v) => (
              <option key={v.id} value={v.id}>
                V{v.version} ({STATUS_LABEL[v.status].toLowerCase()})
              </option>
            ))}
            {draft && !draft.editing && <option value={NEW_VERSION}>Borrador V{nextNumber}</option>}
          </select>
        </label>
        <div className="fu-stack">
          <button type="button" className="button button-small button-outline" data-testid="followup-edit-version" disabled={!current} onClick={() => current && editVersion(current)}>
            <Pencil size={14} aria-hidden="true" /> Editar versiones
          </button>
          <button type="button" className="button button-small button-outline" data-testid="followup-new-version" onClick={newVersion}>
            <Plus size={14} aria-hidden="true" /> Nueva versión
          </button>
        </div>
      </section>

      <section className="fu-box fu-msgbox">
        <div className="fu-mtabs" role="tablist">
          {(
            [
              ["mensaje", "Mensaje"],
              ["versiones", `Otras versiones (${stage.versions.filter((v) => v.id !== current?.id).length})`],
              ["observaciones", "Observaciones (extensión)"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "is-on" : undefined} onClick={() => setTab(k)}>
              {k === "mensaje" ? <MessageCircle size={14} aria-hidden="true" /> : k === "versiones" ? <Layers size={14} aria-hidden="true" /> : <Info size={14} aria-hidden="true" />}
              {label}
            </button>
          ))}
        </div>

        <div className="fu-mbody">
          {tab === "mensaje" &&
            (!shown ? (
              <div className="fu-miss" role="status">
                Falta configurar el mensaje de esta acción.
                <button type="button" className="button button-primary button-small" onClick={newVersion}>
                  <Plus size={14} aria-hidden="true" /> Crear mensaje
                </button>
              </div>
            ) : (
              <div className="fu-msg-row">
                <div className="fu-msg-text">
                  {pill && <span className="fu-vpill">{pill}</span>}
                  <textarea id={bodyId} aria-label="Mensaje" data-testid="followup-message-body" value={shown.body} maxLength={4000} onChange={(e) => ensure({ body: e.target.value })} />
                  <div className="fu-vars">
                    {(Object.keys(VARIABLES) as (keyof typeof VARIABLES)[]).map((k) => (
                      <button key={k} type="button" className="fu-var" title={VARIABLES[k]} onClick={() => insert(k)}>
                        {`{{${k}}}`}
                      </button>
                    ))}
                  </div>
                  {sharedNote && <p className="fu-warn">{sharedNote}</p>}
                  <p className="fu-hint">
                    {inRule ? "Escribí directo y tocá «Guardar cambios». «Nueva versión» crea otra variante para comparar (A/B)." : "Escribí directo y guardalo con «Guardar mensaje». «Nueva versión» crea otra variante para comparar (A/B)."}
                  </p>
                  <p className="fu-hint">Para varios mensajes seguidos, separalos con una línea que diga solo «---».</p>
                </div>
                {original && original.id !== current?.id ? (
                  <aside className="fu-orig" data-testid="followup-original">
                    <b>Versión original (V{original.version})</b>
                    <p>{original.body}</p>
                    <button
                      type="button"
                      className="button button-small button-outline"
                      disabled={!!draft && draft.body === original.body}
                      onClick={() => {
                        if (!confirmDiscard()) return;
                        setDraft({ channel: original.channel, trigger: original.trigger_label, body: original.body, ctas: [...original.ctas], notes: original.notes ?? "" });
                      }}
                    >
                      <Undo2 size={14} aria-hidden="true" /> Usar como base
                    </button>
                  </aside>
                ) : null}
              </div>
            ))}

          {tab === "versiones" && (
            <div className="fu-vlist" data-testid="followup-versions">
              {stage.versions.length === 0 && <p className="fu-note">Todavía no hay versiones de este mensaje.</p>}
              {[...stage.versions].reverse().map((v) => (
                <div key={v.id} className={`fu-vitem${!draft && current?.id === v.id ? " is-on" : ""}`}>
                  <div className="fu-vitem-head">
                    <b>V{v.version}</b> <span className={`fu-st is-${v.status}`}>{STATUS_LABEL[v.status]}</span>
                    <span className="fu-note">
                      {v.stats.executions} ejecuciones · {pct(v.stats.rate)}
                    </span>
                  </div>
                  <p>{v.body}</p>
                  <div className="fu-actions">
                    <button type="button" className="fu-link" onClick={() => pick(v.id)}>
                      Ver
                    </button>
                    <button type="button" className="fu-link" onClick={() => editVersion(v)}>
                      Editar
                    </button>
                  </div>
                </div>
              ))}
              <div className="fu-actions">
                <button type="button" className="button button-small button-outline" onClick={newVersion}>
                  <Plus size={14} aria-hidden="true" /> Nueva versión
                </button>
              </div>
            </div>
          )}

          {tab === "observaciones" && shown && (
            <div className="fu-obsgrid">
              <label className="fu-f fu-notes">
                <span>Observaciones para la extensión · cuándo y cómo mandarlo</span>
                <textarea
                  data-testid="followup-version-notes"
                  value={draft ? draft.notes : ((shown as Version).notes ?? "")}
                  maxLength={4000}
                  placeholder="Ej.: no mandar fines de semana; si respondió con una pregunta, contestarla antes."
                  onChange={(e) => ensure({ notes: e.target.value })}
                />
              </label>
              <fieldset className="fu-ctas">
                <legend>Call to actions para la extensión</legend>
                {CTA_KEYS.map((k) => {
                  const on = shown.ctas.includes(k);
                  return (
                    <label key={k} className={`fu-cta${on ? "" : " is-off"}`}>
                      <input type="checkbox" checked={on} onChange={() => ensure({ ctas: on ? shown.ctas.filter((c) => c !== k) : [...shown.ctas, k] })} />
                      {CTA_LABEL[k]}
                    </label>
                  );
                })}
              </fieldset>
              <div className="fu-fields">
                <label className="fu-f">
                  <span>Cuándo se dispara (nota para el equipo)</span>
                  <input value={draft ? draft.trigger : (shown as Version).trigger_label} maxLength={120} placeholder="Ej.: 3 días sin respuesta" onChange={(e) => ensure({ trigger: e.target.value })} />
                </label>
                <label className="fu-f">
                  <span>Canal</span>
                  <select value={shown.channel} onChange={(e) => ensure({ channel: e.target.value as Channel })}>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="task">Tarea del equipo</option>
                  </select>
                </label>
                <label className="fu-f">
                  <span>Cuenta como conversión</span>
                  <input value={`Pasa a «${stage.goal}»`} readOnly />
                </label>
              </div>
            </div>
          )}

          {actionButtons && <div className="fu-actions fu-msgactions">{actionButtons}</div>}
          {!draft && current?.edited_at && <p className="fu-hint">Texto editado el {day(current.edited_at)}: sus números juntan el texto anterior y el nuevo.</p>}
          {error && (
            <p className="fu-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </section>

      <div className="fu-pvcol">
        <h4>
          <MessageCircle size={16} aria-hidden="true" /> {shown?.channel === "task" ? "Vista previa de la tarea" : "Vista previa en WhatsApp"}
        </h4>
        <Preview body={shown?.body ?? ""} sample={sample} channel={shown?.channel ?? "whatsapp"} ctas={shown?.ctas ?? []} />
      </div>
    </div>
  );
}

/**
 * Vista previa de WhatsApp con una inmobiliaria de la etapa: cada mensaje
 * (separado por «---») en su burbuja, con las variables resueltas. No envía
 * nada ni genera ejecuciones. Si el canal es una tarea, muestra la tarea.
 */
function Preview({ body, sample, channel, ctas }: { body: string; sample: QueueItem | null; channel: Channel; ctas: Cta[] }) {
  const ctx = { inmobiliaria: sample?.shortName ?? "Inmobiliaria de ejemplo", decisor: sample?.person ?? null, sdr: "vos", demo: sample?.hasDemo ? "[link a su demo]" : null, panel: "[link a su panel]" };
  const parts = splitMessages(body).map((p) => fillMessage(p, ctx));
  const holes = missingVariables(parts.join("\n"));
  const who = sample?.shortName ?? "Inmobiliaria de ejemplo";
  if (channel === "task")
    return (
      <div className="fu-wa is-task" data-testid="followup-preview">
        <div className="fu-wa-task">{parts.length ? parts.map((p, i) => <p key={i}>{p}</p>) : <p className="fu-note">Escribí la tarea para ver cómo queda.</p>}</div>
      </div>
    );
  return (
    <div className="fu-wa" data-testid="followup-preview">
      <div className="fu-wa-head">
        <ArrowLeft size={15} aria-hidden="true" />
        <span className="fu-wa-avatar" aria-hidden="true">
          <Building2 size={14} />
        </span>
        <span className="fu-wa-name">{who}</span>
        <Video size={15} aria-hidden="true" />
        <Phone size={14} aria-hidden="true" />
        <MoreVertical size={15} aria-hidden="true" />
      </div>
      <div className="fu-wa-chat">
        <span className="fu-wa-day">Hoy</span>
        {parts.length ? (
          parts.map((p, i) => (
            <div key={i} className="fu-bubble is-out">
              {p}
              <span className="fu-wa-tick" aria-hidden="true">
                <CheckCheck size={13} />
              </span>
            </div>
          ))
        ) : (
          <span className="fu-wa-day">Sin mensaje todavía</span>
        )}
      </div>
      {ctas.length > 0 && <div className="fu-wa-ctas">{ctas.map((c) => <span key={c}>{CTA_LABEL[c]}</span>)}</div>}
      {holes.length > 0 && <p className="fu-warn">Sin resolver para esta inmobiliaria: {holes.map((h) => `{{${h}}}`).join(", ")}. Con ella, la acción queda bloqueada.</p>}
    </div>
  );
}

const CHANGE_LABEL: Record<string, string> = { rule: "Regla", version: "Versión" };
function ChangeLog({ changes }: { changes: Change[] }) {
  if (!changes.length) return null;
  return (
    <section className="fu-card fu-changes" data-testid="followup-changes">
      <b className="fu-cardtitle">Últimos cambios de reglas y mensajes</b>
      <ol className="fu-timeline">
        {changes.map((c, i) => (
          <li key={i} className="is-dato">
            <span>{when(c.created_at)}</span>
            {CHANGE_LABEL[c.subject] ?? c.subject} {c.ref}
            {c.actor_name ? ` · ${c.actor_name}` : ""}
          </li>
        ))}
      </ol>
    </section>
  );
}

const WINDOW_LABEL: Record<WindowKey, string> = { "7": "7 días", "14": "14 días", todo: "Sin límite" };
const COHORT_COLS = [
  ["respondio", "Respondieron"],
  ["interes", "Interesadas"],
  ["demo", "Demo enviada"],
  ["cuenta", "Cuenta creada"],
  ["suscripcion", "Suscripción"],
] as const;
const weekLabel = (w: string) => new Date(`${w}T12:00:00Z`).toLocaleDateString("es-AR", { day: "numeric", month: "short", timeZone: "UTC" });
const hoursText = (h: number | null) => (h === null ? "—" : h < 48 ? `${Math.round(h)} h` : `${(h / 24).toFixed(1).replace(".", ",")} días`);

/** Resultados (Fase 4): qué acción y qué versión mueven inmobiliarias, con ventana de atribución, cohortes y bloqueos. */
function ResultsView({ results }: { results: Results }) {
  const [win, setWin] = useState<WindowKey>("7");
  const [cohortBy, setCohortBy] = useState<"contacto" | "respuesta" | "version">("contacto");
  const data = results.windows[win];
  const maxWeek = Math.max(1, ...data.weekly.map((w) => w.executed));
  const maxBlock = Math.max(1, ...results.blocks.map((b) => b.n));
  const rows: CohortRow[] = results.cohorts[cohortBy];
  return (
    <section className="fu-results" data-testid="followup-results">
      <div className="fu-filters">
        <span className="fu-lbl">Ventana de conversión</span>
        {(Object.keys(WINDOW_LABEL) as WindowKey[]).map((k) => (
          <button key={k} type="button" className={`fu-chip${win === k ? " is-on" : ""}`} aria-pressed={win === k} data-testid={`followup-window-${k}`} onClick={() => setWin(k)}>
            {WINDOW_LABEL[k]}
          </button>
        ))}
      </div>
      <div className="fu-kpis fu-kpis-5">
        <div className="fu-kpi">
          <span>Ejecuciones confirmadas</span>
          <b>{results.totals.executed30}</b>
          <small>confirmadas, últimos 30 días</small>
        </div>
        <div className="fu-kpi">
          <span>Respondieron por primera vez</span>
          <b>{results.totals.replies30}</b>
          <small>últimos 30 días</small>
        </div>
        <div className="fu-kpi">
          <span>Acciones pendientes</span>
          <b>{results.totals.pending}</b>
          <small>{results.totals.blocked} bloqueadas o programadas</small>
        </div>
        <div className="fu-kpi">
          <span>No salieron</span>
          <b>{results.totals.failed}</b>
          <small>marcadas «No se envió»</small>
        </div>
      </div>
      <div className="fu-rgrid">
        <div className="fu-card">
          <b className="fu-cardtitle">Evolución semanal · {WINDOW_LABEL[win].toLowerCase()}</b>
          <div className="fu-legend">
            <span><i className="is-ex" /> Ejecutadas</span>
            <span><i className="is-cv" /> Conversiones atribuidas</span>
          </div>
          <div className="fu-bars" role="img" aria-label="Ejecutadas y conversiones por semana">
            {data.weekly.map((w) => (
              <div key={w.week} className="fu-barcol">
                <small>
                  {w.executed} · {w.conversions}
                </small>
                <div className="fu-barpair">
                  <span className="is-ex" style={{ height: `${Math.round((w.executed / maxWeek) * 140)}px` }} />
                  <span className="is-cv" style={{ height: `${Math.max(w.conversions ? 3 : 0, Math.round((w.conversions / maxWeek) * 140))}px` }} />
                </div>
                <small>{weekLabel(w.week)}</small>
              </div>
            ))}
          </div>
        </div>
        <div className="fu-card">
          <b className="fu-cardtitle">Motivos de bloqueo</b>
          {results.blocks.length === 0 ? (
            <p className="fu-note">Nada bloqueado.</p>
          ) : (
            <ul className="fu-blockbars" data-testid="followup-results-blocks">
              {results.blocks.slice(0, 8).map((b) => (
                <li key={b.reason}>
                  <span>
                    {b.reason} <b>{b.n}</b>
                  </span>
                  <i style={{ width: `${Math.max(3, Math.round((b.n / maxBlock) * 100))}%` }} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="fu-card">
        <b className="fu-cardtitle">Por regla y versión · {WINDOW_LABEL[win].toLowerCase()}</b>
        <div className="fu-tbl">
          <table data-testid="followup-results-versions">
            <thead>
              <tr>
                <th>Paso</th>
                <th>Versión</th>
                <th>Elegibles</th>
                <th>Ejecutadas</th>
                <th>Conversiones</th>
                <th>Tasa</th>
                <th>Tiempo</th>
                <th>No salieron</th>
                <th>Muestra</th>
              </tr>
            </thead>
            <tbody>
              {data.versions.map((v) => (
                <tr key={v.versionId}>
                  <td>
                    <b>{actionLabel(v.stage as StageKey, v.action as Action)}</b>
                    <small>{stageTitle(v.stage)}</small>
                  </td>
                  <td>
                    V{v.version} <span className={`fu-st is-${v.status}`}>{STATUS_LABEL[v.status as VersionStatus] ?? v.status}</span>
                  </td>
                  <td>{v.eligible}</td>
                  <td>{v.executed}</td>
                  <td>
                    {v.conversions}
                    {v.assisted ? <small>+{v.assisted} asistencias</small> : null}
                  </td>
                  <td>
                    <b>{pct(v.rate)}</b>
                  </td>
                  <td>{hoursText(v.medianHours)}</td>
                  <td>{v.failed}</td>
                  <td>{v.best ? <span className="fu-best">MEJOR</span> : v.executed === 0 ? "—" : v.smallSample ? <small>muestra chica</small> : "OK"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="fu-note">
          Conversión: la inmobiliaria pasó del paso en que estaba al recibir el mensaje, dentro de la ventana. Si varios mensajes de la misma etapa la precedieron, cuenta solo el último (los otros son asistencias): una conversión nunca suma dos veces. «MEJOR» se marca solo entre versiones con 30 o más ejecutadas. La actividad de producto ya excluye el tráfico interno; las acciones comerciales no se excluyen.
        </p>
      </div>
      <div className="fu-card">
        <div className="fu-fhead">
          <b className="fu-cardtitle">Cohortes</b>
          <span className="fu-grow" />
          {(
            [
              ["contacto", "Por semana de contacto"],
              ["respuesta", "Por semana de primera respuesta"],
              ["version", "Por versión del saludo"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} type="button" className={`fu-chip${cohortBy === k ? " is-on" : ""}`} aria-pressed={cohortBy === k} data-testid={`followup-cohort-${k}`} onClick={() => setCohortBy(k)}>
              {label}
            </button>
          ))}
        </div>
        <div className="fu-tbl">
          <table data-testid="followup-results-cohorts">
            <thead>
              <tr>
                <th>{cohortBy === "version" ? "Segmento" : "Semana"}</th>
                <th>Inmobiliarias</th>
                {COHORT_COLS.map(([, label]) => (
                  <th key={label}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.cohort}>
                  <td>{cohortBy === "version" ? r.cohort : weekLabel(r.cohort)}</td>
                  <td>{r.size}</td>
                  {COHORT_COLS.map(([k]) => (
                    <td key={k}>
                      {r[k]} <small>{r.size ? pct(r[k] / r.size) : "—"}</small>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

const stageTitle = (key: string) => FOLLOWUP_STAGES.find((s) => s.key === key)?.title ?? key;

type Mode = "embudo" | "reglas" | "resultados";
/** What is being written: a new version, or an edit of the saved one (`editing`: its id). */
type Draft = { channel: Channel; trigger: string; body: string; ctas: Cta[]; notes: string; editing?: string };
const EMPTY: Draft = { channel: "whatsapp", trigger: "", body: "", ctas: ["whatsapp", "copy"], notes: "" };
const draftOf = (v: Version, editing?: string): Draft => ({ channel: v.channel, trigger: v.trigger_label, body: v.body, ctas: [...v.ctas], notes: v.notes ?? "", editing });

const LATE_DAYS = 5;
const daysSince = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
const score = (n: number | null) => (n === null ? "—" : String(Math.round(n * 10) / 10).replace(".", ","));
const host = (url: string) => url.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
const href = (url: string) => (/^https?:\/\//.test(url) ? url : `https://${url}`);

function Queue({ stage }: { stage: StageView }) {
  const router = useRouter();
  const [state, setState] = useState<Record<string, Exec>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [adding, setAdding] = useState(false);
  const statusOf = (q: QueueItem) => (q.agencyId in state ? state[q.agencyId] : q.execution);
  const done = stage.queue.filter((q) => statusOf(q)?.status === "sent").length;
  const list = stage.queue.slice(0, shown);
  const editable = stage.key === "no-contactado";
  // A confirmed row stays where it is (nothing moves under the cursor); «Siguiente pendiente» opens the next one.
  const finished = (q: QueueItem, exec: Exec) => setState((s) => ({ ...s, [q.agencyId]: exec }));
  function next(q: QueueItem) {
    const n = stage.queue.find((x) => x.agencyId !== q.agencyId && !x.blocked && x.action && statusOf(x)?.status !== "sent");
    setOpen(n?.agencyId ?? null);
    if (n && stage.queue.indexOf(n) >= shown) setShown(stage.queue.indexOf(n) + 1);
  }
  return (
    <div className="fu-queue">
      <div className="fu-qhead">
        <span className="fu-lbl">Inmobiliarias en esta etapa · {stage.queue.length}</span>
        <span className="fu-qprog">
          <b>{done}</b> con la acción enviada · ordenadas por score, de mayor a menor ·{" "}
          <button type="button" className="fu-link" onClick={() => router.refresh()}>
            Actualizar
          </button>
        </span>
        <button type="button" className="button button-small button-outline" data-testid="followup-add" onClick={() => setAdding(!adding)} aria-expanded={adding}>
          <Plus size={15} aria-hidden="true" /> Agregar inmobiliaria
        </button>
      </div>
      {adding && <AddAgency stage={stage} onClose={() => setAdding(false)} />}
      {stage.queue.length === 0 ? (
        <p className="fu-empty">No hay inmobiliarias en esta etapa.</p>
      ) : (
        <div className="fu-qlist">
          <div className="fu-qwide">
            <div className="fu-qrow fu-qth" aria-hidden="true">
              <span title={editable ? "El que carga la extensión con la lista: se edita acá." : "El lead score: solo lectura."}>Score</span>
              <span>Inmobiliaria</span>
              <span>Dirección y zona</span>
              <span>Web</span>
              <span>Prop.</span>
              <span>Estado</span>
              <span>Situación</span>
              <span>Última acción y fecha</span>
              <span>WhatsApp</span>
              <span>Acción</span>
              <span />
            </div>
            {list.map((q) => (
              <QueueRow key={q.agencyId} stage={stage} item={q} exec={statusOf(q)} open={open === q.agencyId} onToggle={() => setOpen(open === q.agencyId ? null : q.agencyId)} onDone={(e) => finished(q, e)} onNext={() => next(q)} />
            ))}
          </div>
          {stage.queue.length > shown && (
            <button type="button" className="fu-more" onClick={() => setShown(shown + PAGE)}>
              Ver {Math.min(PAGE, stage.queue.length - shown)} más · quedan {stage.queue.length - shown}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ScoreCell({ item: q }: { item: QueueItem }) {
  const router = useRouter();
  const [value, setValue] = useState(q.score === null ? "" : String(q.score));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!q.scoreEditable)
    return (
      <span className="fu-score" title="Lead score">
        {score(q.score)}
      </span>
    );
  async function save() {
    const next = value.trim() === "" ? null : Number(value.replace(",", "."));
    if (next === q.score) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/admin/follow-up/inmobiliarias", { method: "POST", body: JSON.stringify({ accion: "score", inmobiliaria: q.agencyId, score: next }) });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos guardar el score.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="fu-score">
      <input
        data-testid="followup-score"
        inputMode="decimal"
        value={value}
        disabled={busy}
        aria-label={`Score de ${q.name}`}
        title={error || "Score (0 a 100). Se guarda al salir del campo."}
        className={error ? "is-error" : undefined}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
    </span>
  );
}

function StageCell({ stage, item: q }: { stage: StageView; item: QueueItem }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function change(etapa: string) {
    if (etapa === stage.key) return;
    if (etapa === OUT && !window.confirm(`¿Sacar a ${q.name} de Follow-up? Vuelve sola si su embudo avanza.`)) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/admin/follow-up/inmobiliarias", { method: "POST", body: JSON.stringify({ accion: "estado", inmobiliaria: q.agencyId, etapa }) });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos cambiar el estado.");
      setBusy(false);
    }
  }
  return (
    <span className="fu-stagecell">
      <select data-testid="followup-stage-select" value={stage.key} disabled={busy} aria-label={`Estado de ${q.name}`} title={error || undefined} onChange={(e) => change(e.target.value)}>
        {FOLLOWUP_STAGES.map((s) => (
          <option key={s.key} value={s.key}>
            {s.title}
          </option>
        ))}
        <option value={OUT}>Sacar de Follow-up</option>
      </select>
      {error ? <small className="fu-error">{error}</small> : q.manual ? <small title="Corregido a mano: vale hasta que su embudo cambie.">Corregido a mano</small> : null}
    </span>
  );
}

function SituationCell({ item: q }: { item: QueueItem }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function change(situacion: Situation) {
    if (situacion === q.situation) return;
    const texto = ["sin_respuesta", "sin_whatsapp", "numero_incorrecto"].includes(situacion) ? "" : (window.prompt("Texto de su respuesta (opcional, queda como evidencia)") ?? "");
    setBusy(true);
    setError("");
    try {
      const r = await api<{ warning: string | null }>("/api/admin/follow-up/inmobiliarias", { method: "POST", body: JSON.stringify({ accion: "situacion", inmobiliaria: q.agencyId, situacion, texto }) });
      if (r.warning) window.alert(r.warning);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos guardar la situación.");
      setBusy(false);
    }
  }
  return (
    <span className="fu-stagecell">
      <select data-testid="followup-situation-select" value={q.situation} disabled={busy} aria-label={`Situación de ${q.name}`} title={error || q.situationNote || undefined} onChange={(e) => change(e.target.value as Situation)}>
        {(Object.keys(SITUATIONS) as Situation[]).map((k) => (
          <option key={k} value={k}>
            {SITUATIONS[k]}
          </option>
        ))}
      </select>
      {error ? <small className="fu-error">{error}</small> : q.situationManual ? <small title={q.situationNote ?? undefined}>Marcada a mano</small> : null}
    </span>
  );
}


/** Abre únicamente el chat para revisar la conversación, sin texto precargado ni registro de envío. */
function WhatsAppShortcut({ item: q }: { item: QueueItem }) {
  if (!q.wa) return null;
  return (
    <a href={`https://web.whatsapp.com/send?phone=${encodeURIComponent(q.wa)}`} target="habita-wa-review" rel="noopener noreferrer"
      data-testid="followup-whatsapp-review" title={`Revisar conversación de WhatsApp con ${q.name}`}
      aria-label={`Abrir WhatsApp de ${q.name} (solo revisar)`}
      style={{ display: "inline-flex", color: "#128C7E", verticalAlign: "middle", alignItems: "center", justifyContent: "center", width: 24, height: 24 }}>
      <svg viewBox="0 0 24 24" fill="currentColor" width="19" height="19" aria-hidden="true">
        <path d="M12.04 2a9.91 9.91 0 0 0-8.5 15.04L2 22l5.11-1.52A9.97 9.97 0 1 0 12.04 2Zm0 18.14a8.07 8.07 0 0 1-4.1-1.12l-.3-.17-3.03.9.91-2.95-.2-.31a8.06 8.06 0 1 1 6.72 3.65Zm4.43-6.03c-.24-.12-1.42-.7-1.64-.78-.22-.08-.38-.12-.54.12s-.62.78-.76.94c-.14.16-.28.18-.52.06-.24-.12-1.02-.38-1.94-1.2-.72-.64-1.21-1.43-1.35-1.67-.14-.24-.01-.37.1-.49.11-.11.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.54-1.3-.74-1.78-.2-.47-.4-.41-.54-.42h-.46c-.16 0-.42.06-.64.3-.22.24-.84.82-.84 2s.86 2.32.98 2.48c.12.16 1.7 2.6 4.12 3.64.58.25 1.03.4 1.38.51.58.18 1.1.15 1.52.09.46-.07 1.42-.58 1.62-1.14.2-.56.2-1.04.14-1.14-.06-.1-.22-.16-.46-.28Z"/>
      </svg>
    </a>
  );
}

/** Corrección manual explícita; no envía mensajes ni confirma tareas. */
function QueueCorrection({ item: q, onSaved }: { item: QueueItem; onSaved: () => void }) {
  const [stage, setStage] = useState<StageKey>(q.stage);
  const [situation, setSituation] = useState<Situation>(q.situation);
  const [note, setNote] = useState(q.situationNote ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    if (stage === q.stage && situation === q.situation && note === (q.situationNote ?? "")) return;
    if (stage !== q.stage && !window.confirm("¿Corregir la etapa comercial? Esto cambia las acciones pendientes, no crea eventos de producto ni envía WhatsApps.")) return;
    setBusy(true);
    setError("");
    try {
      if (stage !== q.stage) await api("/api/admin/follow-up/inmobiliarias", { method: "POST", body: JSON.stringify({ accion: "estado", inmobiliaria: q.agencyId, etapa: stage }) });
      if (situation !== q.situation || note !== (q.situationNote ?? "")) {
        const r = await api<{ warning: string | null }>("/api/admin/follow-up/inmobiliarias", {
          method: "POST", body: JSON.stringify({ accion: "situacion", inmobiliaria: q.agencyId, situacion: situation, texto: note }),
        });
        if (r.warning) setError(r.warning);
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar la corrección. Revisá la fila antes de reintentar.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details data-testid="followup-quick-correct" style={{ position: "relative", display: "inline-block" }}>
      <summary style={{ fontSize: "11px", cursor: "pointer", display: "inline-flex", gap: 4, alignItems: "center", color: "#28664e" }}><Pencil size={11} /> Editar etapa / estado</summary>
      <div style={{ position: "absolute", zIndex: 25, minWidth: 280, width: 320, background: "#fff", color: "#243d32", border: "1px solid #b9cdc2", borderRadius: 10, padding: 12, boxShadow: "0 8px 25px #0002", display: "grid", gap: 8 }}>
        <b style={{ fontSize: 13 }}>Corregir {q.name}</b>
        <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Etapa comercial / avance
          <select data-testid="followup-quick-stage" value={stage} onChange={(e) => setStage(e.target.value as StageKey)} disabled={busy}>
            {COMMERCIAL_STAGES.filter((s) => s.technical.length).map((s) => (
              <optgroup key={s.key} label={s.title}>
                {s.technical.map((key) => <option key={key} value={key}>{technicalStateLabel(key)}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Estado de conversación
          <select data-testid="followup-quick-situation" value={situation} onChange={(e) => setSituation(e.target.value as Situation)} disabled={busy}>
            {(Object.entries(SITUATIONS) as [Situation, string][]).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Motivo / evidencia (opcional)
          <textarea value={note} maxLength={2000} rows={2} onChange={(e) => setNote(e.target.value)} disabled={busy} placeholder="Qué respondió o por qué corregís el estado" />
        </label>
        <small>No interesado cierra los seguimientos; «No contactar» impide nuevos envíos.</small>
        {error && <span className="fu-error" role="alert">{error}</span>}
        <button className="button button-small button-primary" type="button" disabled={busy} data-testid="followup-quick-save" onClick={() => void save()}>{busy ? "Guardando…" : "Guardar corrección"}</button>
      </div>
    </details>
  );
}

function QueueRow({ stage, item: q, exec, open, onToggle, onDone, onNext }: { stage: StageView; item: QueueItem; exec: Exec; open: boolean; onToggle: () => void; onDone: (e: Exec) => void; onNext: () => void }) {
  const status = exec?.status ?? "pending";
  const taken = Boolean(q.claim && q.claim.until > new Date().toISOString());
  const blocked = status !== "sent" ? q.blocked : null;
  const version = stage.versions.find((v) => v.id === q.versionId);
  const testing = stage.versions.some((v) => v.status === "test");
  const late = q.lastAction ? daysSince(q.lastAction.at) > LATE_DAYS : false;
  return (
    <div
      className={`fu-qi${open ? " is-on" : ""}`}
      data-testid="followup-item"
      data-agency={q.agencyId}
      data-status={status}
      data-version={version?.version ?? ""}
      data-score={q.score ?? ""}
      data-stage={stage.key}
      data-last-action={q.lastAction?.text ?? ""}
      data-last-action-at={q.lastAction?.at ?? ""}
      data-last-action-source={q.lastAction?.source ?? ""}
      data-situation={q.situation}
      data-action={q.action ?? ""}
      data-blocked={blocked ?? ""}
    >
      <div className="fu-qrow">
        <ScoreCell key={`${q.agencyId}-${q.score}`} item={q} />
        <div className="fu-qname">
          <Link href={`/admin/inmobiliarias/${q.agencyId}`}>{q.name}</Link>
          <span>{q.person ?? "Sin decisor cargado"}</span>
        </div>
        <div>
          <span title={q.address ?? undefined}>{q.address ?? "Sin dirección"}</span>
          <span>{q.zone ?? "Sin zona"}</span>
        </div>
        <div>
          {q.website ? (
            <a href={href(q.website)} target="_blank" rel="noreferrer" title={q.website}>
              {host(q.website)}
            </a>
          ) : (
            <span className="fu-muted">Sin web</span>
          )}
        </div>
        <span className="fu-props">{q.properties}</span>
        <StageCell stage={stage} item={q} />
        <SituationCell item={q} />
        <div className="fu-qact" data-testid="followup-last-action">
          <span title={q.lastAction ? `Última acción · ${SOURCE_LABEL[q.lastAction.source]}` : undefined}>{q.lastAction ? q.lastAction.text : "Sin acciones"}</span>
          <span className={late ? "is-late" : undefined}>{q.lastAction ? `${day(q.lastAction.at)} · ${ago(q.lastAction.at)}` : "—"}</span>
        </div>
        <div className="fu-qcontact">
          <span className="fu-mono">{q.phone ?? "Sin WhatsApp"}</span>
          <span>
            {q.needsReview ? "Número sin validar" : q.wa ? "Validado" : "—"}
            {version ? ` · ${q.actionLabel} V${version.version}${testing ? (version.status === "test" ? " (prueba)" : " (activa)") : ""}` : q.actionLabel ? ` · ${q.actionLabel}` : ""}
          </span>
        </div>
        <span className={`fu-qst is-${blocked ? "blocked" : status}`} title={blocked ?? undefined} data-testid="followup-row-status">
          {blocked ? "Bloqueada" : taken && status !== "sent" ? "Tomada" : EXEC_LABEL[status]}
        </span>
        <button
          type="button"
          className={`button button-small${status === "pending" && !open && !blocked && !taken ? " button-primary" : " button-outline"}`}
          data-testid="followup-execute"
          onClick={onToggle}
          disabled={(!open && (Boolean(blocked) || taken)) || (!version && status !== "sent")}
          title={blocked ?? (taken ? `La está ejecutando ${q.claim!.by}` : undefined)}
        >
          {open ? "Cerrar" : status === "sent" ? "Ver" : version?.channel === "task" ? "Hacer tarea" : "Ejecutar"}
        </button>
      </div>
      {blocked && (
        <p className="fu-blocked" data-testid="followup-blocked">
          {blocked}
        </p>
      )}
      {open && <Execute item={q} exec={exec} onDone={onDone} onClose={onToggle} onNext={onNext} />}
    </div>
  );
}

type Duplicate = { id: string; name: string; website: string | null; reasons: string[] };

function AddAgency({ stage, onClose }: { stage: StageView; onClose: () => void }) {
  const router = useRouter();
  const [key] = useState(() => crypto.randomUUID());
  const [f, setF] = useState({ name: "", whatsapp: "", contact: "", score: "", address: "", zone: "", website: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [duplicates, setDuplicates] = useState<Duplicate[] | null>(null);
  const field = (k: keyof typeof f, label: string, extra: Partial<React.InputHTMLAttributes<HTMLInputElement>> = {}) => (
    <label>
      <span>{label}</span>
      <input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...extra} />
    </label>
  );
  async function submit(confirmDuplicates = false) {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ id?: string; duplicates?: Duplicate[] }>("/api/admin/follow-up/inmobiliarias", {
        method: "POST",
        body: JSON.stringify({ accion: "agregar", etapa: stage.key, key, ...f, score: f.score.replace(",", "."), confirmDuplicates }),
      });
      if (r.duplicates?.length) {
        setDuplicates(r.duplicates);
        return;
      }
      onClose();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos agregarla.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="fu-add"
      data-testid="followup-add-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="fu-lbl">Agregar a «{stage.title}»</p>
      <div className="fu-add-grid">
        {field("name", "Nombre comercial *", { required: true, maxLength: 120 })}
        {field("whatsapp", "WhatsApp", { inputMode: "tel", placeholder: "11 2345 6789", maxLength: 40 })}
        {field("contact", "Decisor", { maxLength: 120 })}
        {stage.key === "no-contactado" && field("score", "Score (0 a 100)", { inputMode: "decimal", maxLength: 6 })}
        {field("address", "Dirección", { maxLength: 200 })}
        {field("zone", "Zona", { maxLength: 120 })}
        {field("website", "Web", { placeholder: "inmobiliaria.com.ar", maxLength: 200 })}
      </div>
      {duplicates && (
        <div className="fu-warn">
          Puede que ya exista:{" "}
          {duplicates.map((d, i) => (
            <span key={d.id}>
              {i > 0 && ", "}
              <Link href={`/admin/inmobiliarias/${d.id}`} target="_blank">
                {d.name}
              </Link>{" "}
              ({d.reasons.join(", ")})
            </span>
          ))}
          .{" "}
          <button type="button" className="fu-link" disabled={busy} onClick={() => submit(true)}>
            Es otra: agregarla igual
          </button>
        </div>
      )}
      {error && (
        <p className="fu-error" role="alert">
          {error}
        </p>
      )}
      <div className="fu-actions">
        <button type="submit" className="button button-primary button-small" disabled={busy || !f.name.trim()}>
          Agregar
        </button>
        <button type="button" className="fu-link" onClick={onClose}>
          Cancelar
        </button>
        <p className="fu-note">Se crea como «Nueva inmobiliaria» y queda en esta etapa hasta que su embudo avance.</p>
      </div>
    </form>
  );
}

const FAIL_KINDS = { sin_whatsapp: "No tiene WhatsApp", numero_incorrecto: "Número incorrecto", otro: "Otro motivo" } as const;

/**
 * Ejecutar con una inmobiliaria: la toma 10 minutos (otra sesión no puede),
 * arma el mensaje y guía los pasos. Abrir WhatsApp no cuenta como enviado:
 * cuenta «Confirmar envío», después de verlo salir en el chat.
 */
function Execute({ item, exec, onDone, onClose, onNext }: { item: QueueItem; exec: Exec; onDone: (e: Exec) => void; onClose?: () => void; onNext?: () => void }) {
  const router = useRouter();
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [failing, setFailing] = useState(false);
  const [kind, setKind] = useState<keyof typeof FAIL_KINDS>("otro");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(exec?.status ?? "pending");
  const sent = status === "sent";

  useEffect(() => {
    let alive = true;
    if (exec?.status === "sent") {
      setError("");
      return;
    }
    api<Prepared>("/api/admin/follow-up/ejecuciones", { method: "POST", body: JSON.stringify({ accion: "preparar", inmobiliaria: item.agencyId }) })
      .then((p) => alive && setPrepared(p))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "No pudimos armar el mensaje."));
    return () => {
      alive = false;
    };
  }, [item.agencyId, exec?.status]);

  async function mark(estado: "opened" | "sent" | "failed") {
    if (!prepared) return;
    setError("");
    setBusy(true);
    try {
      const r = await api<{ execution: NonNullable<Exec>; warning: string | null }>("/api/admin/follow-up/ejecuciones", {
        method: "POST",
        body: JSON.stringify({
          accion: "registrar",
          inmobiliaria: item.agencyId,
          etapa: prepared.stage,
          tarea: prepared.action,
          version: prepared.versionId,
          estado,
          motivo: reason,
          tipo: kind === "otro" ? null : kind,
          texto: prepared.message,
        }),
      });
      setStatus(r.execution.status);
      if (r.warning) setNotice(r.warning);
      if (estado !== "opened") onDone({ status: r.execution.status, at: r.execution.at, reason: estado === "failed" ? reason || FAIL_KINDS[kind] : null });
      if (estado === "failed") setFailing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos registrarlo.");
    } finally {
      setBusy(false);
    }
  }
  async function close() {
    if (prepared && !sent) await api("/api/admin/follow-up/ejecuciones", { method: "POST", body: JSON.stringify({ accion: "soltar", inmobiliaria: item.agencyId }) }).catch(() => undefined);
    onClose?.();
  }
  async function copyText(text: string, what: string) {
    setNotice((await copy(text)) ? `${what} copiado.` : `No pudimos copiarlo: ${text}`);
  }
  async function rename() {
    const name = window.prompt("Nombre corto para {{inmobiliaria}} (vacío: el de la ficha sin paréntesis)", item.shortName);
    if (name === null) return;
    try {
      await api("/api/admin/follow-up/inmobiliarias", { method: "POST", body: JSON.stringify({ accion: "nombre", inmobiliaria: item.agencyId, nombre: name }) });
      setPrepared(null);
      const p = await api<Prepared>("/api/admin/follow-up/ejecuciones", { method: "POST", body: JSON.stringify({ accion: "preparar", inmobiliaria: item.agencyId }) });
      setPrepared(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos cambiar el nombre.");
    }
  }

  if (sent && !prepared)
    return (
      <div className="fu-exec fu-note" data-testid="followup-done">
        Confirmado {exec?.at ? `el ${day(exec.at)}` : ""}. {onNext && <button type="button" className="fu-link" onClick={onNext}>Siguiente pendiente →</button>}
      </div>
    );
  if (!prepared && !error) return <div className="fu-exec fu-note">Tomando la inmobiliaria y armando el mensaje…</div>;
  if (!prepared)
    return (
      <div className="fu-exec">
        <p className="fu-error" role="alert" data-testid="followup-error">
          {error}
        </p>
        <button type="button" className="fu-link" onClick={() => router.refresh()}>
          Actualizar la lista
        </button>
      </div>
    );
  const task = prepared.channel === "task";
  const creatingDemo = task && prepared.stage === "sin-demo" && prepared.action === "principal";
  const many = prepared.messages.length > 1;
  return (
    <div className="fu-exec" data-testid="followup-exec" data-action={prepared.action ?? ""} data-version={prepared.version}>
      <div className="fu-exec-msg">
        <p className="fu-to">
          <b>{prepared.actionLabel}</b> para <b>{prepared.person ?? item.name}</b> · {task ? "tarea del equipo" : <>WhatsApp <b className="fu-mono" data-testid="followup-phone">{prepared.phone ?? "sin número"}</b></>} · V{prepared.version} · nombre en el mensaje: «{item.shortName}»{" "}
          <button type="button" className="fu-link" data-testid="followup-short-name" onClick={rename}>
            cambiar
          </button>
        </p>
        {prepared.messages.map((m, i) => (
          <div key={i} className="fu-msgwrap">
            {many && <span className="fu-lbl">Mensaje {i + 1} de {prepared.messages.length}</span>}
            <div className="fu-msg" data-testid="followup-message" data-index={i}>
              {m}
            </div>
            {many && (
              <button type="button" className="fu-link" data-testid="followup-copy-part" onClick={() => copyText(m, `Mensaje ${i + 1}`)}>
                Copiar mensaje {i + 1}
              </button>
            )}
          </div>
        ))}
        {prepared.notes && (
          <div className="fu-obs" data-testid="followup-notes">
            <b>Observaciones</b>
            {prepared.notes}
          </div>
        )}
        {prepared.warnings.map((w) => (
          <p key={w} className="fu-warn" data-testid="followup-check">
            {w}
          </p>
        ))}
        {notice && (
          <p className="fu-note" role="status">
            {notice}
          </p>
        )}
        {error && (
          <p className="fu-error" role="alert" data-testid="followup-error">
            {error}
          </p>
        )}
      </div>
      <div className="fu-steps">
        {task ? (
          <>
            {(prepared.ctas.includes("create_demo") || creatingDemo) && (
              <Link className="button button-small button-primary" href={prepared.links.createDemo} target="_blank" onClick={() => void mark("opened")}>
                <Plus size={16} aria-hidden="true" /> Crear demo
              </Link>
            )}
            {creatingDemo ? (
              <p className="fu-note" data-testid="followup-demo-auto-progress">La tarea avanzará al publicar la demo.</p>
            ) : (
              <button type="button" className="button button-small button-outline" data-testid="followup-confirm" disabled={sent || busy} onClick={() => mark("sent")}>
                {sent ? "Hecha" : "Marcar hecha"}
              </button>
            )}
          </>
        ) : (
          <>
            {prepared.whatsappUrl ? (
              <a
                className={`button button-small${status === "pending" || status === "failed" ? " button-primary" : " button-outline"}`}
                data-testid="followup-open"
                href={prepared.whatsappUrl}
                target="habita-whatsapp"
                rel="noreferrer"
                onClick={() => !sent && void mark("opened")}
              >
                <MessageCircle size={16} aria-hidden="true" /> 1. Abrir WhatsApp{many ? " con el mensaje 1" : " con el mensaje"}
              </a>
            ) : (
              <span className="button button-small button-outline is-disabled" data-testid="followup-open" aria-disabled="true">
                <MessageCircle size={16} aria-hidden="true" /> 1. Abrir WhatsApp
              </span>
            )}
            <button type="button" className={`button button-small${status === "opened" ? " button-primary" : " button-outline"}`} data-testid="followup-confirm" disabled={sent || busy || !prepared.ready} onClick={() => mark("sent")}>
              <Send size={15} aria-hidden="true" /> {sent ? "Enviado" : many ? "2. Confirmar: salieron todos" : "2. Confirmar envío"}
            </button>
          </>
        )}
        {!sent &&
          (failing ? (
            <div className="fu-fail">
              <select data-testid="followup-failed-kind" value={kind} onChange={(e) => setKind(e.target.value as keyof typeof FAIL_KINDS)} aria-label="Qué pasó">
                {Object.entries(FAIL_KINDS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
              <input data-testid="followup-failed-reason" value={reason} maxLength={300} placeholder={kind === "otro" ? "Por qué no salió" : "Detalle (opcional)"} onChange={(e) => setReason(e.target.value)} aria-label="Por qué no salió" />
              <button type="button" className="button button-small button-outline" data-testid="followup-failed-save" disabled={busy || (kind === "otro" && !reason.trim())} onClick={() => mark("failed")}>
                Guardar
              </button>
            </div>
          ) : (
            <button type="button" className="button button-small button-outline" data-testid="followup-failed" onClick={() => setFailing(true)}>
              {task ? "No se pudo hacer" : "No se envió"}
            </button>
          ))}
        {!task && prepared.ctas.includes("copy") && (
          <button type="button" className="button button-small button-outline" onClick={() => copyText(prepared.message.replace(/^\s*-{3,}\s*$/gm, ""), "Mensaje")}>
            <ClipboardCopy size={16} aria-hidden="true" /> Copiar mensaje
          </button>
        )}
        {prepared.ctas.includes("demo") && prepared.links.demo && (
          <button type="button" className="button button-small button-outline" data-testid="followup-link-demo" onClick={() => copyText(prepared.links.demo!, "Link demo")}>
            <Link2 size={16} aria-hidden="true" /> Copiar link demo
          </button>
        )}
        {prepared.ctas.includes("panel") && prepared.links.panel && (
          <button type="button" className="button button-small button-outline" data-testid="followup-link-panel" onClick={() => copyText(prepared.links.panel!, "Link panel")}>
            <KeyRound size={16} aria-hidden="true" /> Copiar link panel
          </button>
        )}
        {(sent || status === "failed") && onNext && (
          <button type="button" className="button button-small button-primary" data-testid="followup-next" onClick={onNext}>
            Siguiente pendiente →
          </button>
        )}
        {onClose && !sent && (
          <button type="button" className="fu-link" data-testid="followup-release" onClick={close}>
            Soltar sin hacer nada
          </button>
        )}
      </div>
    </div>
  );
}

