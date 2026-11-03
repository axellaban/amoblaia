import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Building2, CreditCard, Filter, Flame, Plus, Search, Users } from "lucide-react";
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
  stageFromParam,
  type AccountState,
  type ListFilters,
} from "@/lib/agency/commercial";
import { commercialRows } from "@/lib/agency/commercial-server";
import { AccountPill, AgencyThumb, MoreMenu, ScorePill, StagePill } from "@/components/admin-agency-hub";
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
  const page = Math.max(1, Number(one(sp.pagina)) || 1);
  const [rows, toReview] = await Promise.all([commercialRows().catch(() => null), claimsToReview().catch(() => [])]);
  const filtering = Boolean(filters.account || filters.minScore !== null || filters.days);

  /** This list's address with some parameters changed (null removes one); the page goes back to 1. */
  const href = (change: Record<string, string | null>) => {
    const next = new URLSearchParams();
    const current: Record<string, string> = {
      etapa: filters.stage ? STAGE_PARAM[filters.stage] : "",
      q: filters.q,
      cuenta: filters.account ? ACCOUNT_PARAM[filters.account] : "",
      score: filters.minScore !== null ? String(filters.minScore) : "",
      actividad: filters.days ? String(filters.days) : "",
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
        <AgencyList rows={rows} filters={filters} filtering={filtering} page={page} href={href} toReview={toReview} />
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
}: {
  rows: NonNullable<Awaited<ReturnType<typeof commercialRows>>>;
  filters: ListFilters;
  filtering: boolean;
  page: number;
  href: (change: Record<string, string | null>) => string;
  toReview: Awaited<ReturnType<typeof claimsToReview>>;
}) {
  const totals = listTotals(rows);
  const shown = filterRows(rows, filters);
  const pages = Math.max(1, Math.ceil(shown.length / PER_PAGE));
  const current = Math.min(page, pages);
  const items = shown.slice((current - 1) * PER_PAGE, current * PER_PAGE);
  const pageHref = (p: number) => {
    const base = href({});
    return p > 1 ? `${base}${base.includes("?") ? "&" : "?"}pagina=${p}` : base;
  };
  const cards = [
    { icon: Building2, value: totals.total, label: "Inmobiliarias totales", link: href({ etapa: null, cuenta: null, score: null, actividad: null, q: null }) },
    { icon: Flame, value: totals.hot, label: "Leads calientes", sub: "(score ≥ 60)", link: href({ score: "60" }), hot: true },
    { icon: Users, value: totals.withAccount, label: "Con cuenta", sub: "(registradas)", link: href({ etapa: "con-panel" }) },
    { icon: CreditCard, value: totals.paying, label: "Clientes pagos", sub: "(suscripción activa)", link: href({ etapa: "clientes" }) },
  ];
  return (
    <>
      <section className="ah-cards" aria-label="Resumen">
        {cards.map(({ icon: Icon, value, label, sub, link, hot }) => (
          <Link key={label} href={link} className="ah-card">
            <Icon size={30} aria-hidden="true" className={hot ? "is-hot" : undefined} />
            <span>
              <strong>{value}</strong>
              <small>
                {label}
                {sub && (
                  <>
                    <br />
                    {sub}
                  </>
                )}
              </small>
            </span>
          </Link>
        ))}
      </section>

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
          <Link href={href({ etapa: null })} className={!filters.stage ? "is-on" : undefined} aria-current={!filters.stage ? "page" : undefined}>
            Todas ({totals.total})
          </Link>
          {COMMERCIAL_STAGES.map((s) => (
            <Link
              key={s}
              href={href({ etapa: STAGE_PARAM[s] })}
              className={filters.stage === s ? "is-on" : undefined}
              aria-current={filters.stage === s ? "page" : undefined}
            >
              {STAGE_TAB[s]} ({totals.byStage[s]})
            </Link>
          ))}
        </nav>
        <form className="ah-search" action="/admin/inmobiliarias" role="search">
          {filters.stage && <input type="hidden" name="etapa" value={STAGE_PARAM[filters.stage]} />}
          {filters.account && <input type="hidden" name="cuenta" value={ACCOUNT_PARAM[filters.account]} />}
          {filters.minScore !== null && <input type="hidden" name="score" value={filters.minScore} />}
          {filters.days && <input type="hidden" name="actividad" value={filters.days} />}
          <Search size={17} aria-hidden="true" />
          <input type="search" name="q" defaultValue={filters.q} placeholder="Buscar inmobiliaria…" aria-label="Buscar inmobiliaria" />
        </form>
        <details className="ah-filter" open={filtering || undefined}>
          <summary className="button button-small button-outline">
            <Filter size={16} aria-hidden="true" /> Filtrar{filtering ? " ·" : ""}
          </summary>
          <form action="/admin/inmobiliarias" className="ah-filter-form">
            {filters.stage && <input type="hidden" name="etapa" value={STAGE_PARAM[filters.stage]} />}
            {filters.q && <input type="hidden" name="q" value={filters.q} />}
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
                <th scope="col">Cuenta habita</th>
                <th scope="col" className="is-num">
                  Propiedades
                </th>
                <th scope="col">
                  <span title="Engagement de visitantes externos con sus demos (0 a 100). No es probabilidad de compra.">Lead score ⓘ</span>
                </th>
                <th scope="col">Última actividad</th>
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
                    <td>
                      <Link href={base} className="ah-name">
                        <AgencyThumb photoId={r.coverPhotoId} />
                        <strong>{r.name}</strong>
                      </Link>
                    </td>
                    <td>
                      <StagePill stage={r.stage} />
                    </td>
                    <td>
                      <AccountPill state={accountState(r)} />
                    </td>
                    <td className="is-num">{r.properties}</td>
                    <td>
                      <ScorePill score={r.score} />
                    </td>
                    <td>
                      {r.lastActivity ? (
                        <span className="ah-when">
                          {agoText(r.lastActivity.at)}
                          <small>{r.lastActivity.text}</small>
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="is-actions">
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
    </>
  );
}
