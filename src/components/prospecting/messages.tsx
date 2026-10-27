"use client";

import { useMemo, useState } from "react";
import { messageReport, percent, type Filters } from "@/lib/prospecting/metrics";
import { PLACEHOLDERS } from "@/lib/prospecting/render";
import { formatWhen } from "@/lib/prospecting/time";
import { CHANNEL_LABEL, STEP_LABEL, type Dataset, type OutreachTemplate } from "@/lib/prospecting/types";
import { ErrorNote, FilterBar, Pill, api, filterLabel } from "./shared";

/** Which message opens conversations: by campaign, step, channel and version, with visible denominators. */
export function MessagesView({ ds, filters, onFilters, onChanged }: { ds: Dataset; filters: Filters; onFilters: (f: Filters) => void; onChanged: () => Promise<void> }) {
  const [step, setStep] = useState("");
  const m = useMemo(() => messageReport(ds, filters), [ds, filters]);
  const rows = m.rows.filter((r) => step === "" || String(r.step) === step);
  const ratio = (num: number, den: number) => percent({ num, den, rate: den ? num / den : null });
  const total = m.coverage.template + m.coverage.custom + m.coverage.unknown;
  return (
    <div>
      <div className="pr-top">
        <div>
          <h2>Qué mensaje abre conversaciones</h2>
          <p className="pr-caption">Comparar variantes dentro del mismo canal, paso y campaña; no confundir volumen con efectividad.</p>
        </div>
        <Pill>Ventana de mensajes · {m.window} días · muestra pequeña si n&lt;{m.smallSample}</Pill>
      </div>
      <FilterBar ds={ds} filters={filters} onChange={onFilters} idPrefix="messages" />
      <div className="pr-filters">
        <label>
          <span>Paso de secuencia</span>
          <select value={step} onChange={(e) => setStep(e.target.value)} data-testid="messages-step">
            <option value="">Todos los pasos</option>
            {[1, 2, 3, 0].map((s) => (
              <option key={s} value={s}>
                {STEP_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="pr-chips">
        <Pill>{filterLabel(filters)} (fecha de cada envío)</Pill>
        <Pill>{m.confirmed} envíos confirmados</Pill>
        <Pill tone={m.coverage.unknown ? "amber" : undefined}>
          Cobertura de variante: {total ? Math.round((m.coverage.template / total) * 100) : 0}% plantilla · {m.coverage.custom} personalizados · {m.coverage.unknown} sin atribuir (legado)
        </Pill>
      </p>
      <section className="pr-panel" aria-labelledby="pr-msg-table">
        <h3 id="pr-msg-table" className="sr-only">
          Resultados por versión
        </h3>
        <div className="pr-tablewrap">
          <table className="pr-table" data-testid="messages-table">
            <thead>
              <tr>
                <th scope="col">Versión / Tipo</th>
                <th scope="col">Campaña</th>
                <th scope="col">Canal</th>
                <th scope="col">Paso</th>
                <th scope="col">Confirmados</th>
                <th scope="col">Base madura (n)</th>
                <th scope="col">Respuestas atribuidas</th>
                <th scope="col">Interés tras el toque</th>
                <th scope="col">Lectura</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td>
                    <strong>{r.label}</strong>
                    <small>{r.variant === "template" ? "Texto congelado por envío" : r.variant === "custom" ? "Texto propio: fuera de comparaciones A/B" : "Histórico sin variante ni canal: fuera de rankings"}</small>
                  </td>
                  <td>{r.campaign}</td>
                  <td>{CHANNEL_LABEL[r.channel]}</td>
                  <td>{STEP_LABEL[r.step]}</td>
                  <td>
                    {r.confirmed}
                    <small>
                      {r.observing} en observación{r.bounced ? ` · ${r.bounced} rebotes (no cuentan)` : ""}
                    </small>
                  </td>
                  <td>{r.base}</td>
                  <td>
                    <strong>{ratio(r.replies, r.base)}</strong>
                    <small>
                      {r.replies} / {r.base}
                      {r.assists ? ` · ${r.assists} asistencias` : ""}
                      {r.lateReplies ? ` · ${r.lateReplies} tardías` : ""}
                    </small>
                  </td>
                  <td>
                    {ratio(r.interests, r.base)}
                    <small>
                      {r.interests} / {r.base} · asociación, no causa
                    </small>
                  </td>
                  <td>
                    {r.step === 0 ? (
                      <Pill>Conversación</Pill>
                    ) : r.variant !== "template" ? (
                      <Pill>No comparable</Pill>
                    ) : r.small ? (
                      <Pill tone="amber">Muestra pequeña</Pill>
                    ) : (
                      <Pill>Descriptivo</Pill>
                    )}
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={9} className="pr-zero">
                    Sin envíos confirmados para estos filtros. Los resultados aparecen cuando se confirman envíos desde la Bandeja de ejecución.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="pr-foot">
          Base = envíos confirmados de esa versión con la ventana de {m.window} días completa y sin una respuesta previa que ya hubiera detenido la secuencia. Una respuesta se
          atribuye al último envío confirmado anterior dentro de la ventana (máximo un envío por respuesta); los toques previos figuran como asistencias. Sin atribuir:{" "}
          {m.unattributed.ambiguous} por cronología ambigua, {m.unattributed.late} tardías y {m.unattributed.noSend} sin envío previo (se conservan a nivel cuenta). El
          seguimiento se dirige a quienes no respondieron: su tasa no se compara con la del primer mensaje. No hay ganadora automática ni prueba de significancia.
        </p>
      </section>

      <div className="pr-grid pr-gap">
        <section className="pr-panel" aria-labelledby="pr-by-channel">
          <h3 id="pr-by-channel">Por canal</h3>
          <div className="pr-tablewrap">
            <table className="pr-table">
              <thead>
                <tr>
                  <th scope="col">Canal</th>
                  <th scope="col">Cuentas expuestas</th>
                  <th scope="col">Canal inicial</th>
                  <th scope="col">Respondieron (último toque)</th>
                  <th scope="col">Asistió a otro canal</th>
                </tr>
              </thead>
              <tbody>
                {m.channels.map((c) => (
                  <tr key={c.channel}>
                    <td>{CHANNEL_LABEL[c.channel]}</td>
                    <td>{c.exposed}</td>
                    <td>{c.initial}</td>
                    <td>
                      {c.replies.num} de {c.replies.den}
                      <small>conteo, sin tasa: incluye cuentas en observación</small>
                    </td>
                    <td>{c.assisted}</td>
                  </tr>
                ))}
                <tr>
                  <th scope="row">Total único</th>
                  <td>{m.global.exposed}</td>
                  <td>—</td>
                  <td>
                    {m.global.replied}
                    <small>cuentas, sin duplicar</small>
                  </td>
                  <td>—</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="pr-foot">Una cuenta con WhatsApp y email figura expuesta en ambos: las bases se superponen y no se suman. Incluye recientes en observación.</p>
          <h3>Secuencia completa</h3>
          <ul className="pr-list">
            {m.sequences.map((s) => (
              <li key={s.campaign}>
                <strong>{s.campaign}</strong>: {s.started} cuentas con ventana completa · llegaron a primer mensaje {s.reached[0]}, seguimiento 1 {s.reached[1]}, seguimiento 2{" "}
                {s.reached[2]} · respondieron a algún paso {s.replied} ({ratio(s.replied, s.started)}){s.observing ? ` · ${s.observing} en observación` : ""}
              </li>
            ))}
            {!m.sequences.length && <li>Sin secuencias iniciadas con estos filtros.</li>}
          </ul>
        </section>
        <TemplateLibrary templates={ds.templates} onChanged={onChanged} />
      </div>
    </div>
  );
}

function TemplateLibrary({ templates, onChanged }: { templates: OutreachTemplate[]; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState<OutreachTemplate | "new" | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section className="pr-panel" aria-labelledby="pr-templates">
      <div className="pr-top">
        <h3 id="pr-templates">Biblioteca de versiones</h3>
        <button type="button" className="pr-link" onClick={() => setEditing("new")} data-testid="new-template">
          Nueva plantilla
        </button>
      </div>
      <p className="pr-key">Cada versión es inmutable: editar crea la siguiente. Los envíos guardan su texto exacto. Variables: {Object.keys(PLACEHOLDERS).map((k) => `{{${k}}}`).join(" ")}.</p>
      {editing && <TemplateForm template={editing === "new" ? null : editing} onDone={async () => (setEditing(null), await onChanged())} onCancel={() => setEditing(null)} />}
      <ul className="pr-todo">
        {templates.map((t) => {
          const latest = t.versions[0];
          return (
            <li key={t.id}>
              <strong>
                {t.name} · v{latest?.version}
              </strong>
              <small>
                {CHANNEL_LABEL[t.channel]} · {STEP_LABEL[t.step]} · {t.versions.length} {t.versions.length === 1 ? "versión" : "versiones"}
              </small>
              {t.purpose && <small>{t.purpose}</small>}
              <span className="pr-actions">
                <button type="button" className="pr-link" onClick={() => setOpen(open === t.id ? null : t.id)} aria-expanded={open === t.id}>
                  Ver textos
                </button>
                <button type="button" className="pr-link" onClick={() => setEditing(t)}>
                  Nueva versión
                </button>
              </span>
              {open === t.id && (
                <ol className="pr-versions">
                  {t.versions.map((v) => (
                    <li key={v.id}>
                      <strong>v{v.version}</strong> <small>{formatWhen(v.created_at)}</small>
                      {v.subject && <small>Asunto: {v.subject}</small>}
                      <p className="pr-notes">{v.body}</p>
                    </li>
                  ))}
                </ol>
              )}
            </li>
          );
        })}
        {!templates.length && <li>Todavía no hay plantillas. Sin plantilla, cada mensaje se registra como personalizado y no entra en comparaciones de variantes.</li>}
      </ul>
    </section>
  );
}

function TemplateForm({ template, onDone, onCancel }: { template: OutreachTemplate | null; onDone: () => Promise<void>; onCancel: () => void }) {
  const latest = template?.versions[0];
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [channel, setChannel] = useState<"whatsapp" | "email">(template?.channel ?? "whatsapp");
  const [step, setStep] = useState(template?.step ?? 1);
  const [subject, setSubject] = useState(latest?.subject ?? "");
  const [body, setBody] = useState(latest?.body ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/admin/prospeccion/plantillas", {
        method: "POST",
        body: JSON.stringify(template ? { templateId: template.id, subject, body } : { name, purpose, channel, step, subject, body }),
      });
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos guardarla.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="pr-subform" onSubmit={submit} data-testid="template-form">
      {template ? (
        <p className="pr-key">
          Nueva versión de «{template.name}» ({CHANNEL_LABEL[template.channel]} · {STEP_LABEL[template.step]}). La v{latest?.version} queda congelada.
        </p>
      ) : (
        <div className="pr-form-row">
          <label>
            <span>Nombre</span>
            <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} required placeholder="Corto" />
          </label>
          <label>
            <span>Canal</span>
            <select value={channel} onChange={(e) => setChannel(e.target.value as "whatsapp" | "email")}>
              <option value="whatsapp">WhatsApp</option>
              <option value="email">Email</option>
            </select>
          </label>
          <label>
            <span>Paso</span>
            <select value={step} onChange={(e) => setStep(Number(e.target.value))}>
              {[1, 2, 3, 0].map((s) => (
                <option key={s} value={s}>
                  {STEP_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Propósito</span>
            <input value={purpose} maxLength={300} onChange={(e) => setPurpose(e.target.value)} />
          </label>
        </div>
      )}
      {(template?.channel ?? channel) === "email" && (
        <label>
          <span>Asunto</span>
          <input value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} required />
        </label>
      )}
      <label>
        <span>Texto</span>
        <textarea value={body} maxLength={4000} rows={5} onChange={(e) => setBody(e.target.value)} required />
      </label>
      <ErrorNote error={error} />
      <div className="pr-actions">
        <button type="submit" className="button button-small" disabled={busy || (!!latest && latest.body === body && (latest.subject ?? "") === subject)}>
          {template ? "Guardar como nueva versión" : "Crear plantilla"}
        </button>
        <button type="button" className="button button-small button-outline" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
