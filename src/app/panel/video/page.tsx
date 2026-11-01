import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PanelNav } from "@/components/panel-shell";
import { VideoStudio } from "@/components/video-studio";
import { videoEnabled } from "@/lib/agency/flags";
import { requirePanelPage } from "@/lib/agency/page";
import { canEdit, inScopeOf } from "@/lib/agency/video-access";
import { demoRow, previewDemo } from "@/lib/demos/server";
import { isUuid } from "@/lib/demos/shared";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Video", robots: { index: false, follow: false } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Video (spec §6): choose a property, its photos, the mode and the format.
 * The "Clásico" montage is live; the AI modes are shown and enabled with
 * their provider. Production shows the section once NEXT_PUBLIC_HABITA_VIDEO=1.
 */
export default async function Page({ searchParams }: Props) {
  if (!videoEnabled()) notFound();
  const { membership } = await requirePanelPage("/panel/video");
  const { propiedad } = await searchParams;
  const id = typeof propiedad === "string" && isUuid(propiedad) ? propiedad : null;
  let demo = null;
  if (id) {
    const row = await demoRow(id).catch(() => null);
    if (!row || row.agency_id !== membership.agency.id || !inScopeOf(membership, row.property_id)) notFound();
    demo = await previewDemo(id).catch(() => null);
    if (!demo) notFound();
  }
  return (
    <>
      <PanelNav section="video" agencyName={membership.agency.name} role={membership.role} />
      <div className="account-page container ap-page">
        <VideoStudio demoId={id} demo={demo} canEdit={canEdit(membership)} />
      </div>
    </>
  );
}
