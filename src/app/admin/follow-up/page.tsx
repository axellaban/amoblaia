import { CommercialFunnelChart } from "@/components/commercial-funnel-chart";
import { parsePeriod } from "@/lib/agency/demo-funnel";
import type { Metadata } from "next";
import Link from "next/link";
import { FollowupBoard } from "@/components/admin-followup";
import "./followup-polish.css";
import "./followup-workspace.css";
import "./followup-catalog.css";
import "./followup-reference.css";
import { HttpError } from "@/lib/commerce/http";
import { requireAdminPage } from "@/lib/demos/admin-page";
import { followupOverview } from "@/lib/followup/server";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Follow-up",
  robots: { index: false, follow: false },
};

/**
 * Follow-up: una next best action por etapa del embudo de Inmobiliarias, con
 * las inmobiliarias que esperan en cada una y los números de cada versión.
 * El equipo y la extensión la ejecutan desde acá (docs/FOLLOWUP.md).
 */
export default async function FollowupPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage("/admin/follow-up");
  const params = await searchParams;
  const one = (key: string) => typeof params[key] === "string" ? params[key] as string : "";
  const period = parsePeriod({ periodo: one("periodo"), desde: one("desde"), hasta: one("hasta") });
  const step = /^[0-8]$/.test(one("paso")) ? Number(one("paso")) : null;
  const stayed = one("quedo") === "1";
  const href = (change: Record<string, string | null>) => {
    const qs = new URLSearchParams({ vista: "embudo" });
    for (const key of ["periodo","desde","hasta","paso","quedo"]) if (one(key)) qs.set(key, one(key));
    for (const [k,v] of Object.entries(change)) { if (v === null) qs.delete(k); else qs.set(k,v); }
    if (qs.get("quedo") === "perdidas") { qs.delete("vista"); return "/admin/inmobiliarias?" + qs; }
    return "/admin/follow-up?" + qs;
  };
  const data = await followupOverview(period).catch((e: unknown) => (e instanceof HttpError ? e.message : null));
  return (
    <div className="ah-page fu-page">
      <header className="ah-head fu-workspace-head">
        <div className="fu-workspace-copy">
          <span className="fu-workspace-eyebrow">FOLLOW-UP</span>
          <h1>EJECUCIÓN COMERCIAL</h1>
          <p>Gestioná el outreach y el seguimiento de todas tus inmobiliarias.</p>
        </div>
        <nav className="fu-workspace-utilities" aria-label="Accesos de Habita">
          <Link href="/panel">Mi inmobiliaria</Link>
          <Link href="/galeria">Galería</Link>
          <Link href="/precios">Precios</Link>
          <Link href="/cuenta">Mi cuenta</Link>
          <Link href="/inicio">Ir a mi inmobiliaria</Link>
        </nav>
      </header>
      {data && typeof data === "object" ? (
        <FollowupBoard chartStep={step} chart={<CommercialFunnelChart funnel={data.chart} lostAt={data.lostAt} period={period} step={step} stayed={stayed} lostOnly={false}
          href={href} presetHref={key => href({ periodo: key, desde: null, hasta: null })} action="/admin/follow-up"
          rangeFields={<><input type="hidden" name="vista" value="embudo" />{step !== null && <input type="hidden" name="paso" value={step} />}{stayed && <input type="hidden" name="quedo" value="1" />}</>} />} stages={data.stages} queue={data.queue} blocked={data.blocked} noInteresados={data.noInteresados} summary={data.summary} agencies={data.agencies} inbox={data.inbox} funnel={data.funnel} rules={data.rules} changes={data.changes} results={data.results} generatedAt={data.generatedAt} />
      ) : (
        <div className="account-panel" role="alert">
          <h2>No pudimos cargar Follow-up</h2>
          <p>{data ?? "Probá de nuevo en unos segundos."}</p>
          <Link href="/admin/follow-up" className="button button-small">
            Reintentar
          </Link>
        </div>
      )}
    </div>
  );
}
