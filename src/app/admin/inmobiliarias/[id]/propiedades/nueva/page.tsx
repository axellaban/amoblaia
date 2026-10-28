import type { Metadata } from "next";
import Link from "next/link";
import { AgencyAddProperty } from "@/components/admin-add-property";
import { agencyPage } from "@/lib/agency/admin-pages";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Agregar propiedad",
  robots: { index: false, follow: false },
};

/** "Agregar propiedad" with the agency already chosen (validated here and again on every write). */
export default async function AddPropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const page = await agencyPage(id, `/admin/inmobiliarias/${id}/propiedades/nueva`);
  if (!page.ok)
    return (
      <div className="account-page container dm-page">
        <div className="account-panel" role="alert">
          <h2>No pudimos cargar la inmobiliaria</h2>
          <Link href={`/admin/inmobiliarias/${id}/propiedades/nueva`} className="button button-small">
            Reintentar
          </Link>
        </div>
      </div>
    );
  return <AgencyAddProperty agency={{ id, name: page.data.agency.name, hasOwner: page.data.agency.hasOwner }} />;
}
