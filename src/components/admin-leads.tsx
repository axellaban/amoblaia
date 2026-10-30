"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/components/admin-demos";
import { LeadBadge } from "@/components/lead-score";
import { WEIGHTS } from "@/lib/leads/config";
import { classLabel, type VisitorFacts } from "@/lib/leads/score";
import type { AgencyDetail, LeadOverview } from "@/lib/leads/server";
import { formatWhen } from "@/lib/prospecting/time";

/**
 * Leads / Engagement: which agencies to contact first. The overview reads
 * only the stored scores (one request); an agency's visitors and events load
 * when it is opened. Every number here comes from lead_score_v1 rules.
 */

type Filter = "all" | "very_hot" | "hot" | "warm" | "cold" | "none";
type Sort = "score" | "recent" | "commercial";
const FILTERS: [Filter, string][] = [
  ["all", "Todas"],
  ["very_hot", "Muy calientes"],
  ["hot", "Calientes"],
  ["warm", "Tibias"],
  ["cold", "Frías"],
  ["none", "Sin actividad externa"],
];
const EVENT_LABELS: Record<string, string> = {
  demo_opened: "Abrió la demo",
  demo_style_selected: "Eligió un estilo",
  demo_photo_selected: "Cambió de foto",
  demo_comparison_used: "Usó el slider",
  demo_agency_cta_clicked: "CTA para inmobiliarias",
  demo_pricing_viewed: "Vio los precios",
  demo_signup_started: "Empezó el registro",
  demo_contact_requested: "Solicitó contacto",
  demo_generation_started: "Pidió una generación",
  demo_generation_completed: "Generación lista",
  demo_property_import_started: "Inició una importación",
  demo_property_import_completed: "Completó una importación",
  demo_account_created: "Creó su cuenta",
};
const IDENTITY: Record<string, string> = {
  identified: "Identificado: cuenta de la inmobiliaria",
  linked: "Vinculado al enlace enviado, sin identidad verificada",
  anonymous: "Anónimo",
};
const PARTIAL_NOTE = "Score histórico parcial: los eventos anteriores a esta medición no permiten distinguir todas las acciones (por ejemplo, qué estilos se eligieron).";

const short = (v: string) => (v.startsWith("ph:") ? `PostHog ${v.slice(3, 11)}` : v.slice(0, 8));
const seconds = (ms: number) => (ms < 90000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60000)} min`);
const matches = (f: Filter, cls: string | null) =>
  f === "all" || (f === "none" ? cls === null : f === "cold" ? cls === "cold" || cls === "very_cold" : cls === f);

type Agency = LeadOverview["agencies"][number];
type Visitor = AgencyDetail["visitors"][number] & {
  visual_score?: number;
  depth_score?: number;
  recurrence_score?: number;
  score_breakdown?: { facts?: VisitorFacts };
  internal_reasons?: string[];
  aliases?: string[];
};

export function LeadsApp() {
  const [data, setData] = useState<LeadOverview | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("score");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await api<LeadOverview>("/api/admin/leads"));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos cargar los leads.");
    }
  }, []);
  useEffect(() => {
    void load();
    const id = new URLSearchParams(window.location.search).get("inmobiliaria");
    if (id) setOpen(id);
  }, [load]);
  const choose = (id: string | null) => {
    setOpen(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("inmobiliaria", id);
    else url.searchParams.delete("inmobiliaria");
    window.history.replaceState(null, "", url);
  };

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (data?.agencies ?? []).filter((a) => matches(filter, a.classification) && (!q || a.name.toLowerCase().includes(q)));
    const time = (a: Agency) => (a.last_activity_at ? Date.parse(a.last_activity_at) : 0);
    return list.sort((a, b) =>
      sort === "recent"
        ? time(b) - time(a) || (b.score ?? -1) - (a.score ?? -1)
        : sort === "commercial"
          ? b.commercial_signals.length - a.commercial_signals.length || (b.score ?? -1) - (a.score ?? -1)
          : (b.score ?? -1) - (a.score ?? -1) || time(b) - time(a) || a.name.localeCompare(b.name),
    );
  }, [data, filter, sort, query]);

  const stats = useMemo(() => {
    const ag = data?.agencies ?? [];
    return {
      active: ag.filter((a) => a.score !== null).length,
      hot: ag.filter((a) => (a.score ?? 0) >= 60).length,
      commercial: ag.filter((a) => a.has_commercial_signal).length,
      partial: (data?.demos ?? []).filter((d) => d.score_data_quality === "partial").length,
    };
  }, [data]);

  async function recalc() {
    setBusy("recalc");
    try {
      await api("/api/admin/leads/recalcular", { method: "POST" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos recalcular.");
    } finally {
      setBusy("");
    }
  }

  return (
    <main className="pr-main ld-main">
      <div className="pr-top">
        <div>
          <span className="pr-label">Leads / Engagement · lead_score_v1</span>
          <h1>A quién llamar primero.</h1>
          <p className="pr-muted">
            Score de 0 a 100 por la interacción observada en las demos. Mide engagement e intención visible, no la probabilidad de contratar.
          </p>
        </div>
        <div className="pr-sync" role="status" aria-live="polite">
          {data ? <span>Actualizado {formatWhen(data.calculated_at)} (hora Argentina)</span> : <span>Cargando…</span>}
          <span>
            <button type="button" className="pr-link" onClick={() => void load()}>
              Actualizar
            </button>{" "}
            ·{" "}
            <button type="button" className="pr-link" onClick={() => void recalc()} disabled={busy === "recalc"}>
              {busy === "recalc" ? "Recalculando…" : "Recalcular todo"}
            </button>
          </span>
        </div>
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}

      <div className="pr-cards">
        <article className="pr-card">
          <h3>Con actividad externa</h3>
          <strong>{data ? stats.active : "…"}</strong>
          <small>Inmobiliarias con al menos un visitante que no es del equipo</small>
        </article>
        <article className="pr-card">
          <h3>Calientes o más</h3>
          <strong>{data ? stats.hot : "…"}</strong>
          <small>Score de 60 o más</small>
        </article>
        <article className="pr-card">
          <h3>Con señales comerciales</h3>
          <strong>{data ? stats.commercial : "…"}</strong>
          <small>CTA, precios, registro o contacto de un visitante externo</small>
        </article>
        <article className="pr-card">
          <h3>Visitantes internos marcados</h3>
          <strong>{data ? data.internal_visitors : "…"}</strong>
          <small>Marcados a mano; el equipo con sesión iniciada se excluye solo</small>
        </article>
      </div>

      <div className="ld-toolbar">
        <div className="ld-filters" role="radiogroup" aria-label="Filtrar por estado">
          {FILTERS.map(([id, label]) => (
            <button key={id} type="button" role="radio" aria-checked={filter === id} onClick={() => setFilter(id)}>
              {label}
            </button>
          ))}
        </div>
        <div className="ld-controls">
          <input type="search" placeholder="Buscar inmobiliaria" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar inmobiliaria" />
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Ordenar">
            <option value="score">Mayor score</option>
            <option value="recent">Actividad reciente</option>
            <option value="commercial">Señales comerciales</option>
          </select>
        </div>
      </div>

      <div className="pr-panel ld-panel">
        <div className="pr-tablewrap">
          <table className="pr-table ld-table">
            <caption className="sr-only">Inmobiliarias ordenadas por lead score</caption>
            <thead>
              <tr>
                <th scope="col">Inmobiliaria</th>
                <th scope="col">Score</th>
                <th scope="col">Demos</th>
                <th scope="col">Visitantes externos</th>
                <th scope="col">Última actividad</th>
                <th scope="col">Señal principal</th>
              </tr>
            </thead>
            <tbody>
              {!data && (
                <tr>
                  <td colSpan={6} className="pr-zero">
                    Cargando…
                  </td>
                </tr>
              )}
              {data && !rows.length && (
                <tr>
                  <td colSpan={6} className="pr-zero">
                    Ninguna inmobiliaria con ese filtro.
                  </td>
                </tr>
              )}
              {rows.map((a) => (
                <tr key={a.agency_id} className={open === a.agency_id ? "is-open" : undefined}>
                  <td>
                    <button type="button" className="ld-name" onClick={() => choose(open === a.agency_id ? null : a.agency_id)} aria-expanded={open === a.agency_id}>
                      {a.name}
                    </button>
                    {a.has_account && <small>Ya tiene cuenta en habita</small>}
                    {a.public_exposure && <small>Compartida con compradores: no todo es la inmobiliaria</small>}
                    {a.shared_visitors > 0 && <small className="ld-internal">Visitantes que también abrieron otras inmobiliarias: revisar si son del equipo</small>}
                  </td>
                  <td>
                    <LeadBadge score={a.score} classification={a.classification} partial={a.score_data_quality === "partial"} />
                  </td>
                  <td>
                    {a.demos_visited}/{a.demos}
                    <small>visitadas</small>
                  </td>
                  <td>
                    {a.external_visitors}
                    {a.internal_visitors > 0 && <small>+{a.internal_visitors} internos</small>}
                  </td>
                  <td>{a.last_activity_at ? formatWhen(a.last_activity_at) : "—"}</td>
                  <td>
                    {a.main_signal ?? "—"}
                    {a.has_commercial_signal && <small className="ld-commercial">Señal comercial</small>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {stats.partial > 0 && <p className="pr-caption">* {PARTIAL_NOTE}</p>}
      </div>

      {open && <AgencyView key={open} id={open} onClose={() => choose(null)} onChanged={load} />}
    </main>
  );
}

function Dimensions({ v }: { v: Visitor }) {
  const parts: [string, number, number][] = [
    ["Interacción visual", v.visual_score ?? 0, WEIGHTS.visual.max],
    ["Profundidad", v.depth_score ?? 0, WEIGHTS.depth.max],
    ["Interés comercial", v.commercial_score, WEIGHTS.commercial.max],
    ["Activación", v.activation_score, WEIGHTS.activation.max],
    ["Recurrencia", v.recurrence_score ?? 0, WEIGHTS.recurrence.max],
  ];
  return (
    <ul className="ld-dims">
      {parts.map(([label, value, max]) => (
        <li key={label}>
          <span>{label}</span>
          <span className="ld-bar" aria-hidden="true">
            <i style={{ width: `${(value / max) * 100}%` }} />
          </span>
          <b>
            {value}/{max}
          </b>
        </li>
      ))}
    </ul>
  );
}

function AgencyView({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => Promise<void> }) {
  const [d, setD] = useState<AgencyDetail | null>(null);
  const [error, setError] = useState("");
  const [demo, setDemo] = useState("all");
  const [withInternal, setWithInternal] = useState(false);
  const [busy, setBusy] = useState("");
  const load = useCallback(async () => {
    try {
      setD(await api<AgencyDetail>(`/api/admin/leads/${id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos cargar la inmobiliaria.");
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  async function mark(visitor: string, internal: boolean) {
    const note = internal ? window.prompt("¿Por qué es interno? (opcional, p. ej. «mi celular»)") : null;
    if (internal && note === null) return;
    setBusy(visitor);
    try {
      await api("/api/admin/leads/visitantes", { method: "POST", body: JSON.stringify({ visitor, internal, note }) });
      await Promise.all([load(), onChanged()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos guardar.");
    } finally {
      setBusy("");
    }
  }

  if (!d)
    return (
      <section className="pr-panel ld-detail" aria-busy="true">
        {error ? <p className="inline-error">{error}</p> : <p className="pr-muted">Cargando la inmobiliaria…</p>}
      </section>
    );

  const title = new Map(d.demos.map((x) => [x.demo_id, x.title]));
  const visitors = (d.visitors as Visitor[]).filter((v) => (withInternal || !v.is_internal) && (demo === "all" || v.demo_id === demo));
  const top = (d.visitors as Visitor[]).find((v) => !v.is_internal && v.demo_id === d.rollup.top_demo_id && v.score === d.rollup.score);
  const internalIds = new Set(d.visitors.filter((v) => v.is_internal).map((v) => v.visitor_id));
  const manual = new Map(d.internal.map((m) => [m.visitor_id, m]));
  const events = d.events.filter((e) => (withInternal || (!e.is_internal && !internalIds.has(e.visitor_id))) && (demo === "all" || e.demo_id === demo)).slice(0, 120);

  return (
    <section className="pr-panel ld-detail" aria-labelledby="ld-detail-title">
      <div className="pr-top">
        <div>
          <span className="pr-label">Detalle de inmobiliaria</span>
          <h2 id="ld-detail-title">{d.agency.name}</h2>
        </div>
        <button type="button" className="pr-link" onClick={onClose}>
          Cerrar
        </button>
      </div>

      <div className="ld-summary">
        <div className="ld-big">
          <LeadBadge score={d.rollup.score} classification={d.rollup.classification} partial={d.rollup.score_data_quality === "partial"} />
          <small>
            {d.rollup.last_activity_at ? `Última actividad ${formatWhen(d.rollup.last_activity_at)}` : "Sin actividad externa"} · {d.rollup.external_visitors}{" "}
            {d.rollup.external_visitors === 1 ? "visitante externo" : "visitantes externos"} · {d.rollup.demos_visited}/{d.rollup.demos} demos visitadas
          </small>
        </div>
        <div>
          {d.rollup.explanation ? <p className="ld-explain">{d.rollup.explanation}</p> : <p className="pr-muted">Todavía no hay visitas externas en sus demos.</p>}
          {d.rollup.top_demo_id && <p className="pr-caption">Origen del score: «{title.get(d.rollup.top_demo_id)}».</p>}
          <p className="pr-chips">
            {d.rollup.attribution_confidence && <span className="pr-pill is-blue">{IDENTITY[d.rollup.attribution_confidence]}</span>}
            {d.rollup.commercial_signals.map((s) => (
              <span key={s} className="pr-pill is-green">
                {s}
              </span>
            ))}
          </p>
          <p className="pr-caption ld-warning">
            {d.rollup.attribution_confidence === "identified"
              ? "La actividad incluye una cuenta de la inmobiliaria."
              : "Tener el enlace no prueba que lo abrió el dueño de la inmobiliaria: el score refleja el engagement de la demo, no necesariamente su intención de compra."}
            {d.rollup.public_exposure && " Algunas visitas llegaron por un enlace de compradores o su sitio."}
            {d.rollup.shared_visitors > 0 &&
              ` ${d.rollup.shared_visitors} ${d.rollup.shared_visitors === 1 ? "visitante abrió" : "visitantes abrieron"} también demos de otras inmobiliarias: si es del equipo, marcalo como interno.`}
          </p>
          {d.rollup.score_data_quality === "partial" && <p className="pr-caption">* {PARTIAL_NOTE}</p>}
        </div>
        {top && <Dimensions v={top} />}
      </div>

      <h3>Demos</h3>
      <div className="ld-demos" role="radiogroup" aria-label="Demo">
        <button type="button" role="radio" aria-checked={demo === "all"} onClick={() => setDemo("all")}>
          Todas
        </button>
        {d.demos.map((x) => (
          <button key={x.demo_id} type="button" role="radio" aria-checked={demo === x.demo_id} onClick={() => setDemo(x.demo_id)}>
            <span>{x.title}</span>
            <LeadBadge score={x.score} classification={x.classification} compact partial={x.score_data_quality === "partial"} />
            <small>
              {x.external_visitors} ext.{x.internal_visitors ? ` · ${x.internal_visitors} int.` : ""}
              {x.commercial_visitors ? ` · ${x.commercial_visitors} con señal comercial` : ""}
            </small>
          </button>
        ))}
      </div>

      <div className="ld-visitors-head">
        <h3>Visitantes</h3>
        <label className="pr-check">
          <input type="checkbox" checked={withInternal} onChange={(e) => setWithInternal(e.target.checked)} /> Incluir internos (diagnóstico)
        </label>
      </div>
      <div className="pr-tablewrap">
        <table className="pr-table ld-table">
          <thead>
            <tr>
              <th scope="col">Visitante</th>
              <th scope="col">Score</th>
              <th scope="col">Qué hizo</th>
              <th scope="col">Visual · Prof. · Com. · Act. · Rec.</th>
              <th scope="col">Última visita</th>
              <th scope="col">
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {!visitors.length && (
              <tr>
                <td colSpan={6} className="pr-zero">
                  Sin visitantes {withInternal ? "" : "externos "}en esta selección.
                </td>
              </tr>
            )}
            {visitors.map((v) => {
              const f = v.score_breakdown?.facts;
              const m = manual.get(v.visitor_id);
              return (
                <tr key={`${v.demo_id}:${v.visitor_id}`} className={v.is_internal ? "is-internal" : undefined}>
                  <td>
                    <code>{short(v.visitor_id)}</code>
                    <small>
                      {demo === "all" ? `${title.get(v.demo_id)} · ` : ""}
                      {IDENTITY[v.attribution_confidence]}
                    </small>
                    {v.is_internal && <small className="ld-internal">Interno: {(v.internal_reasons ?? []).join(", ") || "equipo"}{m ? ` · marcado ${formatWhen(m.marked_at)}${m.note ? ` (${m.note})` : ""}` : ""}</small>}
                    {v.shared && !v.is_internal && <small className="ld-internal">También abrió demos de otras inmobiliarias</small>}
                  </td>
                  <td>
                    <LeadBadge score={v.score} classification={v.classification} compact partial={v.score_data_quality === "partial"} />
                    <small>{classLabel(v.classification)}</small>
                  </td>
                  <td>
                    {f ? (
                      <ul className="ld-facts">
                        <li>{seconds(f.activeMs)} activo</li>
                        <li>
                          {f.styles.length} {f.styles.length === 1 ? "estilo" : "estilos"} · {f.photos.length} {f.photos.length === 1 ? "foto" : "fotos"}
                          {f.comparison ? " · slider" : ""}
                        </li>
                        {(f.commercial.agencyCta || f.commercial.pricing || f.commercial.signup || f.commercial.contact) && (
                          <li>
                            {[f.commercial.agencyCta && "CTA", f.commercial.pricing && "precios", f.commercial.signup && "registro", f.commercial.contact && "contacto"].filter(Boolean).join(" · ")}
                          </li>
                        )}
                        {f.activation.generationsCompleted > 0 && <li>{f.activation.generationsCompleted} generación(es) lista(s)</li>}
                        {f.days.length > 1 && <li>{f.days.length} días distintos</li>}
                      </ul>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    {v.visual_score ?? 0} · {v.depth_score ?? 0} · {v.commercial_score} · {v.activation_score} · {v.recurrence_score ?? 0}
                    <small>{v.explanation}</small>
                  </td>
                  <td>
                    {formatWhen(v.last_event_at)}
                    {(v.sessions as string[] | undefined)?.length ? <small>{(v.sessions as string[]).length} sesión(es)</small> : null}
                  </td>
                  <td>
                    {(m || !v.is_internal) && (
                      <button type="button" className="pr-link" disabled={busy === v.visitor_id} onClick={() => void mark(v.visitor_id, !m)}>
                        {m ? "Desmarcar interno" : "Marcar como interno"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h3>Cronología</h3>
      {!events.length ? (
        <p className="pr-muted">Sin eventos en esta selección.</p>
      ) : (
        <ol className="ld-timeline">
          {events.map((e) => (
            <li key={e.event_id} className={e.is_internal || internalIds.has(e.visitor_id) ? "is-internal" : undefined}>
              <time>{formatWhen(e.occurred_at)}</time>
              <b>{EVENT_LABELS[e.event_name] ?? e.event_name}</b>
              <span>
                {[e.style_id && `estilo ${e.style_id}`, demo === "all" && title.get(e.demo_id), short(e.visitor_id), e.source === "backfill" && "histórico", e.source === "server" && "confirmado por el servidor"]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </li>
          ))}
        </ol>
      )}
      <p className="pr-caption">
        Las grabaciones de sesión de PostHog están desactivadas para /demo en este proyecto, así que no hay grabaciones que enlazar.
      </p>
    </section>
  );
}
