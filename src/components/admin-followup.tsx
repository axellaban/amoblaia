"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState } from "react";
import { ChevronRight, ClipboardCopy, KeyRound, Link2, MessageCircle, Pencil, Plus, Send } from "lucide-react";
import { api } from "@/components/admin-demos";
import { CTA_KEYS, CTA_LABEL, FOLLOWUP_STAGES, OUT, VARIABLES, fillMessage, missingVariables, pct, type Channel, type Cta, type StageKey, type VersionStatus } from "@/lib/followup/stages";
import { GROUPS, REPLY_CLASSES, SITUATIONS, actionLabel, actionWhen, actionsOf, splitMessages, type Action, type ReplyClass, type Situation } from "@/lib/followup/plan";
import type { Change, FunnelStep, InboxItem, Prepared, QueueItem, QueueSummary, Results, StageView } from "@/lib/followup/server";
import type { CohortRow, WindowKey } from "@/lib/followup/results";
import { daysText, type Rule } from "@/lib/followup/rules";

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
  { key: "reglas", label: "Mensajes y reglas" },
  { key: "resultados", label: "Resultados" },
];

/** /admin/follow-up: pestañas como en la especificación; la cola de ejecución es la pantalla principal. */
export function FollowupBoard({
  stages,
  queue,
  blocked,
  summary,
  inbox,
  funnel,
  rules,
  changes,
  results,
}: {
  stages: StageView[];
  queue: QueueItem[];
  blocked: QueueItem[];
  summary: QueueSummary;
  inbox: InboxItem[];
  funnel: FunnelStep[];
  rules: Rule[];
  changes: Change[];
  results: Results;
}) {
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
        <ExecCenter queue={queue} blocked={blocked} summary={summary} onReplies={() => go("respuestas")} />
      ) : view === "respuestas" ? (
        <Inbox inbox={inbox} agencies={[...queue, ...blocked]} />
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

/** Centro de ejecución: los 4 números de la especificación (cada uno filtra), la cola y, al ejecutar, el detalle en 3 sectores. */
function ExecCenter({ queue, blocked, summary, onReplies }: { queue: QueueItem[]; blocked: QueueItem[]; summary: QueueSummary; onReplies: () => void }) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("listas");
  const [group, setGroup] = useState<string>("todas");
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState(QPAGE);
  const [detail, setDetail] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, Exec>>({});
  const [taking, setTaking] = useState(false);
  const [error, setError] = useState("");
  const live = new Date().toISOString();
  const statusOf = (q: QueueItem) => (q.agencyId in done ? done[q.agencyId] : q.execution);
  const base =
    filter === "bloqueadas"
      ? blocked
      : filter === "respuestas"
        ? [...queue, ...blocked].filter((q) => isReply(q) && !q.snoozedUntil)
        : filter === "demos"
          ? [...queue, ...blocked].filter((q) => q.group === "demos" && !q.snoozedUntil)
          : queue;
  const term = search.trim().toLowerCase();
  const list = base.filter((q) => (group === "todas" || q.group === group) && (!term || q.name.toLowerCase().includes(term)));
  const groups = (["respuestas", "demos", "seguimientos", "nuevos"] as const).map((g) => ({ key: g, n: base.filter((q) => q.group === g).length }));
  const free = queue.filter((q) => statusOf(q)?.status !== "sent" && !(q.claim && q.claim.until > live));

  async function takeNext() {
    setTaking(true);
    setError("");
    try {
      const p = await api<Prepared | null>("/api/admin/followup/claim", { method: "POST", body: JSON.stringify({}) });
      if (!p) setError("No queda nada libre para ejecutar ahora.");
      else setDetail(p.agencyId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos tomar la próxima.");
    } finally {
      setTaking(false);
    }
  }

  if (detail) {
    const item = [...queue, ...blocked].find((q) => q.agencyId === detail);
    if (item)
      return (
        <ExecDetail
          key={detail}
          item={item}
          queue={queue}
          exec={statusOf(item)}
          statusOf={statusOf}
          onPick={setDetail}
          onDone={(e) => setDone((d) => ({ ...d, [item.agencyId]: e }))}
          onBack={() => {
            setDetail(null);
            router.refresh();
          }}
          onNext={() => {
            const next = free.find((q) => q.agencyId !== item.agencyId && !(q.agencyId in done));
            setDetail(next?.agencyId ?? null);
            if (!next) router.refresh();
          }}
        />
      );
  }

  const kpis: { key: Filter; label: string; value: number; hint: string }[] = [
    { key: "listas", label: "Acciones para hoy", value: summary.ready, hint: summary.claimed ? `listas ahora · ${summary.claimed} tomadas por otra sesión` : "listas para ejecutar ahora" },
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

  return (
    <section className="fu-center" data-testid="followup-queue">
      <div className="fu-kpis">
        {kpis.map((k) => (
          <button
            key={k.key}
            type="button"
            className={`fu-kpi${filter === k.key ? " is-on" : ""} is-${k.key}`}
            data-testid={`followup-kpi-${k.key}`}
            aria-pressed={filter === k.key}
            onClick={() => {
              if (k.key === "respuestas" && filter === "respuestas") return onReplies();
              setFilter(k.key);
              setGroup("todas");
              setShown(QPAGE);
            }}
          >
            <span>{k.label}</span>
            <b>{k.value}</b>
            <small>{k.hint}</small>
          </button>
        ))}
      </div>
      {filter === "respuestas" && (
        <p className="fu-note">
          Las que confirmaron el número o preguntaron precios, listas para contestar. Las respuestas sin clasificar están en la{" "}
          <button type="button" className="fu-link" onClick={onReplies}>
            bandeja
          </button>
          .
        </p>
      )}
      <p className="fu-note">
        Conversaciones nuevas en 24 h: <b>{summary.newToday}</b> de {summary.cap} · confirmadas hoy: <b>{summary.doneToday}</b> ·{" "}
        <button type="button" className="fu-link" onClick={() => router.refresh()}>
          Actualizar
        </button>
      </p>
      <div className="fu-filters">
        <button type="button" className={`fu-chip${group === "todas" ? " is-on" : ""}`} onClick={() => setGroup("todas")}>
          Todas · {base.length}
        </button>
        {groups.map((g) => (
          <button key={g.key} type="button" className={`fu-chip${group === g.key ? " is-on" : ""}`} onClick={() => setGroup(g.key)} disabled={!g.n}>
            {GROUPS[g.key]} · {g.n}
          </button>
        ))}
        <span className="fu-grow" />
        <label className="fu-search">
          <span className="sr-only">Buscar inmobiliaria</span>
          <input type="search" placeholder="Buscar inmobiliaria" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <button type="button" className="button button-primary button-small" data-testid="followup-take-next" disabled={taking || !free.length} onClick={takeNext}>
          {taking ? "Tomando…" : "Tomar la próxima →"}
        </button>
      </div>
      {error && (
        <p className="fu-error" role="alert">
          {error}
        </p>
      )}
      {filter === "bloqueadas" && reasons.length > 0 && (
        <div className="fu-reasons" data-testid="followup-block-reasons">
          {reasons.map(([r, n]) => (
            <span key={r}>
              {r} · <b>{n}</b>
            </span>
          ))}
        </div>
      )}
      {list.length === 0 ? (
        <p className="fu-empty">{filter === "listas" ? "No hay nada para ejecutar ahora. Mirá las bloqueadas para ver por qué." : "No hay inmobiliarias en este filtro."}</p>
      ) : (
        <div className="fu-qlist">
          <div className="fu-qwide fu-qwide-q">
            <div className="fu-qrow fu-qrow-q fu-qth" aria-hidden="true">
              <span>Score</span>
              <span>Inmobiliaria</span>
              <span>Etapa</span>
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
              const taken = Boolean(q.claim && q.claim.until > live);
              const isBlocked = Boolean(q.blocked) && status !== "sent";
              return (
                <div key={q.agencyId} className="fu-qi" data-testid="followup-queue-item" data-agency={q.agencyId} data-stage={q.stage} data-action={q.action ?? ""} data-situation={q.situation} data-status={status} data-priority={q.priority} data-blocked={isBlocked ? q.blocked : ""}>
                  <div className="fu-qrow fu-qrow-q">
                    <span className="fu-score">{score(q.score)}</span>
                    <div className="fu-qname">
                      <Link href={`/admin/inmobiliarias/${q.agencyId}`}>{q.name}</Link>
                      <span>{q.zone ?? q.person ?? "—"}</span>
                    </div>
                    <span className="fu-cell">{stageTitle(q.stage)}</span>
                    <span className="fu-cell">
                      <span className="fu-pill is-sit">{SITUATIONS[q.situation]}</span>
                    </span>
                    <span className="fu-cell fu-bold">{q.actionLabel ?? "—"}</span>
                    <div className="fu-qact">
                      <span>{q.lastAction ? q.lastAction.text : "Sin acciones"}</span>
                      <span className={q.lastAction && daysSince(q.lastAction.at) > LATE_DAYS ? "is-late" : undefined}>{q.lastAction ? `${day(q.lastAction.at)} · ${ago(q.lastAction.at)}` : "—"}</span>
                    </div>
                    <div className="fu-qcontact">
                      <span className="fu-mono">{q.phone ?? "—"}</span>
                      <span>{!q.wa ? "Sin WhatsApp" : q.needsReview ? "Sin validar" : "Validado"}</span>
                    </div>
                    <span>
                      <span className={`fu-pill is-${q.priority}`} title={q.priorityManual ? "Puesta a mano" : "Por su grupo"}>
                        {PRIORITY_LABEL[q.priority]}
                        {q.priorityManual ? " ·" : ""}
                      </span>
                    </span>
                    {isBlocked ? (
                      q.snoozedUntil ? (
                        <button type="button" className="button button-small button-outline" data-testid="followup-unsnooze" onClick={() => api("/api/admin/follow-up/inmobiliarias", { method: "POST", body: JSON.stringify({ accion: "volver", inmobiliaria: q.agencyId }) }).then(() => router.refresh())}>
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
                        className={`button button-small${status === "pending" && !taken ? " button-primary" : " button-outline"}`}
                        data-testid="followup-execute"
                        disabled={taken}
                        title={taken ? `La está ejecutando ${q.claim!.by}` : undefined}
                        onClick={() => setDetail(q.agencyId)}
                      >
                        {taken ? `Tomada · ${q.claim!.by}` : status === "sent" ? "Ver" : "Ejecutar"}
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
    </section>
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
 * Detalle de ejecución, en tres sectores (como la especificación): la cola a la
 * izquierda, el contexto y los mensajes en el centro, el checklist y los
 * botones a la derecha. Al abrirla, la inmobiliaria queda tomada 10 minutos.
 */
function ExecDetail({
  item,
  queue,
  exec,
  statusOf,
  onPick,
  onDone,
  onBack,
  onNext,
}: {
  item: QueueItem;
  queue: QueueItem[];
  exec: Exec;
  statusOf: (q: QueueItem) => Exec;
  onPick: (id: string) => void;
  onDone: (e: Exec) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const [prepared, setPrepared] = useState<Prepared | null>(null);
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
    if (exec?.status !== "sent") void load();
    // Opening the detail takes the agency; loading it once is enough.
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
  async function back() {
    if (prepared && !sent) await api("/api/admin/follow-up/ejecuciones", { method: "POST", body: JSON.stringify({ accion: "soltar", inmobiliaria: item.agencyId }) }).catch(() => undefined);
    onBack();
  }
  async function pick(id: string) {
    if (id === item.agencyId) return;
    if (prepared && !sent) await api("/api/admin/follow-up/ejecuciones", { method: "POST", body: JSON.stringify({ accion: "soltar", inmobiliaria: item.agencyId }) }).catch(() => undefined);
    onPick(id);
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
  const many = (prepared?.messages.length ?? 0) > 1;
  return (
    <section className="fu-detail" data-testid="followup-detail" data-agency={item.agencyId}>
      <div className="fu-dhead">
        <button type="button" className="fu-back" aria-label="Volver a la cola" data-testid="followup-back" onClick={back}>
          <ChevronRight size={18} aria-hidden="true" style={{ transform: "rotate(180deg)" }} />
        </button>
        <div className="fu-grow">
          <h2>Detalle de ejecución</h2>
          <p>Revisá el contexto y el checklist antes de enviar.</p>
        </div>
        {prepared && !sent && <span className="fu-pill is-lock">Tomada por vos · libre a las {hhmm(prepared.lockedUntil)}</span>}
      </div>
      <div className="fu-dgrid">
        <aside className="fu-dcol fu-dqueue" aria-label="Cola">
          <div className="fu-dtitle">
            <b>Cola de ejecución</b>
            <span>{queue.length} en cola</span>
          </div>
          {queue.slice(0, 14).map((q) => {
            const on = q.agencyId === item.agencyId;
            const done = statusOf(q)?.status === "sent";
            return (
              <button key={q.agencyId} type="button" className={`fu-dqi${on ? " is-on" : ""}${done ? " is-done" : ""}`} onClick={() => pick(q.agencyId)} aria-current={on ? "true" : undefined}>
                <span className="fu-score">{score(q.score)}</span>
                <span className="fu-dqname">
                  <b>{q.name}</b>
                  <span>{done ? "Enviado" : q.actionLabel}</span>
                </span>
                <span className={`fu-pill is-${q.priority}`}>{PRIORITY_LABEL[q.priority]}</span>
              </button>
            );
          })}
        </aside>
        <div className="fu-dcol fu-dmain">
          <div className="fu-card fu-ident">
            <div className="fu-grow">
              <div className="fu-identname">
                <Link href={`/admin/inmobiliarias/${item.agencyId}`}>{item.name}</Link>
                <span className={`fu-pill is-${priority}`}>Prioridad {PRIORITY_LABEL[priority].toLowerCase()}</span>
              </div>
              <p>
                {item.zone ?? "Sin zona"} · Score <b>{score(item.score)}</b> · Decisor: {item.person ?? "sin nombre"} · <span className="fu-mono" data-testid="followup-phone">{item.phone ?? "sin WhatsApp"}</span>
                {item.wa ? (item.needsReview ? " (sin validar)" : " (validado)") : ""}
              </p>
            </div>
            <div className="fu-identside">
              <span>
                Etapa <b>{stageTitle(item.stage)}</b>
              </span>
              <SituationCell item={item} />
            </div>
          </div>
          <div className="fu-dtwo">
            <div className="fu-card">
              <b className="fu-cardtitle">Contexto del lead</b>
              <ul className="fu-facts">
                <li>
                  Web: {item.website ? (
                    <a href={href(item.website)} target="_blank" rel="noreferrer">
                      {host(item.website)}
                    </a>
                  ) : "sin web"}
                </li>
                <li>{item.properties} propiedades · {item.hasDemo ? "con demo publicada" : "sin demo publicada"} · {item.hasAccount ? "con cuenta" : "sin cuenta"}</li>
                <li>{item.address ?? "Sin dirección"}</li>
                <li>
                  En el mensaje: «{ctx?.shortName ?? item.shortName}»{" "}
                  <button type="button" className="fu-link" data-testid="followup-short-name" onClick={rename}>
                    cambiar
                  </button>
                </li>
                {item.situationNote && <li>Su respuesta: «{item.situationNote}»</li>}
              </ul>
            </div>
            <div className="fu-card">
              <b className="fu-cardtitle">Últimas acciones</b>
              {!prepared ? (
                <p className="fu-note">{error ? "—" : "Cargando…"}</p>
              ) : prepared.history.length === 0 ? (
                <p className="fu-note">Sin acciones todavía.</p>
              ) : (
                <ol className="fu-timeline" data-testid="followup-history">
                  {prepared.history.map((h, i) => (
                    <li key={i} className={`is-${h.kind}`}>
                      <span>{when(h.at)}</span>
                      {h.text}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
          <div className="fu-card fu-next">
            {!prepared ? (
              error ? (
                <p className="fu-error" role="alert" data-testid="followup-error">
                  {error}
                </p>
              ) : sent ? (
                <p className="fu-note">Confirmado. </p>
              ) : (
                <p className="fu-note">Tomando la inmobiliaria y armando el mensaje…</p>
              )
            ) : (
              <>
                <div className="fu-nexthead">
                  <b>
                    Próxima acción: {prepared.actionLabel} · V{prepared.version}
                    {many ? ` · ${prepared.messages.length} mensajes` : ""}
                  </b>
                  <span>{task ? "Tarea del equipo" : `Por WhatsApp · situación: ${ctx?.situationLabel}`}</span>
                </div>
                {prepared.messages.map((m, i) => (
                  <div key={i} className="fu-step">
                    <span className="fu-stepn">{i + 1}</span>
                    <div className="fu-msg" data-testid="followup-message" data-index={i}>
                      {m}
                    </div>
                    <button type="button" className="fu-iconbtn" aria-label={`Copiar mensaje ${i + 1}`} data-testid="followup-copy-part" onClick={() => copyText(m, `Mensaje ${i + 1}`)}>
                      <ClipboardCopy size={16} aria-hidden="true" />
                    </button>
                  </div>
                ))}
                {prepared.notes && (
                  <div className="fu-obs" data-testid="followup-notes">
                    <b>Observaciones</b>
                    {prepared.notes}
                  </div>
                )}
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
              </>
            )}
          </div>
        </div>
        <aside className="fu-dcol fu-dside" aria-label="Checklist">
          <b className="fu-cardtitle">Checklist de ejecución</b>
          {prepared ? (
            <ul className="fu-checks" data-testid="followup-checklist">
              {prepared.checklist.map((c) => (
                <li key={c.key} className={c.ok ? "is-ok" : "is-pending"} data-check={c.key} data-ok={c.ok}>
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
          ) : (
            <p className="fu-note">—</p>
          )}
          <div className="fu-sep" />
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
              {prepared.ctas.includes("create_demo") && (
                <Link className="button button-small button-primary" href={prepared.links.createDemo} target="_blank" onClick={() => void mark("opened")}>
                  <Plus size={16} aria-hidden="true" /> Crear demo
                </Link>
              )}
              <button type="button" className="button button-small button-outline" data-testid="followup-confirm" disabled={sent || busy} onClick={() => mark("sent")}>
                {sent ? "Hecha" : "Marcar hecha"}
              </button>
            </>
          )}
          {prepared && !sent && (
            <div className="fu-two">
              <button type="button" className={`button button-small button-outline${panel === "fail" ? " is-active" : ""}`} data-testid="followup-failed" onClick={() => setPanel(panel === "fail" ? "none" : "fail")}>
                {task ? "No se pudo" : "No se envió"}
              </button>
              <button type="button" className={`button button-small button-outline${panel === "snooze" ? " is-active" : ""}`} data-testid="followup-snooze" onClick={() => setPanel(panel === "snooze" ? "none" : "snooze")}>
                Omitir o reprogramar
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
          {(sent || status === "failed") && (
            <button type="button" className="button button-small button-primary" data-testid="followup-next" onClick={onNext}>
              Siguiente pendiente →
            </button>
          )}
          {prepared && (
            <>
              <span className="fu-lbl">Enlaces rápidos</span>
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
            </>
          )}
          <label className="fu-prio">
            <span className="fu-lbl">Prioridad</span>
            <select data-testid="followup-priority" value={item.priorityManual ? priority : "auto"} onChange={(e) => changePriority(e.target.value)}>
              <option value="auto">Automática ({PRIORITY_LABEL[item.priorityManual ? priority : item.priority]})</option>
              <option value="alta">Alta</option>
              <option value="media">Media</option>
              <option value="baja">Baja</option>
            </select>
          </label>
          {!task && (
            <div className="fu-stop" data-testid="followup-stop">
              <b>Si el chat no coincide, no envíes.</b> El encabezado de WhatsApp tiene que mostrar {item.phone ?? "su número"}.
            </div>
          )}
        </aside>
      </div>
    </section>
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
const DAY_SHORT = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const ruleSituations = (r: Rule) => (r.situations.length ? r.situations.map((x) => SITUATIONS[x as Situation]).join(", ") : "Cualquier situación");

/** Embudo y etapas (Fase 3): las etapas en tarjetas con su avance; la elegida, con sus reglas, sus versiones y sus inmobiliarias. */
function Funnel({ funnel, stages, rules, onRules }: { funnel: FunnelStep[]; stages: StageView[]; rules: Rule[]; onRules: () => void }) {
  const [selected, setSelected] = useState<StageKey>(() => (funnel.find((f) => f.key === "no-responde")?.key ?? funnel[0].key) as StageKey);
  const stage = stages.find((s) => s.key === selected)!;
  const step = funnel.find((f) => f.key === selected)!;
  const own = rules.filter((r) => r.stage === selected).sort((a, b) => a.position - b.position);
  return (
    <section className="fu-funnel" data-testid="followup-funnel">
      <div className="fu-fcards">
        {funnel.map((f) => (
          <button key={f.key} type="button" className={`fu-fcard${f.key === selected ? " is-on" : ""}`} aria-pressed={f.key === selected} data-testid="followup-funnel-stage" data-stage={f.key} onClick={() => setSelected(f.key as StageKey)}>
            <span>{f.title}</span>
            <b>{f.waiting}</b>
            <small>{f.rate === null ? "—" : `${pct(f.rate)} pasa a ${f.goal}`}</small>
          </button>
        ))}
      </div>
      <div className="fu-card fu-fdetail">
        <div className="fu-fhead">
          <h2>{step.title}</h2>
          <span className="fu-pill is-media">{step.waiting} esperando</span>
          <span className="fu-note">Objetivo: que pase a «{step.goal}»</span>
          <span className="fu-grow" />
          <button type="button" className="fu-link" onClick={onRules}>
            Editar reglas y mensajes →
          </button>
        </div>
        <div className="fu-frules">
          {own.length === 0 ? (
            <p className="fu-note">Sin reglas activas.</p>
          ) : (
            own.map((r) => {
              const versions = stage.versions.filter((v) => (v.action ?? "principal") === r.action);
              const active = versions.find((v) => v.status === "active");
              const test = versions.find((v) => v.status === "test");
              return (
                <div key={r.key} className={`fu-frule${r.enabled ? "" : " is-off"}`} data-testid="followup-funnel-rule" data-rule={r.key}>
                  <small>{ruleSituations(r)}{r.after_hours ? ` · a las ${r.after_hours} h` : " · enseguida"}</small>
                  <b>{actionLabel(selected, r.action as Action)}</b>
                  <span>{active ? `V${active.version} activa` : "Sin texto: queda bloqueada"}{!r.enabled ? " · regla apagada" : ""}</span>
                  <span>
                    <b className="fu-big">{pct(active?.stats.rate ?? null)}</b> conversión · {active?.stats.executions ?? 0} ejecuciones{active?.stats.smallSample ? " · muestra chica" : ""}
                  </span>
                  <span className={`fu-pill ${test ? "is-baja" : "is-sit"}`}>{test ? `Prueba A/B: V${test.version} contra V${active?.version ?? "?"}` : "Sin prueba"}</span>
                </div>
              );
            })
          )}
        </div>
      </div>
      <Queue stage={stage} />
    </section>
  );
}

/* ------------------------------------------------------------------ Mensajes y reglas (rediseño) */

const NEW_RULE = "__nueva";
const NEW_VERSION = "__nueva";
const DISCARD = "Hay cambios sin guardar. ¿Descartarlos?";
type StageTab = "reglas" | "mensajes" | "resumen";
type MsgTab = "mensaje" | "versiones" | "observaciones";

/** Qué espera cada etapa, en una línea (la misma lectura que la tabla de docs/FOLLOWUP.md). */
const STAGE_TEXT: Record<StageKey, string> = {
  "no-contactado": "Cuentas de prospección que todavía no recibieron el primer mensaje.",
  "no-responde": "Seguimiento a quienes confirmaron el número y aún no avanzaron.",
  "sin-demo": "Interesadas a las que todavía falta crear la demo.",
  "sin-enviar": "Demo creada que todavía no se envió.",
  "no-abrio": "Demo enviada que todavía no se abrió.",
  "sin-interaccion": "Visitaron el panel sin interactuar.",
  "sin-cuenta": "Interactuaron con la demo y todavía no crearon cuenta.",
  "sin-uso": "Cuenta creada que todavía no la usa.",
  "sin-suscripcion": "Cuenta activa que todavía no se suscribió.",
};

/** Cuándo se ejecuta una regla, en una frase. Misma lectura en la lista, el resumen y el editor. */
function ruleWhen(stage: StageKey, r: Rule) {
  const after = r.after_action ? ` y ya salió «${actionLabel(stage, r.after_action as Action)}»` : "";
  const timing = r.after_hours ? `a las ${r.after_hours} h de nuestro último mensaje` : "enseguida";
  return `Si ${ruleSituations(r).toLowerCase()}${after} · ${timing} · ${daysText(r.days)} de ${r.hours_from} a ${r.hours_to}`;
}

/** La misma etapa, con solo las versiones de una acción: lo que el editor de esa acción necesita. */
const versionsOf = (stage: StageView, action: Action): StageView => ({ ...stage, versions: stage.versions.filter((v) => (v.action ?? "principal") === action) });

/**
 * Mensajes y reglas: las etapas en una barra horizontal; dentro de la etapa, sus
 * reglas (izquierda) y el editor de la regla elegida (derecha). Cambia solo la
 * interfaz: las reglas y las versiones se guardan con los mismos endpoints.
 */
function RulesWorkspace({ stages, rules, changes }: { stages: StageView[]; rules: Rule[]; changes: Change[] }) {
  const [stageKey, setStageKey] = useState<StageKey>(stages[0].key);
  const [tab, setTab] = useState<StageTab>("reglas");
  const [selected, setSelected] = useState<string | null>(null);
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const stage = stages.find((s) => s.key === stageKey) ?? stages[0];
  const index = stages.indexOf(stage) + 1;
  const own = rules.filter((r) => r.stage === stage.key).sort((a, b) => a.position - b.position);
  const available = actionsOf(stage.key);
  const sample = stage.queue.find((q) => q.wa) ?? stage.queue[0] ?? null;
  const waiting = (s: StageView) => s.queue.filter((q) => q.execution?.status !== "sent").length;
  const isDirty = Object.values(dirty).some(Boolean);
  const adding = selected === NEW_RULE;
  const current = adding ? null : own.find((r) => r.key === selected) ?? own.find((r) => r.enabled && available.includes(r.action as Action)) ?? own[0] ?? null;
  const markDirty = (id: string) => (d: boolean) => setDirty((p) => (p[id] === d ? p : { ...p, [id]: d }));

  /** Cambiar de etapa, pestaña o regla con datos sin guardar pide confirmación; lo que no se guardó se descarta. */
  function go(next: () => void) {
    if (isDirty && !window.confirm(DISCARD)) return;
    setDirty({});
    next();
  }

  return (
    <>
      <nav className="fu-flow" aria-label="Etapas del embudo" data-testid="followup-flow">
        {stages.map((s, i) => (
          <Fragment key={s.key}>
            <button
              type="button"
              className={`fu-flowstep${s.key === stage.key ? " is-on" : ""}`}
              aria-pressed={s.key === stage.key}
              data-testid="followup-stage"
              data-stage={s.key}
              onClick={() => {
                if (s.key !== stage.key) go(() => { setStageKey(s.key); setSelected(null); });
              }}
            >
              <span className="fu-num">{i + 1}</span>
              <span className="fu-flowtext">
                <b>{s.title}</b>
                <small>{waiting(s)} esperando</small>
              </span>
            </button>
            {i < stages.length - 1 && <ChevronRight className="fu-flowarrow" size={16} aria-hidden="true" />}
          </Fragment>
        ))}
      </nav>

      <section className="fu-stagehead" data-testid="followup-stage-head" data-stage={stage.key}>
        <div>
          <div className="fu-name">
            <span className="fu-num">{index}</span>
            <span className="fu-title">{stage.title}</span>
          </div>
          <p className="fu-note">{STAGE_TEXT[stage.key]}</p>
          <div className="fu-meta">
            <span className="fu-waiting">{waiting(stage)} esperando</span> → {stage.goal}
          </div>
        </div>
        <nav className="fu-subtabs" aria-label="Secciones de la etapa">
          {(
            [
              ["mensajes", "Mensajes de la etapa"],
              ["reglas", `Reglas (${own.length})`],
              ["resumen", "Resumen"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={`fu-subtab${tab === k ? " is-on" : ""}`}
              aria-pressed={tab === k}
              data-testid={`followup-subtab-${k}`}
              onClick={() => {
                if (k !== tab) go(() => setTab(k));
              }}
            >
              {label}
            </button>
          ))}
        </nav>
      </section>

      {tab === "reglas" && (
        <div className="fu-workspace">
          <RulesEditor stage={stage.key} rules={own} selected={current?.key ?? null} adding={adding} available={available} isDirty={isDirty} onSelect={(k) => go(() => setSelected(k))} onAdd={() => go(() => setSelected(NEW_RULE))} />
          <div className="fu-rdetail" data-testid="followup-rule-detail">
            {adding ? (
              <RuleEditor key={`${stage.key}:new`} stage={stage} rule={null} sample={sample} onDirty={markDirty("regla")} onAdded={() => setSelected(null)} />
            ) : current ? (
              <RuleEditor key={`${stage.key}:${current.key}:${JSON.stringify(current)}`} stage={stage} rule={current} sample={sample} onDirty={markDirty("regla")} />
            ) : (
              <div className="fu-detail-card">
                <p className="fu-note">Esta etapa no tiene reglas. Agregá una para que el motor la ejecute.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "mensajes" && (
        <div className="fu-stack">
          {available.map((a) => (
            <section key={a} className="fu-action" data-testid="followup-action" data-action={a}>
              <h3 className="fu-h3">
                {actionLabel(stage.key, a)} <small>· {actionWhen(stage.key, a)}</small>
              </h3>
              <Editor key={`${stage.key}:${a}`} stage={versionsOf(stage, a)} action={a} sample={sample} onDirty={markDirty(`mensaje:${a}`)} />
            </section>
          ))}
        </div>
      )}

      {tab === "resumen" && (
        <div className="fu-stack" data-testid="followup-summary">
          <ul className="fu-summarylist">
            {own.map((r) => (
              <li key={r.key}>
                <span className="fu-rulepos">{r.position}</span>
                <span className="fu-rulemain">
                  <b>{actionLabel(stage.key, r.action as Action)}</b>
                  <span>{ruleWhen(stage.key, r)}</span>
                </span>
                <span className={`fu-st is-${r.enabled ? "active" : "archived"}`}>{r.enabled ? "Activa" : "Apagada"}</span>
                {!available.includes(r.action as Action) && <span className="fu-st is-archived">Acción no disponible</span>}
              </li>
            ))}
          </ul>
          {!own.length && <p className="fu-note">Esta etapa no tiene reglas.</p>}
          <ul className="fu-summarylist">
            {available.map((a) => {
              const live = stage.versions.find((v) => (v.action ?? "principal") === a && v.status === "active");
              return (
                <li key={a}>
                  <b>{actionLabel(stage.key, a)}</b>
                  <span>{live ? `Versión activa: V${live.version}` : "Falta configurar el mensaje de esta acción"}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <ChangeLog changes={changes} />
    </>
  );
}

/** Las reglas de la etapa: se evalúan en orden y gana la primera que cumple. Elegir una abre su editor. */
function RulesEditor({
  stage,
  rules,
  selected,
  adding,
  available,
  isDirty,
  onSelect,
  onAdd,
}: {
  stage: StageKey;
  rules: Rule[];
  selected: string | null;
  adding: boolean;
  available: Action[];
  isDirty: boolean;
  onSelect: (key: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className="fu-rules" data-testid="followup-rules" data-stage={stage}>
      <div className="fu-qhead">
        <div>
          <span className="fu-lbl">Reglas de esta etapa</span>
          <p className="fu-note">Se evalúan en orden. Se ejecuta la primera que cumple.</p>
        </div>
        <button type="button" className="button button-small button-outline" data-testid="followup-rule-add" onClick={onAdd} disabled={adding}>
          <Plus size={15} aria-hidden="true" /> Agregar regla
        </button>
      </div>
      {rules.map((r) => (
        <RuleRow key={r.key} stage={stage} rule={r} selected={selected === r.key} unavailable={!available.includes(r.action as Action)} isDirty={isDirty} onSelect={() => onSelect(r.key)} />
      ))}
      {!rules.length && <p className="fu-note">Todavía no hay reglas para esta etapa.</p>}
      {adding && <p className="fu-note">Nueva regla: completala a la derecha y guardala.</p>}
    </div>
  );
}

/** Una regla en la lista: número de orden, acción, condición en una línea y el interruptor de activa. */
function RuleRow({ stage, rule, selected, unavailable, isDirty, onSelect }: { stage: StageKey; rule: Rule; selected: boolean; unavailable: boolean; isDirty: boolean; onSelect: () => void }) {
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
      <button type="button" className="fu-rulecard-main" aria-pressed={selected} data-testid="followup-rule-edit" onClick={onSelect}>
        <span className="fu-rulepos">{rule.position}</span>
        <span className="fu-rulemain">
          <b>
            {actionLabel(stage, rule.action as Action)}
            {unavailable && <span className="fu-st is-archived"> No disponible aquí</span>}
          </b>
          <span>{ruleWhen(stage, rule)}</span>
        </span>
      </button>
      <label className="fu-switch">
        <input
          type="checkbox"
          checked={rule.enabled}
          disabled={busy || (unavailable && !rule.enabled)}
          onChange={(e) => toggle(e.target.checked)}
          data-testid="followup-rule-toggle"
        />{" "}
        {unavailable ? (rule.enabled ? "Encendida (no se ejecuta)" : "Inactiva: no disponible aquí") : rule.enabled ? "Activa" : "Apagada"}
      </label>
      {error && <small className="fu-error">{error}</small>}
    </div>
  );
}

/**
 * El editor de una regla, en tres partes: cuándo se ejecuta, qué se ejecuta
 * (acción y versión, con su mensaje) y la vista previa. «Guardar cambios»
 * guarda la regla; cada versión se guarda con sus propios botones.
 */
function RuleEditor({ stage, rule, sample, onDirty, onAdded }: { stage: StageView; rule: Rule | null; sample: QueueItem | null; onDirty: (dirty: boolean) => void; onAdded?: () => void }) {
  const router = useRouter();
  const available = actionsOf(stage.key);
  const blank: Rule = { key: "", stage: stage.key, situations: ["sin_respuesta"], action: "principal", after_hours: 48, after_action: null, position: 60, enabled: true, hours_from: 9, hours_to: 19, days: [1, 2, 3, 4, 5, 6] };
  const base = rule ?? blank;
  const [r, setR] = useState<Rule>(base);
  const [msgDirty, setMsgDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ruleDirty = JSON.stringify(r) !== JSON.stringify(base);
  const unavailable = !available.includes(r.action as Action);
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
  const toggleDay = (d: number) => set({ days: r.days.includes(d) ? r.days.filter((y) => y !== d) : [...r.days, d].sort((a, b) => a - b) });
  function setAction(a: Action) {
    if (a === r.action) return;
    if (msgDirty && !window.confirm(DISCARD)) return;
    setMsgDirty(false);
    set({ action: a, after_action: r.after_action === a ? null : r.after_action });
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      // Una regla con acción no disponible en su etapa se guarda apagada: el motor ya no la usa.
      await api("/api/admin/follow-up/reglas", { method: "PUT", body: JSON.stringify(unavailable ? { ...r, enabled: false } : r) });
      if (!rule) onAdded?.();
      router.refresh();
      setBusy(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos guardar la regla.");
      setBusy(false);
    }
  }

  return (
    <div className="fu-detail-card" data-testid="followup-rule-form">
      <header className="fu-rdhead">
        <div>
          <span className="fu-lbl">{rule ? `Regla ${rule.position}` : "Nueva regla"}</span>
          <h3>{actionLabel(stage.key, r.action as Action)}</h3>
          <p className="fu-note">{ruleWhen(stage.key, r)}</p>
        </div>
        <label className="fu-switch">
          <input
            type="checkbox"
            checked={r.enabled}
            disabled={unavailable && !r.enabled}
            onChange={(e) => set({ enabled: e.target.checked })}
            data-testid="followup-rule-enabled"
          />{" "}
          {unavailable ? (r.enabled ? "Encendida (no se ejecuta)" : "No disponible aquí") : "Activa"}
        </label>
      </header>

      <section className="fu-part" data-testid="followup-part-when">
        <span className="fu-lbl">1 · Cuándo se ejecuta</span>
        <div className="fu-field">
          <span className="fu-lbl2">Situación (cualquiera de)</span>
          <div className="fu-chips">
            {r.situations.map((x) => (
              <button key={x} type="button" className="fu-chipbtn is-on" aria-pressed="true" onClick={() => toggleSituation(x)}>
                ✓ {SITUATIONS[x]}
              </button>
            ))}
            {SITUATION_OPTIONS.filter((x) => !r.situations.includes(x)).map((x) => (
              <button key={x} type="button" className="fu-chipbtn" aria-pressed="false" onClick={() => toggleSituation(x)}>
                + {SITUATIONS[x]}
              </button>
            ))}
          </div>
          {!r.situations.length && <span className="fu-note">Ninguna marcada: aplica a cualquier situación.</span>}
        </div>
        <div className="fu-partgrid">
          <label>
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
          <label>
            <span>Espera (horas desde nuestro último mensaje)</span>
            <input type="number" min={0} max={720} step={1} value={r.after_hours} onChange={(e) => set({ after_hours: Number(e.target.value) })} data-testid="followup-rule-hours" />
          </label>
          <label>
            <span>Orden de prioridad</span>
            <input type="number" min={0} max={1000} value={r.position} onChange={(e) => set({ position: Number(e.target.value) })} />
          </label>
          <fieldset className="fu-hours">
            <legend>Horario de envío</legend>
            <label>
              <span className="sr-only">Desde (hora)</span>
              <input type="number" min={0} max={23} value={r.hours_from} onChange={(e) => set({ hours_from: Number(e.target.value) })} aria-label="Desde (hora)" />
            </label>
            <span aria-hidden="true">a</span>
            <label>
              <span className="sr-only">Hasta (hora)</span>
              <input type="number" min={1} max={24} value={r.hours_to} onChange={(e) => set({ hours_to: Number(e.target.value) })} aria-label="Hasta (hora)" />
            </label>
          </fieldset>
        </div>
        <div className="fu-field">
          <span className="fu-lbl2">Días habilitados</span>
          <div className="fu-chips">
            {DAY_SHORT.map((d, i) => {
              const on = r.days.includes(i);
              return (
                <button key={d} type="button" className={`fu-chipbtn${on ? " is-on" : ""}`} aria-pressed={on} onClick={() => toggleDay(i)}>
                  {d}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="fu-part" data-testid="followup-part-what">
        <span className="fu-lbl">2 · Qué se ejecuta</span>
        <label>
          <span>Acción (mensaje)</span>
          <select value={r.action} onChange={(e) => setAction(e.target.value as Action)}>
            {[...new Set<Action>([...available, r.action as Action])].map((a) => (
              <option key={a} value={a} disabled={!available.includes(a)}>
                {actionLabel(stage.key, a)}
                {available.includes(a) ? "" : " · no disponible en esta etapa"}
              </option>
            ))}
          </select>
        </label>
        {unavailable ? (
          <p className="fu-warn" role="status">
            Acción no disponible para esta etapa. Esta regla no se ejecuta aquí: elegí una acción de la etapa o apagala.
          </p>
        ) : (
          <Editor key={`${stage.key}:${r.action}`} stage={versionsOf(stage, r.action as Action)} action={r.action as Action} sample={sample} onDirty={setMsgDirty} />
        )}
      </section>

      <footer className="fu-footer">
        {error && (
          <p className="fu-error" role="alert">
            {error}
          </p>
        )}
        {msgDirty && <p className="fu-warn">El mensaje tiene cambios sin guardar: guardalos con sus botones.</p>}
        <div className="fu-actions">
          <button type="button" className="button button-primary button-small" data-testid="followup-rule-save" disabled={busy || (!!rule && !ruleDirty)} onClick={save}>
            {rule ? "Guardar cambios" : "Crear regla"}
          </button>
          <button
            type="button"
            className="fu-link"
            disabled={busy || !ruleDirty}
            onClick={() => {
              setR(base);
              setError("");
            }}
          >
            Cancelar
          </button>
        </div>
        <p className="fu-note">«Guardar cambios» guarda la regla. Cada versión del mensaje es un cambio aparte y se guarda con sus botones.</p>
      </footer>
    </div>
  );
}

/**
 * El mensaje de una acción: versiones, texto, observaciones y CTA para la
 * extensión, con la vista previa de WhatsApp a la derecha. Los botones de
 * guardar son los de siempre: crear una versión, editarla o cambiar su estado.
 */
function Editor({ stage, action, sample, onDirty }: { stage: StageView; action: Action; sample: QueueItem | null; onDirty?: (dirty: boolean) => void }) {
  const router = useRouter();
  const live = stage.versions.find((v) => v.status === "active") ?? stage.versions.at(-1) ?? null;
  const [selected, setSelected] = useState<string | null>(live?.id ?? null);
  const [draft, setDraft] = useState<Draft | null>(live ? null : EMPTY);
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
  const dirtyDraft = draft !== null && (editing ? JSON.stringify(draft) !== JSON.stringify(draftOf(editing, editing.id)) : (draft.body.trim() !== "" || draft.notes.trim() !== "" || draft.trigger.trim() !== ""));
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
  const update = () =>
    run(async () => {
      if (!draft?.editing) return;
      await api<Version>("/api/admin/follow-up/versiones", { method: "PUT", body: JSON.stringify({ id: draft.editing, ...draft }) });
      setDraft(null);
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
    setDraft(current ? draftOf(current) : EMPTY);
    setTab("mensaje");
  }
  function editVersion(v: Version) {
    if (!confirmDiscard()) return;
    setDraft(draftOf(v, v.id));
    setTab("mensaje");
  }
  function insert(name: string) {
    if (!draft) return;
    const el = document.getElementById(bodyId) as HTMLTextAreaElement | null;
    const at = el?.selectionStart ?? draft.body.length;
    setDraft({ ...draft, body: `${draft.body.slice(0, at)}{{${name}}}${draft.body.slice(at)}` });
  }

  const selectValue = draft ? draft.editing ?? NEW_VERSION : current?.id ?? "";
  const actionButtons = editing ? (
    <>
      <button type="button" className="button button-primary button-small" disabled={busy || !draft?.body.trim()} onClick={update}>
        Guardar cambios en V{editing.version}
      </button>
      <button type="button" className="fu-link" disabled={busy} onClick={() => setDraft(null)}>
        Cancelar
      </button>
      {editing.stats.executions > 0 && (
        <p className="fu-note">
          V{editing.version} ya tiene {editing.stats.executions} {editing.stats.executions === 1 ? "ejecución" : "ejecuciones"}: si cambiás el texto, sus números van a juntar el anterior y el nuevo. Para comparar dos textos, mejor «Nueva versión».
        </p>
      )}
    </>
  ) : draft ? (
    <>
      <button type="button" className="button button-primary button-small" disabled={busy || !draft.body.trim()} onClick={() => save("active")}>
        Guardar V{nextNumber} como activa
      </button>
      {active && (
        <button type="button" className="button button-small button-outline" disabled={busy || !draft.body.trim()} onClick={() => save("test")}>
          Guardar y probar 50/50 contra V{active.version}
        </button>
      )}
      {stage.versions.length > 0 && (
        <button type="button" className="fu-link" disabled={busy} onClick={() => setDraft(null)}>
          Descartar
        </button>
      )}
    </>
  ) : current?.status === "active" ? (
    <p className="fu-note">La activa: la usan todas las inmobiliarias de esta etapa{stage.versions.some((v) => v.status === "test") ? " que no están en la prueba" : ""}.</p>
  ) : current?.status === "test" ? (
    <>
      <button type="button" className="button button-primary button-small" disabled={busy} onClick={() => setStatus(current.id, "active")}>
        Hacerla la activa
      </button>
      <button type="button" className="button button-small button-outline" disabled={busy} onClick={() => setStatus(current.id, "archived")}>
        Detener prueba
      </button>
      <p className="fu-note">Recibe la mitad de las inmobiliarias de la etapa.</p>
    </>
  ) : current ? (
    <>
      <button type="button" className="button button-small button-outline" disabled={busy} onClick={() => setStatus(current.id, "active")}>
        Volver a activarla
      </button>
      {active && (
        <button type="button" className="button button-small button-outline" disabled={busy} onClick={() => setStatus(current.id, "test")}>
          Probar 50/50 contra V{active.version}
        </button>
      )}
    </>
  ) : null;

  return (
    <div className="fu-mededit" data-testid="followup-message-editor" data-action={action}>
      {!stage.versions.length && (
        <p className="fu-warn" role="status">
          Falta configurar el mensaje de esta acción.
        </p>
      )}
      <div className="fu-vhead">
        <label className="fu-vselect">
          <span className="fu-lbl">Versión</span>
          <select value={selectValue} onChange={(e) => { if (e.target.value !== NEW_VERSION) pick(e.target.value); }} data-testid="followup-version-select">
            {stage.versions.map((v) => (
              <option key={v.id} value={v.id}>
                V{v.version} · {STATUS_LABEL[v.status]}
              </option>
            ))}
            {draft && !draft.editing && <option value={NEW_VERSION}>Borrador V{nextNumber}</option>}
          </select>
        </label>
        <button type="button" className="fu-link" onClick={() => setTab("versiones")}>
          Editar versiones
        </button>
      </div>

      <div className="fu-subtabs" role="tablist">
        {(
          [
            ["mensaje", "Mensaje"],
            ["versiones", `Otras versiones (${stage.versions.filter((v) => v.id !== current?.id).length})`],
            ["observaciones", "Observaciones (extensión)"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`fu-subtab${tab === k ? " is-on" : ""}`} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

      <div className="fu-msg-grid">
        <div className="fu-msg-main">
          {tab === "mensaje" && shown && (
            <>
              <div className="fu-fields">
                <label>
                  <span>Cuándo se dispara</span>
                  <input value={draft ? draft.trigger : (shown as Version).trigger_label} readOnly={!draft} maxLength={120} placeholder="Ej.: 3 días sin respuesta" onChange={(e) => draft && setDraft({ ...draft, trigger: e.target.value })} />
                </label>
                <label>
                  <span>Canal</span>
                  <select value={shown.channel} disabled={!draft} onChange={(e) => draft && setDraft({ ...draft, channel: e.target.value as Channel })}>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="task">Tarea del equipo</option>
                  </select>
                </label>
                <label>
                  <span>Cuenta como conversión</span>
                  <input value={`Pasa a «${stage.goal}»`} readOnly />
                </label>
              </div>
              <p className="fu-note">Para mandar varios mensajes seguidos (como la presentación), separalos con una línea que diga solo «---».</p>
              <div className="fu-msg-row">
                <label className="fu-textarea">
                  <span>{editing ? `Mensaje · editando V${editing.version}` : `Mensaje · V${current?.version ?? nextNumber}`}</span>
                  <textarea id={bodyId} value={shown.body} readOnly={!draft} maxLength={4000} onChange={(e) => draft && setDraft({ ...draft, body: e.target.value })} />
                </label>
                {original && original.id !== current?.id && (
                  <aside className="fu-orig" data-testid="followup-original">
                    <span className="fu-lbl">Versión original (V{original.version})</span>
                    <p>{original.body}</p>
                    <button
                      type="button"
                      className="button button-small button-outline"
                      disabled={!!draft && draft.body === original.body}
                      onClick={() => setDraft({ channel: original.channel, trigger: original.trigger_label, body: original.body, ctas: [...original.ctas], notes: original.notes ?? "" })}
                    >
                      Usar como base
                    </button>
                  </aside>
                )}
              </div>
              {draft && (
                <div className="fu-vars">
                  Variables:
                  {(Object.keys(VARIABLES) as (keyof typeof VARIABLES)[]).map((k) => (
                    <button key={k} type="button" className="fu-var" title={VARIABLES[k]} onClick={() => insert(k)}>
                      {`{{${k}}}`}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {tab === "versiones" && (
            <div className="fu-vtabs" data-testid="followup-versions">
              <span className="fu-lbl">Versiones</span>
              {stage.versions.map((v) => (
                <button key={v.id} type="button" className={`fu-vtab${!draft && current?.id === v.id ? " is-on" : ""}`} onClick={() => pick(v.id)}>
                  V{v.version} <span className={`fu-st is-${v.status}`}>{STATUS_LABEL[v.status]}</span>
                </button>
              ))}
              {draft && !draft.editing ? (
                <span className="fu-vtab is-on">
                  V{nextNumber} <span className="fu-st is-draft">Borrador</span>
                </span>
              ) : editing ? (
                <span className="fu-vtab is-on">
                  V{editing.version} <span className="fu-st is-draft">Editando</span>
                </span>
              ) : (
                <button type="button" className="fu-vtab" onClick={newVersion}>
                  <Plus size={14} aria-hidden="true" /> Nueva versión
                </button>
              )}
              {!draft && current && (
                <button type="button" className="fu-vtab fu-edit" data-testid="followup-edit-version" onClick={() => editVersion(current)}>
                  <Pencil size={13} aria-hidden="true" /> Editar V{current.version}
                </button>
              )}
            </div>
          )}

          {tab === "observaciones" && shown && (
            <>
              <label className="fu-textarea fu-notes">
                <span>Observaciones para la extensión · cuándo y cómo mandarlo</span>
                <textarea
                  data-testid="followup-version-notes"
                  value={draft ? draft.notes : ((shown as Version).notes ?? "")}
                  readOnly={!draft}
                  maxLength={4000}
                  placeholder={draft ? "Ej.: no mandar fines de semana; si respondió con una pregunta, contestarla antes." : "Sin observaciones. Tocá «Editar» para sumarlas."}
                  onChange={(e) => draft && setDraft({ ...draft, notes: e.target.value })}
                />
              </label>
              <fieldset className="fu-ctas">
                <legend className="fu-lbl">Call to actions para la extensión</legend>
                {CTA_KEYS.map((k) => {
                  const on = shown.ctas.includes(k);
                  return (
                    <label key={k} className={`fu-cta${on ? "" : " is-off"}`}>
                      <input type="checkbox" checked={on} disabled={!draft} onChange={() => draft && setDraft({ ...draft, ctas: on ? draft.ctas.filter((c) => c !== k) : [...draft.ctas, k] })} />
                      {CTA_LABEL[k]}
                    </label>
                  );
                })}
              </fieldset>
            </>
          )}

          <div className="fu-actions">{actionButtons}</div>
          {!draft && current?.edited_at && <p className="fu-note">Texto editado el {day(current.edited_at)}: sus números juntan el texto anterior y el nuevo.</p>}
          {error && (
            <p className="fu-error" role="alert">
              {error}
            </p>
          )}
        </div>
        {shown && <Preview body={shown.body} sample={sample} channel={shown.channel} ctas={shown.ctas} />}
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
  const task = channel === "task";
  const label = task ? "Vista previa de la tarea" : `Vista previa en WhatsApp${sample ? ` · ${sample.name}` : ""}`;
  if (!parts.length)
    return (
      <div className="fu-wa" data-testid="followup-preview">
        <span className="fu-lbl">{label}</span>
        <p className="fu-note">Escribí el mensaje para ver cómo queda.</p>
      </div>
    );
  return (
    <div className={`fu-wa${task ? " is-task" : ""}`} data-testid="followup-preview">
      <span className="fu-lbl">{label}</span>
      {task ? (
        <div className="fu-wa-task">
          {parts.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      ) : (
        <div className="fu-wa-chat">
          {parts.map((p, i) => (
            <div key={i} className="fu-bubble is-out">
              {p}
            </div>
          ))}
        </div>
      )}
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
          <span>Ejecutadas</span>
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
            {prepared.ctas.includes("create_demo") && (
              <Link className="button button-small button-primary" href={prepared.links.createDemo} target="_blank" onClick={() => void mark("opened")}>
                <Plus size={16} aria-hidden="true" /> Crear demo
              </Link>
            )}
            <button type="button" className="button button-small button-outline" data-testid="followup-confirm" disabled={sent || busy} onClick={() => mark("sent")}>
              {sent ? "Hecha" : "Marcar hecha"}
            </button>
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

