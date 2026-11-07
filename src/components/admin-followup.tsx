"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronRight, ClipboardCopy, KeyRound, Link2, MessageCircle, Plus } from "lucide-react";
import { api } from "@/components/admin-demos";
import { CTA_KEYS, CTA_LABEL, VARIABLES, pct, type Channel, type Cta, type VersionStatus } from "@/lib/followup/stages";
import type { QueueItem, StageView } from "@/lib/followup/server";

type Version = StageView["versions"][number];
type Prepared = {
  agencyId: string;
  versionId: string;
  version: number;
  channel: Channel;
  ctas: Cta[];
  person: string | null;
  phone: string | null;
  message: string;
  ready: boolean;
  warnings: string[];
  whatsappUrl: string | null;
  links: { demo: string | null; panel: string | null; createDemo: string };
};
type Exec = QueueItem["execution"];

const STATUS_LABEL: Record<VersionStatus | "draft", string> = { active: "Activa", test: "A prueba", archived: "Archivada", draft: "Borrador" };
const EXEC_LABEL = { pending: "Pendiente", opened: "Abierto", sent: "Enviado", failed: "No salió" } as const;
const PAGE = 25;

function ago(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return days <= 0 ? "hoy" : days === 1 ? "hace 1 día" : `hace ${days} días`;
}
async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** /admin/follow-up: one band per funnel stage, with its next best action, the agencies waiting in it and each version's numbers. */
export function FollowupBoard({ stages }: { stages: StageView[] }) {
  const [open, setOpen] = useState<string | null>(() => stages.find((s) => s.queue.length)?.key ?? null);
  const waiting = stages.reduce((n, s) => n + s.queue.filter((q) => q.execution?.status !== "sent").length, 0);
  const all = stages.flatMap((s) => s.versions);
  const executions = all.reduce((n, v) => n + v.stats.executions, 0);
  const conversions = all.reduce((n, v) => n + v.stats.conversions, 0);
  const tests = stages.filter((s) => s.versions.some((v) => v.status === "test")).length;
  return (
    <>
      <div className="fu-summary">
        <div>
          <b>{waiting}</b>
          <span>inmobiliarias esperando una acción</span>
        </div>
        <div>
          <b>{executions}</b>
          <span>ejecuciones confirmadas</span>
        </div>
        <div>
          <b>{conversions}</b>
          <span>avanzaron de etapa después</span>
        </div>
        <div>
          <b>{tests}</b>
          <span>{tests === 1 ? "etapa con prueba A/B" : "etapas con prueba A/B"}</span>
        </div>
      </div>
      <div className="fu-stages">
        {stages.map((s, i) => (
          <StageBand key={s.key} stage={s} index={i + 1} open={open === s.key} onToggle={() => setOpen(open === s.key ? null : s.key)} />
        ))}
      </div>
    </>
  );
}

function StageBand({ stage, index, open, onToggle }: { stage: StageView; index: number; open: boolean; onToggle: () => void }) {
  const active = stage.versions.find((v) => v.status === "active") ?? null;
  const test = stage.versions.find((v) => v.status === "test") ?? null;
  const pending = stage.queue.filter((q) => q.execution?.status !== "sent").length;
  return (
    <section className={`fu-stage${open ? " is-open" : ""}`} data-testid="followup-stage" data-stage={stage.key}>
      <button type="button" className="fu-row" onClick={onToggle} aria-expanded={open}>
        <div>
          <div className="fu-name">
            <span className="fu-num">{index}</span>
            <span className="fu-title">{stage.title}</span>
          </div>
          <div className="fu-meta">
            <span className="fu-waiting">{pending} esperando</span> → {stage.goal}
          </div>
        </div>
        <div className="fu-preview">
          {active ? (
            <>
              <b>{active.trigger_label || "Next best action"}:</b> {active.body}
            </>
          ) : (
            "Sin versión activa"
          )}
        </div>
        <div className="fu-rate">
          {test && <span className="fu-st is-test">A/B</span>}
          {active && <span className="fu-vchip">V{active.version}</span>}
          <span className="fu-pct">{pct(active?.stats.rate ?? null)}</span>
          <ChevronRight className="fu-chev" size={18} aria-hidden="true" />
        </div>
      </button>
      {open && (
        <div className="fu-body">
          <Editor stage={stage} />
          <Queue stage={stage} />
          <VersionTable stage={stage} />
        </div>
      )}
    </section>
  );
}

type Draft = { channel: Channel; trigger: string; body: string; ctas: Cta[] };

function Editor({ stage }: { stage: StageView }) {
  const router = useRouter();
  const live = stage.versions.find((v) => v.status === "active") ?? stage.versions.at(-1) ?? null;
  const [selected, setSelected] = useState<string | null>(live?.id ?? null);
  const [draft, setDraft] = useState<Draft | null>(live ? null : { channel: "whatsapp", trigger: "", body: "", ctas: ["whatsapp", "copy"] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const current = stage.versions.find((v) => v.id === selected) ?? live;
  const shown: Draft | Version | null = draft ?? current;
  const active = stage.versions.find((v) => v.status === "active");
  const nextNumber = Math.max(0, ...stage.versions.map((v) => v.version)) + 1;
  const bodyId = `fu-body-${stage.key}`;

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
      const v = await api<Version>("/api/admin/follow-up/versiones", { method: "POST", body: JSON.stringify({ stage: stage.key, ...draft, status }) });
      setDraft(null);
      setSelected(v.id);
    });
  const setStatus = (id: string, status: VersionStatus) => run(() => api("/api/admin/follow-up/versiones", { method: "PATCH", body: JSON.stringify({ id, status }) }));
  function insert(name: string) {
    if (!draft) return;
    const el = document.getElementById(bodyId) as HTMLTextAreaElement | null;
    const at = el?.selectionStart ?? draft.body.length;
    setDraft({ ...draft, body: `${draft.body.slice(0, at)}{{${name}}}${draft.body.slice(at)}` });
  }

  return (
    <div className="fu-grid">
      <div className="fu-editor">
        <div className="fu-vtabs">
          <span className="fu-lbl">Versión</span>
          {stage.versions.map((v) => (
            <button
              key={v.id}
              type="button"
              className={`fu-vtab${!draft && current?.id === v.id ? " is-on" : ""}`}
              onClick={() => {
                setDraft(null);
                setSelected(v.id);
              }}
            >
              V{v.version} <span className={`fu-st is-${v.status}`}>{STATUS_LABEL[v.status]}</span>
            </button>
          ))}
          {draft ? (
            <span className="fu-vtab is-on">
              V{nextNumber} <span className="fu-st is-draft">Borrador</span>
            </span>
          ) : (
            <button
              type="button"
              className="fu-vtab"
              onClick={() => setDraft(current ? { channel: current.channel, trigger: current.trigger_label, body: current.body, ctas: [...current.ctas] } : { channel: "whatsapp", trigger: "", body: "", ctas: ["whatsapp", "copy"] })}
            >
              <Plus size={14} aria-hidden="true" /> Nueva versión
            </button>
          )}
        </div>
        {shown && (
          <>
            <div className="fu-fields">
              <label>
                <span>Cuándo se dispara</span>
                <input
                  value={draft ? draft.trigger : (shown as Version).trigger_label}
                  readOnly={!draft}
                  maxLength={120}
                  placeholder="Ej.: 3 días sin respuesta"
                  onChange={(e) => draft && setDraft({ ...draft, trigger: e.target.value })}
                />
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
            <label className="fu-textarea">
              <span>{draft ? "Next best action" : "Next best action · una versión guardada no se edita: creá una nueva"}</span>
              <textarea id={bodyId} value={shown.body} readOnly={!draft} maxLength={4000} onChange={(e) => draft && setDraft({ ...draft, body: e.target.value })} />
            </label>
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
            <div className="fu-actions">
              {draft ? (
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
              ) : null}
            </div>
            {error && (
              <p className="fu-error" role="alert">
                {error}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Queue({ stage }: { stage: StageView }) {
  const router = useRouter();
  const [state, setState] = useState<Record<string, Exec>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  const statusOf = (q: QueueItem) => (q.agencyId in state ? state[q.agencyId] : q.execution);
  const done = stage.queue.filter((q) => statusOf(q)?.status === "sent").length;
  const list = stage.queue.slice(0, shown);
  function finished(q: QueueItem, exec: Exec) {
    setState((s) => ({ ...s, [q.agencyId]: exec }));
    if (exec?.status === "sent") {
      // The next one still to do, so the team (or the extension) goes on without searching.
      const next = stage.queue.find((x) => x.agencyId !== q.agencyId && (x.agencyId in state ? state[x.agencyId] : x.execution)?.status !== "sent");
      setOpen(next?.agencyId ?? null);
      if (next && stage.queue.indexOf(next) >= shown) setShown(stage.queue.indexOf(next) + 1);
    }
  }
  return (
    <div className="fu-queue">
      <div className="fu-qhead">
        <span className="fu-lbl">Inmobiliarias en esta etapa · {stage.queue.length}</span>
        <span className="fu-qprog">
          <b>{done}</b> con la acción enviada · primero las que esperan hace más tiempo ·{" "}
          <button type="button" className="fu-link" onClick={() => router.refresh()}>
            Actualizar
          </button>
        </span>
      </div>
      {stage.queue.length === 0 ? (
        <p className="fu-empty">No hay inmobiliarias en esta etapa.</p>
      ) : (
        <div className="fu-qlist">
          {list.map((q) => (
            <QueueRow key={q.agencyId} stage={stage} item={q} exec={statusOf(q)} open={open === q.agencyId} onToggle={() => setOpen(open === q.agencyId ? null : q.agencyId)} onDone={(e) => finished(q, e)} />
          ))}
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

function QueueRow({ stage, item: q, exec, open, onToggle, onDone }: { stage: StageView; item: QueueItem; exec: Exec; open: boolean; onToggle: () => void; onDone: (e: Exec) => void }) {
  const status = exec?.status ?? "pending";
  const version = stage.versions.find((v) => v.id === q.versionId);
  const testing = stage.versions.some((v) => v.status === "test");
  return (
    <div className={`fu-qi${open ? " is-on" : ""}`} data-testid="followup-item" data-agency={q.agencyId} data-status={status} data-version={version?.version ?? ""}>
      <div className="fu-qrow">
        <div className="fu-qname">
          <Link href={`/admin/inmobiliarias/${q.agencyId}`}>{q.name}</Link>
          <span>{q.person ?? "Sin decisor cargado"}</span>
        </div>
        <div className="fu-qcontact">
          <span className="fu-mono">{q.phone ?? "Sin WhatsApp"}</span>
          <span>{q.needsReview ? "Número por revisar" : q.hasDemo ? "Con demo publicada" : "Sin demo publicada"}</span>
        </div>
        <div className="fu-qact">
          <span>{q.lastActivity ? `${q.lastActivity.text}` : "Sin actividad"}</span>
          <span>
            {ago(q.since)}
            {version ? ` · V${version.version}${testing ? (version.status === "test" ? " (prueba)" : " (activa)") : ""}` : ""}
          </span>
        </div>
        <span className={`fu-qst is-${status}`}>{EXEC_LABEL[status]}</span>
        <button type="button" className={`button button-small${status === "pending" && !open ? " button-primary" : " button-outline"}`} data-testid="followup-execute" onClick={onToggle} disabled={!version}>
          {open ? "Cerrar" : status === "sent" ? "Ver" : version?.channel === "task" ? "Hacer tarea" : "Ejecutar"}
        </button>
      </div>
      {open && <Execute stage={stage} item={q} exec={exec} onDone={onDone} />}
    </div>
  );
}

function Execute({ stage, item, exec, onDone }: { stage: StageView; item: QueueItem; exec: Exec; onDone: (e: Exec) => void }) {
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [failing, setFailing] = useState(false);
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState(exec?.status ?? "pending");

  useEffect(() => {
    let alive = true;
    api<Prepared>("/api/admin/follow-up/ejecuciones", { method: "POST", body: JSON.stringify({ accion: "preparar", inmobiliaria: item.agencyId, etapa: stage.key }) })
      .then((p) => alive && setPrepared(p))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "No pudimos armar el mensaje."));
    return () => {
      alive = false;
    };
  }, [item.agencyId, stage.key]);
  async function mark(estado: "opened" | "sent" | "failed") {
    if (!prepared) return;
    setError("");
    try {
      const r = await api<{ execution: NonNullable<Exec>; warning: string | null }>("/api/admin/follow-up/ejecuciones", {
        method: "POST",
        body: JSON.stringify({ accion: "registrar", inmobiliaria: item.agencyId, etapa: stage.key, version: prepared.versionId, estado, motivo: reason, texto: prepared.message }),
      });
      setStatus(r.execution.status);
      if (r.warning) setNotice(r.warning);
      if (estado !== "opened") onDone({ status: r.execution.status, at: r.execution.at, reason: estado === "failed" ? reason : null });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos registrarlo.");
    }
  }
  async function copyText(text: string, what: string) {
    setNotice((await copy(text)) ? `${what} copiado.` : `No pudimos copiarlo: ${text}`);
  }

  if (!prepared && !error) return <div className="fu-exec fu-note">Armando el mensaje y sus links…</div>;
  if (!prepared)
    return (
      <div className="fu-exec">
        <p className="fu-error" role="alert">
          {error}
        </p>
      </div>
    );
  const task = prepared.channel === "task";
  const sent = status === "sent";
  return (
    <div className="fu-exec">
      <div className="fu-exec-msg">
        <p className="fu-to">
          Para <b>{prepared.person ?? item.name}</b> · {task ? "tarea del equipo" : <>WhatsApp <b className="fu-mono">{prepared.phone ?? "sin número"}</b></>} · V{prepared.version}
        </p>
        <div className="fu-msg" data-testid="followup-message">
          {prepared.message}
        </div>
        {prepared.warnings.map((w) => (
          <p key={w} className="fu-warn">
            {w}
          </p>
        ))}
        {notice && (
          <p className="fu-note" role="status">
            {notice}
          </p>
        )}
        {error && (
          <p className="fu-error" role="alert">
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
            <button type="button" className="button button-small button-outline" data-testid="followup-confirm" disabled={sent} onClick={() => mark("sent")}>
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
                target="_blank"
                rel="noreferrer"
                onClick={() => !sent && void mark("opened")}
              >
                <MessageCircle size={16} aria-hidden="true" /> 1. Abrir WhatsApp con el mensaje
              </a>
            ) : (
              <span className="button button-small button-outline is-disabled" data-testid="followup-open" aria-disabled="true">
                <MessageCircle size={16} aria-hidden="true" /> 1. Abrir WhatsApp
              </span>
            )}
            <button type="button" className={`button button-small${status === "opened" ? " button-primary" : " button-outline"}`} data-testid="followup-confirm" disabled={sent || !prepared.ready} onClick={() => mark("sent")}>
              {sent ? "Enviado" : "2. Confirmar envío"}
            </button>
          </>
        )}
        {!sent &&
          (failing ? (
            <div className="fu-fail">
              <input data-testid="followup-failed-reason" value={reason} maxLength={300} placeholder="Por qué no salió" onChange={(e) => setReason(e.target.value)} aria-label="Por qué no salió" />
              <button type="button" className="button button-small button-outline" data-testid="followup-failed-save" disabled={!reason.trim()} onClick={() => mark("failed")}>
                Guardar
              </button>
            </div>
          ) : (
            <button type="button" className="button button-small button-outline" data-testid="followup-failed" onClick={() => setFailing(true)}>
              {task ? "No se pudo hacer" : "No se envió"}
            </button>
          ))}
        {!task && prepared.ctas.includes("copy") && (
          <button type="button" className="button button-small button-outline" onClick={() => copyText(prepared.message, "Mensaje")}>
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
      </div>
    </div>
  );
}

function VersionTable({ stage }: { stage: StageView }) {
  if (!stage.versions.length) return null;
  const max = Math.max(0.01, ...stage.versions.map((v) => v.stats.rate ?? 0));
  const measured = stage.versions.filter((v) => v.stats.executions >= 30);
  const best = measured.length > 1 ? measured.reduce((a, b) => ((b.stats.rate ?? 0) > (a.stats.rate ?? 0) ? b : a)) : null;
  return (
    <div className="fu-versions">
      <span className="fu-lbl">Resultados por versión</span>
      <div className="fu-tbl">
        <table>
          <thead>
            <tr>
              <th>Versión</th>
              <th>Estado</th>
              <th>Ejecuciones</th>
              <th>Conversiones</th>
              <th>Tasa de conversión</th>
            </tr>
          </thead>
          <tbody>
            {stage.versions.map((v) => (
              <tr key={v.id}>
                <td>
                  <b>V{v.version}</b>
                  {best?.id === v.id && <span className="fu-best">MEJOR</span>}
                </td>
                <td>
                  <span className={`fu-st is-${v.status}`}>{STATUS_LABEL[v.status]}</span>
                </td>
                <td>{v.stats.executions}</td>
                <td>{v.stats.conversions}</td>
                <td>
                  <span className={`fu-bar${v.status === "archived" ? " is-off" : ""}`} style={{ width: `${v.stats.rate === null ? 0 : Math.max(2, (v.stats.rate / max) * 120)}px` }} />
                  <b>{pct(v.stats.rate)}</b>
                  {v.stats.smallSample && <small>muestra chica</small>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="fu-note">
        Ejecución: un envío confirmado, una vez por inmobiliaria. Conversión: la inmobiliaria pasó a «{stage.goal}» o más allá después del envío, con las mismas reglas que el embudo de Inmobiliarias.
      </p>
    </div>
  );
}
