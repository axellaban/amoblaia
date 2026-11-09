import type { Metadata } from "next";
import Link from "next/link";
import { FollowupBoard } from "@/components/admin-followup";
import "./followup-polish.css";
import "./followup-workspace.css";
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
export default async function FollowupPage() {
  await requireAdminPage("/admin/follow-up");
  const data = await followupOverview().catch((e: unknown) => (e instanceof HttpError ? e.message : null));
  return (
    <div className="ah-page fu-page">
      <header className="ah-head fu-workspace-head">
        <div className="fu-workspace-copy">
          <span className="fu-workspace-eyebrow">FOLLOW-UP / OPERACIÓN COMERCIAL</span>
          <h1>Ejecución comercial</h1>
          <p>Gestioná el outreach y el seguimiento de tus inmobiliarias. Las mismas acciones, reglas y métricas, en una vista más clara.</p>
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
        <FollowupBoard stages={data.stages} queue={data.queue} blocked={data.blocked} noInteresados={data.noInteresados} summary={data.summary} inbox={data.inbox} funnel={data.funnel} rules={data.rules} changes={data.changes} results={data.results} generatedAt={data.generatedAt} />
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
