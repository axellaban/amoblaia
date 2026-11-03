import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AgencyVideoStudio } from "@/components/admin-agency-editor";
import { videoEnabled } from "@/lib/agency/flags";
import { agencyPropertyPage } from "@/lib/agency/admin-pages";
import { demoRow } from "@/lib/demos/server";
import { studioData } from "@/lib/video/studio-data";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Video de la propiedad", robots: { index: false, follow: false } };

/**
 * «Generar video» from the team's administrative edit: the same studio as the
 * agency's panel, for this agency's property, with the edit banner. The
 * "Clásico" video is made in the browser and uses no credits.
 */
export default async function AgencyPropertyVideoPage({ params }: { params: Promise<{ id: string; demoId: string }> }) {
  if (!videoEnabled()) notFound();
  const { id, demoId } = await params;
  const { name } = await agencyPropertyPage(id, demoId, `/admin/inmobiliarias/${id}/propiedades/${demoId}/video`);
  const data = await studioData(await demoRow(demoId));
  if (!data) notFound();
  return <AgencyVideoStudio agencyId={id} agencyName={name} demoId={demoId} data={data} />;
}
