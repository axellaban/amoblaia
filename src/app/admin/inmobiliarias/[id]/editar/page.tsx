import type { Metadata } from "next";
import Link from "next/link";
import { AgencyWorkspace } from "@/components/admin-agency-workspace";
import { agencyPage } from "@/lib/agency/admin-pages";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Editar inmobiliaria",
  robots: { index: false, follow: false },
};

/** "Editar inmobiliaria": the team's workspace on one agency, inside a signed edit context. */
export default async function EditAgencyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const page = await agencyPage(id, `/admin/inmobiliarias/${id}/editar`);
  if (!page.ok)
    return (
      <div className="account-page container dm-page">
        <div className="account-panel" role="alert">
          <h2>No pudimos cargar la inmobiliaria</h2>
          <p>Probá de nuevo en unos segundos.</p>
          <Link href={`/admin/inmobiliarias/${id}/editar`} className="button button-small">
            Reintentar
          </Link>
        </div>
      </div>
    );
  const { agency, counts, credits } = page.data;
  return <AgencyWorkspace agency={{ id: agency.id, name: agency.name, hasOwner: agency.hasOwner, stage: page.stage, counts, credits }} />;
}
