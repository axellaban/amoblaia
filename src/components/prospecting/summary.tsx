"use client";

import { useMemo } from "react";
import { percent, summarize, type Filters, type Ratio } from "@/lib/prospecting/metrics";
import type { Dataset } from "@/lib/prospecting/types";
import type { Tab } from "./app";
import { FilterBar, Pill, filterLabel } from "./shared";

const fmt = (r: Ratio) => `${percent(r)} (${r.num}/${r.den})`;

/** Account-level funnel of a first-send cohort and what needs action today. */
export function SummaryView({ ds, filters, onFilters, goTo }: { ds: Dataset; filters: Filters; onFilters: (f: Filters) => void; goTo: (t: Tab) => void }) {
  const s = useMemo(() => summarize(ds, filters), [ds, filters]);
  const empty = !ds.accounts.length;
  const funnel: [string, number | null, string][] = [
    ["Enviados", s.sent, "cuentas con envío confirmado"],
    ["Respondieron", s.replied.observed, "respuesta humana registrada"],
    ["Interesados", s.interested.observed, "interés explícito con evidencia"],
    ["Activados", s.linked ? s.activated.observed : null, "primera ambientación propia elegida"],
    ["Clientes", s.linked ? s.customers.observed : null, "primera compra aprobada"],
  ];
  const max = Math.max(1, s.sent);
  return (
    <div>
      <FilterBar ds={ds} filters={filters} onChange={onFilters} idPrefix="summary" />
      <p className="pr-chips">
        <Pill>{filterLabel(filters)}</Pill>
        <Pill>Ventana de cuenta · {s.window} días</Pill>
        <Pill tone="blue">
          Actividad reciente: <b data-testid="recent-sends">{s.recentSends}</b> envíos en {ds.settings.message_window_days} días · en observación
        </Pill>
      </p>
      {empty && (
        <div className="pr-panel pr-empty" data-testid="summary-empty">
          <h2>La base está vacía</h2>
          <p>Importá la planilla o agregá inmobiliarias desde Prospectos. Las cifras aparecen a medida que se confirman envíos y se registran respuestas.</p>
          <button type="button" className="button button-small" onClick={() => goTo("prospectos")}>
            Ir a Prospectos
          </button>
        </div>
      )}
      <div className="pr-cards">
        <article className="pr-card" data-testid="card-prospected">
          <h3>Prospectados</h3>
          <strong>{s.prospected}</strong>
          <small>Cuentas en la base actual{filters.sdr || filters.campaign || filters.zone ? " (con SDR/campaña/zona elegidos)" : ""}; no depende de la cohorte</small>
        </article>
        <article className="pr-card" data-testid="card-sent">
          <h3>Enviados confirmados</h3>
          <strong>{s.sent}</strong>
          <small>
            Cuentas únicas de la cohorte · {s.messages} mensajes confirmados · {s.observing} en observación
          </small>
        </article>
        <article className="pr-card" data-testid="card-replied">
          <h3>Respondieron</h3>
          <strong>{s.replied.observed}</strong>
          <small>
            {fmt(s.replied.mature)} de cuentas con ventana completa
            {s.replied.late ? ` · ${s.replied.late} tardías fuera de ventana` : ""}
          </small>
        </article>
        <article className="pr-card" data-testid="card-interested">
          <h3>Interesados</h3>
          <strong>{s.interested.observed}</strong>
          <small>
            {fmt(s.interested.mature)} de enviadas maduras · {fmt(s.interestOfReplies)} de respuestas
          </small>
        </article>
      </div>
      <div className="pr-grid">
        <section className="pr-panel" aria-labelledby="pr-funnel">
          <div className="pr-top">
            <h2 id="pr-funnel">Cómo avanza la cohorte</h2>
            <Pill>Cuentas únicas</Pill>
          </div>
          <ol className="pr-funnel">
            {funnel.map(([label, value, help]) => (
              <li key={label}>
                <span>
                  {label}
                  <small>{help}</small>
                </span>
                <span className="pr-bar" aria-hidden="true">
                  <i style={{ width: `${value == null ? 0 : (value / max) * 100}%` }} />
                </span>
                <strong>{value == null ? "Sin vincular" : value}</strong>
              </li>
            ))}
          </ol>
          <p className="pr-foot">
            Cuentas con al menos un envío confirmado cuyo primer envío cae en el filtro. Una cuenta no se duplica por usar WhatsApp y email. Las aperturas de demo son
            señales, no respuestas. Tasas solo con cuentas de ventana completa ({s.window} días; {s.matureSent} de {s.sent}). Activación y compra se miden solo en
            inmobiliarias con cuenta vinculada y verificada ({s.linked} de {s.sent}); las demás figuran como «Sin vincular», no como cero.
          </p>
        </section>
        <section className="pr-panel" aria-labelledby="pr-focus">
          <span className="pr-label">Dónde poner el foco</span>
          <h2 id="pr-focus">Lo que requiere acción</h2>
          <ul className="pr-todo">
            <li>
              <Pill tone="amber">{s.todo.overdue} vencidos</Pill>
              <strong>Seguimientos comprometidos</strong>
              <p>Revisar la última conversación antes de preparar el siguiente toque.</p>
            </li>
            <li>
              <Pill tone="blue">{s.todo.unanswered} respuestas</Pill>
              <strong>Falta responder al interesado</strong>
              <p>Resolver conversaciones abiertas antes de nuevos envíos.</p>
            </li>
            <li>
              <Pill tone={s.todo.uncertain ? "red" : undefined}>{s.todo.uncertain} inciertos</Pill>
              <strong>Envíos por conciliar</strong>
              <p>Pudieron haberse enviado: revisar el canal antes de reintentar. {s.todo.live} intentos preparados o abiertos.</p>
            </li>
            <li>
              <strong>Calidad de datos</strong>
              <p>
                {s.quality.withoutUsableContact} cuentas sin contacto usable · {s.quality.contactsToReview} contactos por revisar · {s.quality.invalidContacts} inválidos ·{" "}
                {s.quality.withoutDecisionMaker} sin decisor · {s.quality.withoutScore} sin score · {s.quality.legacyUnknownChannel} con envío histórico de canal desconocido
              </p>
            </li>
            {s.lossReasons.length > 0 && (
              <li>
                <strong>Motivos de pérdida</strong>
                <p>{s.lossReasons.map(([r, n]) => `${r}: ${n}`).join(" · ")}</p>
              </li>
            )}
          </ul>
          <button type="button" className="button button-small button-outline" onClick={() => goTo("prospectos")}>
            Ir a la base de trabajo →
          </button>
        </section>
      </div>
    </div>
  );
}
