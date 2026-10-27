import type { Metadata } from "next";
import { AgencyPropertyEditor } from "@/components/admin-agency-editor";
import { agencyPropertyPage } from "@/lib/agency/admin-pages";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Editar propiedad",
  robots: { index: false, follow: false },
};

/** One property of the agency being edited, with the shared editor and the edit banner. */
export default async function AgencyPropertyPage({ params }: { params: Promise<{ id: string; demoId: string }> }) {
  const { id, demoId } = await params;
  const { name } = await agencyPropertyPage(id, demoId, `/admin/inmobiliarias/${id}/propiedades/${demoId}`);
  return <AgencyPropertyEditor agencyId={id} agencyName={name} demoId={demoId} />;
}
