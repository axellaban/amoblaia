import type { Metadata } from "next";
import Link from "next/link";
import { adminAgencies } from "@/lib/agency/admin";
import { AgenciesTable } from "@/components/admin-agencies";
import { requireAdminPage } from "@/lib/demos/admin-page";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Inmobiliarias",
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** The team's view of every agency: where it stands and what needs attention. */
export default async function AgenciesPage({ searchParams }: Props) {
  await requireAdminPage("/admin/inmobiliarias");
  const sp = await searchParams;
  const q = one(sp.q).slice(0, 80);
  const page = Math.max(1, Number(one(sp.pagina)) || 1);
  const data = await adminAgencies({ q, page }).catch(() => null);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.perPage)) : 1;
  const href = (p: number) => `/admin/inmobiliarias?${new URLSearchParams({ ...(q ? { q } : {}), ...(p > 1 ? { pagina: String(p) } : {}) })}`;
  return (
    <div className="account-page container dm-page">
      <div className="dm-heading">
        <div>
          <span className="eyebrow">Operación comercial</span>
          <h1>
            Inmobiliarias<span className="accent">.</span>
          </h1>
          <p>Cada inmobiliaria con su etapa, sus propiedades y sus créditos. Solo el equipo ve este panel.</p>
        </div>
        <div className="dm-heading-actions">
          <Link href="/admin/demos" className="button button-outline">
            Todas las demos
          </Link>
          <Link href="/admin/demos/nueva" className="button button-primary">
            Nueva inmobiliaria o demo
          </Link>
        </div>
      </div>
      <form className="dm-filters" action="/admin/inmobiliarias" role="search">
        <label className="dm-search">
          <input type="search" name="q" defaultValue={q} placeholder="Buscar por nombre o dirección" aria-label="Buscar inmobiliaria" />
        </label>
        <button type="submit" className="button button-small">
          Buscar
        </button>
      </form>
      {!data && (
        <div className="account-panel" role="alert">
          <h2>No pudimos cargar las inmobiliarias</h2>
          <p>
            Probá de nuevo en unos segundos. Si sigue pasando, revisá que la migración{" "}
            <code>202610290001_panel_reliability.sql</code> esté aplicada en Supabase.
          </p>
          <Link href={href(page)} className="button button-small">
            Reintentar
          </Link>
        </div>
      )}
      {data && (
        <>
          <p className="ap-count">
            {data.total} {data.total === 1 ? "inmobiliaria" : "inmobiliarias"}
            {q ? ` con “${q}”` : ""}
          </p>
          {!data.items.length ? <p>No hay inmobiliarias que coincidan.</p> : <AgenciesTable items={data.items} />}
          {pages > 1 && (
            <nav className="ap-pages" aria-label="Páginas">
              {page > 1 ? <Link href={href(page - 1)}>Anterior</Link> : <span />}
              <span>
                Página {page} de {pages}
              </span>
              {page < pages ? <Link href={href(page + 1)}>Siguiente</Link> : <span />}
            </nav>
          )}
        </>
      )}
    </div>
  );
}
