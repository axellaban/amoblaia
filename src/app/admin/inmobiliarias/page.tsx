import { CommercialFunnelChart, STAYED } from "@/components/commercial-funnel-chart";
import type { Metadata } from "next";
import type React from "react";
import Link from "next/link";
import { ArrowRight, Filter, Plus, Search } from "lucide-react";
import { claimsToReview } from "@/lib/agency/admin";
import { CLAIM_REVIEW_LABEL } from "@/lib/agency/claim-review";
import {
  COMMERCIAL_STAGES,
  STAGE_PARAM,
  STAGE_TAB,
  accountState,
  agoText,
  filterRows,
  listTotals,
  sortFromParam,
  ACTIVITY_HINT,
  DEFAULT_SORT,
  sortParam,
  sortRows,
  type ListSort,
  stageFromParam,
  type AccountState,
  type ListFilters,
} from "@/lib/agency/commercial";
import { commercialRows } from "@/lib/agency/commercial-server";
import { AGENCY_STEPS, STEP_LABEL, agencyStep, demosInPeriod, funnelCounts, inPeriod, parsePeriod, shortDay, type Period } from "@/lib/agency/demo-funnel";
import { AccountPill, AgencyThumb, DemoStepMenu, MoreMenu, RecalcScores, RowQuickActions, ScorePill, StagePill } from "@/components/admin-agency-hub";
import { SupportViewButton } from "@/components/admin-agencies";
import { requireAdminPage } from "@/lib/demos/admin-page";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Inmobiliarias",
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const PER_PAGE = 50;
/** Each funnel step's share, said of the step before it. */
/** Who stayed at each step without reaching the next one: the orange part of its bar. */
/** «hoy», «últimos 7 días», «del 02/11 al 04/11»: the period, said in the list's summary. */
function periodLabel(p: Period) {
  const day = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
  if (p.key === "hoy") return "hoy";
  if (p.key === "7" || p.key === "30") return `últimos ${p.key} días`;
  if (p.key === "mes") return "este mes";
  if (p.from && p.to) return p.from === p.to ? `el ${day(p.from)}` : `del ${day(p.from)} al ${day(p.to)}`;
  return p.from ? `desde el ${day(p.from)}` : p.to ? `hasta el ${day(p.to)}` : "";
}
const ACCOUNT_PARAM: Record<AccountState, string> = { none: "sin-cuenta", registered: "registrada", active: "activa" };

/**
 * The team's single entry point: every agency, from prospect to paying
 * client, with its stage, account, properties, lead score and latest
 * activity. Tabs, search and filters live in the URL.
 */
export default async function AgenciesPage({ searchParams }: Props) {
  await requireAdminPage("/admin/inmobiliarias");
  const sp = await searchParams;
  const filters: ListFilters = {
    stage: stageFromParam(one(sp.etapa)),
    q: one(sp.q).slice(0, 80),
    account: (Object.keys(ACCOUNT_PARAM) as AccountState[]).find((k) => ACCOUNT_PARAM[k] === one(sp.cuenta)) ?? null,
    minScore: [20, 40, 60, 80].includes(Number(one(sp.score))) ? Number(one(sp.score)) : null,
    days: [7, 30, 90].includes(Number(one(sp.actividad))) ? Number(one(sp.actividad)) : null,
  };
  const period = parsePeriod({ periodo: one(sp.periodo), desde: one(sp.desde), hasta: one(sp.hasta) });
  // «Con demo creada» is a tab of its own (not a commercial stage); «paso» is a step of the funnel (AGENCY_STEPS).
  const withDemo = one(sp.etapa) === "con-demo";
  const stepRaw = Number(one(sp.paso));
  const step = one(sp.paso) !== "" && Number.isInteger(stepRaw) && stepRaw >= 0 && stepRaw < AGENCY_STEPS.length ? stepRaw : null;
  // «quedo»: only the agencies that stayed at the step (not the ones that went on), to follow up («1») or lost
  // («perdidas»: «No interesado» in the sheet). The last step has nothing after it.
  const lostOnly = step !== null && step < AGENCY_STEPS.length - 1 && one(sp.quedo) === "perdidas";
  const stayed = lostOnly || (step !== null && step < AGENCY_STEPS.length - 1 && one(sp.quedo) === "1");
  const page = Math.max(1, Number(one(sp.pagina)) || 1);
  const sort = sortFromParam(one(sp.orden));
  const [rows, toReview] = await Promise.all([commercialRows().catch(() => null), claimsToReview().catch(() => [])]);
  const filtering = Boolean(filters.account || filters.minScore !== null || filters.days);

  /** This list's address with some parameters changed (null removes one); the page goes back to 1. */
  const href = (change: Record<string, string | null>) => {
    const next = new URLSearchParams();
    const current: Record<string, string> = {
      etapa: withDemo ? "con-demo" : filters.stage ? STAGE_PARAM[filters.stage] : "",
      paso: step !== null ? String(step) : "",
      quedo: lostOnly ? "perdidas" : stayed ? "1" : "",
      periodo: period.key === "todo" || period.key === "rango" ? "" : period.key,
      desde: period.key === "rango" && period.from ? period.from : "",
      hasta: period.key === "rango" && period.to ? period.to : "",
      q: filters.q,
      cuenta: filters.account ? ACCOUNT_PARAM[filters.account] : "",
      score: filters.minScore !== null ? String(filters.minScore) : "",
      actividad: filters.days ? String(filters.days) : "",
      orden: sortParam(sort),
    };
    for (const [k, v] of Object.entries({ ...current, ...change })) if (v) next.set(k, v);
    const s = next.toString();
    return `/admin/inmobiliarias${s ? `?${s}` : ""}`;
  };

  return (
    <div className="ah-page">
      <header className="ah-head">
        <div>
          <h1>Inmobiliarias</h1>
          <p>Todas las inmobiliarias, en un solo lugar: prospectos, leads y clientes.</p>
        </div>
        <Link href="/admin/inmobiliarias/nueva" className="button button-primary">
          <Plus size={18} aria-hidden="true" /> Nueva inmobiliaria
        </Link>
      </header>

      {!rows ? (
        <div className="account-panel" role="alert">
          <h2>No pudimos cargar las inmobiliarias</h2>
          <p>Probá de nuevo en unos segundos.</p>
          <Link href={href({})} className="button button-small">
            Reintentar
          </Link>
        </div>
      ) : (
        <AgencyList rows={rows} filters={filters} filtering={filtering} page={page} href={href} toReview={toReview} period={period} withDemo={withDemo} step={step} stayed={stayed} lostOnly={lostOnly} sort={sort} />
      )}
    </div>
  );
}

function AgencyList({
  rows,
  filters,
  filtering,
  page,
  href,
  toReview,
  period,
  withDemo,
  step,
  stayed,
  lostOnly,
  sort,
}: {
  sort: ListSort;
  rows: NonNullable<Awaited<ReturnType<typeof commercialRows>>>;
  period: Period;
  withDemo: boolean;
  step: number | null;
  stayed: boolean;
  lostOnly: boolean;
  filters: ListFilters;
  filtering: boolean;
  page: number;
  href: (change: Record<string, string | null>) => string;
  toReview: Awaited<ReturnType<typeof claimsToReview>>;
}) {
  const view = new Map(rows.map((r) => [r.id, demosInPeriod(r.demos, period)]));
  // One per agency: its highest step, prospecting (first contacted in the period) or demo (created in the period).
  // Test agencies are out: tapping a part of a bar lists exactly that many.
  const reached = new Map(
    rows.map((r) => {
      const p = r.prospectFunnel && inPeriod(r.prospectFunnel.at, period) ? r.prospectFunnel.step : null;
      return [r.id, agencyStep(p, view.get(r.id)!.step)];
    }),
  );
  const counted = rows.filter((r) => !r.test && reached.get(r.id) != null);
  const funnel = funnelCounts(counted.map((r) => reached.get(r.id)!), AGENCY_STEPS);
  // Lost accounts («No interesado» in the sheet) that stayed at a step: apart from the ones to follow up.
  const lostAt = AGENCY_STEPS.map((_, i) => counted.filter((r) => reached.get(r.id) === i && r.prospectFunnel?.lost).length);

  // A period other than «Todo» scopes the whole list (and its tab counts) to the agencies with demos created in it,
  // so what's below matches the funnel above.
  const periodOn = period.key !== "todo";
  const scoped = periodOn ? rows.filter((r) => view.get(r.id)!.count > 0 || reached.get(r.id) != null) : rows;
  const totals = listTotals(scoped);
  const withDemos = rows.filter((r) => view.get(r.id)!.count > 0).length;
  const periodDemos = scoped.reduce((n, r) => n + view.get(r.id)!.count, 0);
  const filtered = filterRows(scoped, filters).filter((r) => {
    const v = view.get(r.id)!;
    if (withDemo && !v.count) return false;
    // A funnel step: agencies with a demo of the period that reached it, without test agencies, like the bar.
    // «Se quedaron»: its highest step is exactly that one.
    const s = reached.get(r.id);
    if (step === null) return true;
    if (r.test || s == null) return false;
    return stayed ? s === step && !!r.prospectFunnel?.lost === lostOnly : s >= step;
  });
  const shown = sortRows(filtered, sort);
  /** A sortable header: the first click sorts from highest to lowest (newest activity first), the next one the other way. */
  const sortHead = (by: "score" | "actividad", label: React.ReactNode) => {
    const on = sort.by === by;
    const next: ListSort = { by, dir: on && sort.dir === "desc" ? "asc" : "desc" };
    return (
      <Link href={href({ orden: sortParam(next) || null })} className={`ah-sort${on ? " is-on" : ""}`}>
        {label}
        <span aria-hidden="true">{on ? (sort.dir === "desc" ? " ↓" : " ↑") : " ↕"}</span>
      </Link>
    );
  };
  const pages = Math.max(1, Math.ceil(shown.length / PER_PAGE));
  const current = Math.min(page, pages);
  const items = shown.slice((current - 1) * PER_PAGE, current * PER_PAGE);
  const pageHref = (p: number) => {
    const base = href({});
    return p > 1 ? `${base}${base.includes("?") ? "&" : "?"}pagina=${p}` : base;
  };
  const presetHref = (key: string) => href({ periodo: key === "todo" ? null : key, desde: null, hasta: null });
  return (
    <>
      <CommercialFunnelChart funnel={funnel} lostAt={lostAt} period={period} step={step} stayed={stayed} lostOnly={lostOnly}
        href={href} presetHref={presetHref} action="/admin/inmobiliarias" rangeFields={<>
              {withDemo && <input type="hidden" name="etapa" value="con-demo" />}
              {!withDemo && filters.stage && <input type="hidden" name="etapa" value={STAGE_PARAM[filters.stage]} />}
              {step !== null && <input type="hidden" name="paso" value={step} />}
              {stayed && <input type="hidden" name="quedo" value={lostOnly ? "perdidas" : "1"} />}
              {filters.q && <input type="hidden" name="q" value={filters.q} />}
              {sortParam(sort) && <input type="hidden" name="orden" value={sortParam(sort)} />}
        </>} />

      {toReview.length > 0 && (
        <section className="account-panel aa-claim" aria-labelledby="aa-claims-review">
          <h2 id="aa-claims-review">Cuentas reclamadas para revisar ({toReview.length})</h2>
          <ul className="aa-list">
            {toReview.map((a) => (
              <li key={a.id}>
                <Link href={`/admin/inmobiliarias/${a.id}?pestana=cuenta`} className="text-link">
                  {a.name}
                </Link>{" "}
                · {a.claim_email} · <span className={`dm-status ${a.claim_review === "mismatch" ? "is-alert" : ""}`}>{CLAIM_REVIEW_LABEL[a.claim_review]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="ah-toolbar">
        <nav className="ah-tabs" aria-label="Etapa comercial">
          <Link href={href({ etapa: null })} className={!filters.stage && !withDemo ? "is-on" : undefined} aria-current={!filters.stage && !withDemo ? "page" : undefined}>
            Todas ({totals.total})
          </Link>
          <Link href={href({ etapa: "con-demo" })} className={withDemo ? "is-on" : undefined} aria-current={withDemo ? "page" : undefined}>
            Con demo creada ({withDemos})
          </Link>
          {COMMERCIAL_STAGES.map((s) => (
            <Link
              key={s}
              href={href({ etapa: STAGE_PARAM[s] })}
              className={!withDemo && filters.stage === s ? "is-on" : undefined}
              aria-current={!withDemo && filters.stage === s ? "page" : undefined}
            >
              {STAGE_TAB[s]} ({totals.byStage[s]})
            </Link>
          ))}
        </nav>
        <form className="ah-search" action="/admin/inmobiliarias" role="search">
          {withDemo && <input type="hidden" name="etapa" value="con-demo" />}
          {!withDemo && filters.stage && <input type="hidden" name="etapa" value={STAGE_PARAM[filters.stage]} />}
          {step !== null && <input type="hidden" name="paso" value={step} />}
          {period.key !== "todo" && period.key !== "rango" && <input type="hidden" name="periodo" value={period.key} />}
          {period.key === "rango" && period.from && <input type="hidden" name="desde" value={period.from} />}
          {period.key === "rango" && period.to && <input type="hidden" name="hasta" value={period.to} />}
          {filters.account && <input type="hidden" name="cuenta" value={ACCOUNT_PARAM[filters.account]} />}
          {filters.minScore !== null && <input type="hidden" name="score" value={filters.minScore} />}
          {filters.days && <input type="hidden" name="actividad" value={filters.days} />}
          {sortParam(sort) && <input type="hidden" name="orden" value={sortParam(sort)} />}
          <Search size={17} aria-hidden="true" />
          <input type="search" name="q" defaultValue={filters.q} placeholder="Buscar inmobiliaria…" aria-label="Buscar inmobiliaria" />
        </form>
        <details className="ah-filter" open={filtering || undefined}>
          <summary className="button button-small button-outline">
            <Filter size={16} aria-hidden="true" /> Filtrar{filtering ? " ·" : ""}
          </summary>
          <form action="/admin/inmobiliarias" className="ah-filter-form">
            {withDemo && <input type="hidden" name="etapa" value="con-demo" />}
            {!withDemo && filters.stage && <input type="hidden" name="etapa" value={STAGE_PARAM[filters.stage]} />}
            {step !== null && <input type="hidden" name="paso" value={step} />}
            {period.key !== "todo" && period.key !== "rango" && <input type="hidden" name="periodo" value={period.key} />}
            {period.key === "rango" && period.from && <input type="hidden" name="desde" value={period.from} />}
            {period.key === "rango" && period.to && <input type="hidden" name="hasta" value={period.to} />}
            {filters.q && <input type="hidden" name="q" value={filters.q} />}
            {sortParam(sort) && <input type="hidden" name="orden" value={sortParam(sort)} />}
            <label>
              Cuenta habita
              <select name="cuenta" defaultValue={filters.account ? ACCOUNT_PARAM[filters.account] : ""}>
                <option value="">Todas</option>
                <option value="sin-cuenta">Sin cuenta</option>
                <option value="registrada">Registrada</option>
                <option value="activa">Activa (suscripción)</option>
              </select>
            </label>
            <label>
              Lead score
              <select name="score" defaultValue={filters.minScore !== null ? String(filters.minScore) : ""}>
                <option value="">Cualquiera</option>
                <option value="20">20 o más</option>
                <option value="40">40 o más</option>
                <option value="60">60 o más (calientes)</option>
                <option value="80">80 o más</option>
              </select>
            </label>
            <label>
              Última actividad
              <select name="actividad" defaultValue={filters.days ? String(filters.days) : ""}>
                <option value="">Cualquier fecha</option>
                <option value="7">Últimos 7 días</option>
                <option value="30">Últimos 30 días</option>
                <option value="90">Últimos 90 días</option>
              </select>
            </label>
            <div className="ah-filter-actions">
              {filtering && (
                <Link href={href({ cuenta: null, score: null, actividad: null })} className="text-link">
                  Quitar filtros
                </Link>
              )}
              <button className="button button-small button-primary">Aplicar</button>
            </div>
          </form>
        </details>
      </div>

      {/* On the phone the table's headers are hidden: the order is chosen here. */}
      <nav className="ah-sortbar" aria-label="Ordenar la lista">
        <span>Ordenar por</span>
        {(
          [
            ["actividad", "Última actividad"],
            ["score", "Lead score"],
            ["creada", "Más nuevas"],
          ] as const
        ).map(([by, label]) => {
          const on = sort.by === by;
          // «Más nuevas» is the default order: one tap only, no reverse.
          const next: ListSort = by === "creada" ? DEFAULT_SORT : { by, dir: on && sort.dir === "desc" ? "asc" : "desc" };
          return (
            <Link key={by} href={href({ orden: sortParam(next) || null })} className={`ah-sortchip${on ? " is-on" : ""}`} aria-current={on ? "true" : undefined}>
              {label}
              {on && by !== "creada" ? (sort.dir === "desc" ? " ↓" : " ↑") : ""}
            </Link>
          );
        })}
      </nav>

      {(periodOn || step !== null) && (
        <p className="ah-scope">
          {shown.length} {shown.length === 1 ? "inmobiliaria" : "inmobiliarias"}
          {step !== null
            ? lostOnly
              ? ` perdidas en «${AGENCY_STEPS[step]}» (no interesadas)`
              : stayed
              ? ` en «${AGENCY_STEPS[step]}» sin pasar a «${AGENCY_STEPS[step + 1]}» (${STAYED[step].toLowerCase()})`
              : ` en «${AGENCY_STEPS[step]}»`
            : " con demos creadas"}
          {periodOn ? ` · ${periodLabel(period)} (${periodDemos} ${periodDemos === 1 ? "demo" : "demos"})` : ""}
          {" · "}
          <Link href={href({ periodo: null, desde: null, hasta: null, paso: null, quedo: null })} className="text-link">
            Ver todas
          </Link>
        </p>
      )}

      {!items.length ? (
        rows.length ? (
          <p className="ah-empty">No hay inmobiliarias con estos filtros.</p>
        ) : (
          <div className="account-panel ae-empty">
            <h2>Todavía no hay inmobiliarias</h2>
            <p>Creá la primera: alcanza con su nombre comercial.</p>
            <Link href="/admin/inmobiliarias/nueva" className="button button-primary">
              + Nueva inmobiliaria
            </Link>
          </div>
        )
      ) : (
        <div className="ah-table-wrap">
          <table className="ah-table">
            <thead>
              <tr>
                <th scope="col">Inmobiliaria</th>
                <th scope="col">
                  <span title="Prospecto → Contactada → Demo enviada → Interactuó → Con panel → Cliente. Surge de los hechos registrados.">Estado comercial ⓘ</span>
                </th>
                <th scope="col">
                  <span title="La última demo creada en el período y el paso más alto del funnel que alcanzaron sus demos.">Demo ⓘ</span>
                </th>
                <th scope="col">Cuenta habita</th>
                <th scope="col" className="is-num">
                  Propiedades
                </th>
                <th scope="col" aria-sort={sort.by === "score" ? (sort.dir === "desc" ? "descending" : "ascending") : undefined}>
                  {sortHead("score", <span title="Engagement de visitantes externos con sus demos (0 a 100). No es probabilidad de compra. Tocá para ordenar.">Lead score ⓘ</span>)}
                </th>
                <th scope="col" aria-sort={sort.by === "actividad" ? (sort.dir === "desc" ? "descending" : "ascending") : undefined}>
                  {sortHead("actividad", <span title={`${ACTIVITY_HINT} Tocá para ordenar.`}>Última actividad ⓘ</span>)}
                </th>
                <th scope="col" className="is-actions">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => {
                const base = `/admin/inmobiliarias/${r.id}`;
                return (
                  <tr key={r.id}>
                    <td className="is-name">
                      <Link href={base} className="ah-name">
                        <AgencyThumb photoId={r.coverPhotoId} />
                        <strong>{r.name}</strong>
                      </Link>
                    </td>
                    <td className="is-stage">
                      <StagePill stage={r.stage} />
                    </td>
                    <td className="is-demo">
                      {(() => {
                        const v = view.get(r.id)!;
                        return v.latest && v.step !== null ? (
                          <span className="ah-demo">
                            {/* «Creada» and «Enviada» change by hand; the later steps come from what the agency did. */}
                            {v.step <= 1 && r.demos.every((d) => d.step <= 1 && d.id) ? (
                              <DemoStepMenu
                                name={r.name}
                                step={v.step as 0 | 1}
                                label={STEP_LABEL[v.step]}
                                demos={r.demos.map((d) => ({ id: d.id!, sent: Boolean(d.sent) }))}
                              />
                            ) : (
                              <span className={`ah-demo-step is-step-${v.step}`}>{STEP_LABEL[v.step]}</span>
                            )}
                            <small>
                              {shortDay(v.latest)}
                              {v.count > 1 ? ` · ${v.count} demos` : ""}
                              {r.test ? " · prueba" : ""}
                            </small>
                          </span>
                        ) : (
                          "—"
                        );
                      })()}
                    </td>
                    <td className="is-account">
                      <AccountPill state={accountState(r)} />
                    </td>
                    <td className="is-num">{r.properties}</td>
                    <td className="is-score">
                      <ScorePill score={r.score} />
                    </td>
                    <td className="is-when">
                      {r.lastActivity ? (
                        <span className="ah-when" title={ACTIVITY_HINT}>
                          {agoText(r.lastActivity.at)}
                          <small>{r.lastActivity.text}</small>
                        </span>
                      ) : (
                        <span className="ah-when is-none" title={ACTIVITY_HINT}>
                          <small>Sin actividad suya</small>
                        </span>
                      )}
                    </td>
                    <td className="is-actions">
                      <RowQuickActions agencyId={r.id} name={r.name} phone={r.whatsapp ?? null} demo={r.shareDemo ?? null} claimed={r.hasOwner} />
                      <Link href={base} className="button button-small button-outline ah-see">
                        Ver <ArrowRight size={15} aria-hidden="true" />
                      </Link>
                      <MoreMenu label={`Más acciones de ${r.name}`}>
                        <Link href={`${base}/propiedades/nueva?${new URLSearchParams({ volver: `${base}?pestana=propiedades` })}`}>Nueva propiedad</Link>
                        <Link href={`${base}/editar?${new URLSearchParams({ volver: base })}`}>Editar inmobiliaria</Link>
                        <Link href={`${base}?pestana=enlaces`}>Ver enlaces</Link>
                        <Link href={`${base}?pestana=cuenta`}>Cuenta y créditos</Link>
                        <SupportViewButton agencyId={r.id} quiet />
                        <SupportViewButton agencyId={r.id} quiet act />
                      </MoreMenu>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <nav className="ap-pages" aria-label="Páginas">
          {current > 1 ? <Link href={pageHref(current - 1)}>Anterior</Link> : <span />}
          <span>
            Página {current} de {pages} · {shown.length} inmobiliarias
          </span>
          {current < pages ? <Link href={pageHref(current + 1)}>Siguiente</Link> : <span />}
        </nav>
      )}
      <RecalcScores />
    </>
  );
}
