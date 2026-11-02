import type { Metadata } from "next";
import Link from "next/link";
import { AgencyAddProperty } from "@/components/admin-add-property";
import { AgencyStartDemo } from "@/components/admin-start-demo";
import { agencyPage } from "@/lib/agency/admin-pages";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Agregar propiedad",
  robots: { index: false, follow: false },
};

/**
 * A new demo for the agency already chosen (validated here and again on every
 * write): the panel's «Crear demostración interactiva» flow. ?modo=manual keeps
 * the team's form for a listing typed by hand.
 */
export default async function AddPropertyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const manual = (await searchParams).modo === "manual";
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
  const agency = { id, name: page.data.agency.name, hasOwner: page.data.agency.hasOwner };
  return manual ? <AgencyAddProperty agency={agency} /> : <AgencyStartDemo agency={agency} />;
}
