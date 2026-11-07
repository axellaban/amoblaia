"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { ChevronRight, ClipboardCopy, KeyRound, Link2, MessageCircle, Pencil, Plus } from "lucide-react";
import { api } from "@/components/admin-demos";
import { CTA_KEYS, CTA_LABEL, FOLLOWUP_STAGES, OUT, VARIABLES, pct, type Channel, type Cta, type StageKey, type VersionStatus } from "@/lib/followup/stages";
import type { QueueItem, StageView } from "@/lib/followup/server";

type Version = StageView["versions"][number];
type Prepared = {
  agencyId: string;
  versionId: string;
  version: number;
  channel: Channel;
  ctas: Cta[];
  notes: string;
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

/** A new version (no id) or an edit of a saved one (its id). */
type Draft = { id?: string; channel: Channel; trigger: string; body: string; ctas: Cta[]; notes: string };
const day = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

function Editor({ stage }: { stage: StageView }) {
  const router = useRouter();
  const live = stage.versions.find((v) => v.status === "active") ?? stage.versions.at(-1) ?? null;
  const [selected, setSelected] = useState<string | null>(live?.id ?? null);
  const [draft, setDraft] = useState<Draft | null>(live ? null : { channel: "whatsapp", trigger: "", body: "", ctas: ["whatsapp", "copy"], notes: "" });
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
  const saveEdit = () =>
    run(async () => {
      await api<Version>("/api/admin/follow-up/versiones", { method: "PUT", body: JSON.stringify(draft) });
      setDraft(null);
    });
  const editing = Boolean(draft?.id);
  const fromVersion = (v: Version, id?: string): Draft => ({ id, channel: v.channel, trigger: v.trigger_label, body: v.body, ctas: [...v.ctas], notes: v.notes ?? "" });
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
              className={`fu-vtab${(!draft || draft.id === v.id) && current?.id === v.id ? " is-on" : ""}`}
              onClick={() => {
                setDraft(null);
                setSelected(v.id);
              }}
            >
              V{v.version} <span className={`fu-st is-${v.status}`}>{STATUS_LABEL[v.status]}</span>
            </button>
          ))}
          {draft && !editing ? (
            <span className="fu-vtab is-on">
              V{nextNumber} <span className="fu-st is-draft">Borrador</span>
            </span>
          ) : !draft ? (
            <button
              type="button"
              className="fu-vtab"
              onClick={() => setDraft(current ? fromVersion(current) : { channel: "whatsapp", trigger: "", body: "", ctas: ["whatsapp", "copy"], notes: "" })}
            >
              <Plus size={14} aria-hidden="true" /> Nueva versión
            </button>
          ) : null}
          {!draft && current && (
            <button type="button" className="button button-small button-outline fu-edit" data-testid="followup-version-edit" onClick={() => setDraft(fromVersion(current, current.id))}>
              <Pencil size={14} aria-hidden="true" /> Editar V{current.version}
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
              <span>
                {editing ? `Editando V${current?.version}` : draft ? "Next best action" : "Next best action"}
                {!draft && current?.edited_at ? ` · editada el ${day(current.edited_at)}` : ""}
              </span>
              <textarea id={bodyId} data-testid="followup-version-body" value={shown.body} readOnly={!draft} maxLength={4000} onChange={(e) => draft && setDraft({ ...draft, body: e.target.value })} />
            </label>
            <label className="fu-textarea fu-obs">
              <span>Observaciones para la extensión</span>
              <textarea
                data-testid="followup-version-notes"
                value={draft ? draft.notes : (shown as Version).notes ?? ""}
                readOnly={!draft}
                maxLength={4000}
                placeholder={draft ? "Cuándo mandarlo, qué revisar antes, qué hacer si el chat dice otra cosa…" : "Sin observaciones"}
                onChange={(e) => draft && setDraft({ ...draft, notes: e.target.value })}
              />
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
              {editing && draft ? (
                <>
                  <button type="button" className="button button-primary button-small" data-testid="followup-version-save" disabled={busy || !draft.body.trim()} onClick={saveEdit}>
                    Guardar cambios en V{current?.version}
                  </button>
                  <button type="button" className="fu-link" disabled={busy} onClick={() => setDraft(null)}>
                    Cancelar
                  </button>
                  {(current?.stats.executions ?? 0) > 0 && (
                    <p className="fu-note">Ya tiene {current?.stats.executions} ejecuciones: si cambiás el texto, sus números juntan el anterior y el nuevo. Para comparar textos, «Nueva versión».</p>
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
  const [adding, setAdding] = useState(false);
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
        <span className="fu-lbl">Inmobiliarias en esta etapa · {stage.queue.length} · por score, de mayor a menor</span>
        <span className="fu-qprog">
          <b>{done}</b> con la acción enviada ·{" "}
          <button type="button" className="fu-link" onClick={() => router.refresh()}>
            Actualizar
          </button>{" "}
          <button type="button" className="button button-small button-outline" data-testid="followup-add" onClick={() => setAdding(!adding)}>
            <Plus size={14} aria-hidden="true" /> Agregar inmobiliaria
          </button>
        </span>
      </div>
      {adding && <AddAgency stage={stage.key} onDone={() => setAdding(false)} />}
      {stage.queue.length === 0 ? (
        <p className="fu-empty">No hay inmobiliarias en esta etapa.</p>
      ) : (
        <div className="fu-qlist">
          <div className="fu-qrow fu-qhrow" aria-hidden="true">
            <span>Score</span>
            <span>Inmobiliaria</span>
            <span>Dirección · zona</span>
            <span>Web · propiedades</span>
            <span>Estado</span>
            <span>Última acción</span>
            <span>WhatsApp</span>
            <span />
          </div>
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

/** «Agregar inmobiliaria»: created like «Nueva inmobiliaria» (with its duplicate check), straight into this stage. */
function AddAgency({ stage, onDone }: { stage: StageKey; onDone: () => void }) {
  const router = useRouter();
  const [key] = useState(() => crypto.randomUUID());
  const [form, setForm] = useState({ name: "", whatsapp: "", contact: "", score: "", address: "", zone: "", website: "", etapa: stage as string });
  const [duplicates, setDuplicates] = useState<{ name: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const field = (k: keyof typeof form, label: string, props: Record<string, unknown> = {}) => (
    <label>
      <span>{label}</span>
      <input id={`fu-add-${stage}-${k}`} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} {...props} />
    </label>
  );
  async function submit(e: FormEvent | { preventDefault(): void }, confirmDuplicates = false) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/admin/follow-up/inmobiliarias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "agregar", key, ...form, score: form.score === "" ? null : Number(form.score), confirmDuplicates }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.status === 409 && data.duplicates) return setDuplicates(data.duplicates);
      if (!r.ok) throw new Error(data.error || "No pudimos agregarla.");
      onDone();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos agregarla.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="fu-add" data-testid="followup-add-form" onSubmit={(e) => submit(e)}>
      {field("name", "Nombre *", { required: true, maxLength: 120, placeholder: "Inmobiliaria del Puerto" })}
      {field("whatsapp", "WhatsApp", { placeholder: "223 555-0100" })}
      {field("contact", "Decisor", { maxLength: 120, placeholder: "Laura" })}
      {form.etapa === "no-contactado" && field("score", "Score (0 a 100)", { type: "number", min: 0, max: 100 })}
      {field("address", "Dirección", { maxLength: 200 })}
      {field("zone", "Zona", { maxLength: 120 })}
      {field("website", "Web", { placeholder: "inmobiliaria.com.ar" })}
      <label>
        <span>Etapa</span>
        <select id={`fu-add-${stage}-etapa`} value={form.etapa} onChange={(e) => setForm({ ...form, etapa: e.target.value })}>
          {FOLLOWUP_STAGES.map((s) => (
            <option key={s.key} value={s.key}>
              {s.title}
            </option>
          ))}
        </select>
      </label>
      <div className="fu-add-actions">
        {duplicates ? (
          <>
            <p className="fu-warn">Puede que ya exista: {duplicates.map((d) => d.name).join(", ")}.</p>
            <button type="button" className="button button-small button-primary" disabled={busy} onClick={(e) => submit(e, true)}>
              Agregarla igual
            </button>
          </>
        ) : (
          <button type="submit" className="button button-small button-primary" disabled={busy || !form.name.trim()}>
            Agregar
          </button>
        )}
        <button type="button" className="fu-link" onClick={onDone}>
          Cancelar
        </button>
        <span className="fu-note">Queda en esta etapa hasta que su embudo avance.</span>
        {error && (
          <p className="fu-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}

const STAGE_CHOICES = [...FOLLOWUP_STAGES.map((s) => ({ key: s.key as string, title: s.title })), { key: OUT, title: "Sacar de Follow-up" }];

function QueueRow({ stage, item: q, exec, open, onToggle, onDone }: { stage: StageView; item: QueueItem; exec: Exec; open: boolean; onToggle: () => void; onDone: (e: Exec) => void }) {
  const router = useRouter();
  const status = exec?.status ?? "pending";
  const version = stage.versions.find((v) => v.id === q.versionId);
  const testing = stage.versions.some((v) => v.status === "test");
  const [score, setScore] = useState(q.score === null ? "" : String(q.score));
  const [error, setError] = useState("");
  async function save(body: Record<string, unknown>) {
    setError("");
    try {
      await api("/api/admin/follow-up/inmobiliarias", { method: "POST", body: JSON.stringify({ inmobiliaria: q.agencyId, ...body }) });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos guardarlo.");
    }
  }
  const saveScore = () => {
    const next = score.trim() === "" ? null : Number(score);
    if (next === q.score) return;
    void save({ accion: "score", score: next });
  };
  return (
    <div className={`fu-qi${open ? " is-on" : ""}`} data-testid="followup-item" data-agency={q.agencyId} data-status={status} data-version={version?.version ?? ""} data-score={q.score ?? ""}>
      <div className="fu-qrow">
        <div className="fu-qscore">
          {q.scoreEditable ? (
            <input
              type="number"
              min={0}
              max={100}
              value={score}
              placeholder="—"
              aria-label={`Score de ${q.name}`}
              data-testid="followup-score"
              onChange={(e) => setScore(e.target.value)}
              onBlur={saveScore}
              onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
            />
          ) : (
            <b>{q.score === null ? "—" : Math.round(q.score)}</b>
          )}
          <span>{q.scoreEditable ? "score" : "lead score"}</span>
        </div>
        <div className="fu-qname">
          <Link href={`/admin/inmobiliarias/${q.agencyId}`}>{q.name}</Link>
          <span>{q.person ?? "Sin decisor cargado"}</span>
        </div>
        <div>
          <span>{q.address ?? "Sin dirección"}</span>
          <span>{q.zone ?? "Sin zona"}</span>
        </div>
        <div>
          {q.website ? (
            <a href={/^https?:/.test(q.website) ? q.website : `https://${q.website}`} target="_blank" rel="noreferrer" className="fu-web">
              {q.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
            </a>
          ) : (
            <span>Sin web</span>
          )}
          <span>
            {q.properties} {q.properties === 1 ? "propiedad" : "propiedades"}
          </span>
        </div>
        <div>
          <select value={stage.key} aria-label={`Estado de ${q.name}`} data-testid="followup-stage-select" onChange={(e) => void save({ accion: "etapa", etapa: e.target.value })}>
            {STAGE_CHOICES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.title}
              </option>
            ))}
          </select>
          {q.manual && <span className="fu-manual">Corregido a mano</span>}
        </div>
        <div className="fu-qlast" data-testid="followup-last-action">
          <span>{q.lastAction?.text ?? "Sin acciones"}</span>
          <span className={q.lastAction && Date.now() - new Date(q.lastAction.at).getTime() > 5 * 86400000 ? "fu-late" : undefined}>
            {q.lastAction ? `${day(q.lastAction.at)} · ${ago(q.lastAction.at)}` : ""}
          </span>
        </div>
        <div>
          <span className="fu-mono">{q.phone ?? "Sin WhatsApp"}</span>
          <span>
            <span className={`fu-qst is-${status}`}>{EXEC_LABEL[status]}</span>
            {version ? ` V${version.version}${testing ? (version.status === "test" ? " prueba" : " activa") : ""}` : ""}
            {q.needsReview ? " · por revisar" : ""}
          </span>
        </div>
        <button type="button" className={`button button-small${status === "pending" && !open ? " button-primary" : " button-outline"}`} data-testid="followup-execute" onClick={onToggle} disabled={!version}>
          {open ? "Cerrar" : status === "sent" ? "Ver" : version?.channel === "task" ? "Hacer tarea" : "Ejecutar"}
        </button>
      </div>
      {error && (
        <p className="fu-error fu-row-error" role="alert">
          {error}
        </p>
      )}
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
        {prepared.notes && (
          <div className="fu-obs-read" data-testid="followup-notes">
            <span>Observaciones de V{prepared.version}</span>
            {prepared.notes}
          </div>
        )}
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

/** Follow-up → Script: the guide the extension reads before working. */
export function ScriptEditor({ body, updatedAt }: { body: string; updatedAt: string | null }) {
  const [text, setText] = useState(body);
  const [saved, setSaved] = useState(updatedAt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ body: string; updated_at: string }>("/api/admin/follow-up/script", { method: "PUT", body: JSON.stringify({ body: text }) });
      setSaved(r.updated_at);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos guardarlo.");
    } finally {
      setBusy(false);
    }
  }
  const when = saved ? new Date(saved).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : null;
  return (
    <section className="fu-stage fu-script">
      <div className="fu-editor">
        <div className="fu-qhead">
          <span className="fu-lbl">Script de la extensión</span>
          <span className="fu-note">{when ? `Guardado el ${when}` : "Todavía sin guardar"}</span>
        </div>
        <textarea
          id="fu-script"
          data-testid="followup-script"
          value={text}
          maxLength={20000}
          placeholder="Cómo trabajar Follow-up: qué revisar en el chat antes de mandar, cuándo corregir el estado, qué hacer si algo no coincide, el tono…"
          onChange={(e) => setText(e.target.value)}
        />
        <div className="fu-actions">
          <button type="button" className="button button-primary button-small" data-testid="followup-script-save" disabled={busy || text === body && saved === updatedAt} onClick={save}>
            Guardar
          </button>
          <span className="fu-note">Un solo texto para todas las etapas. Las indicaciones de un mensaje puntual van en sus observaciones.</span>
        </div>
        {error && (
          <p className="fu-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
