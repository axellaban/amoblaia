import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PanelNav } from "@/components/panel-shell";
import { VideoStudio } from "@/components/video-studio";
import { videoEnabled } from "@/lib/agency/flags";
import { requirePanelPage } from "@/lib/agency/page";
import { canEdit, inScopeOf } from "@/lib/agency/video-access";
import { demoRow } from "@/lib/demos/server";
import { isUuid } from "@/lib/demos/shared";
import { safeReturn } from "@/lib/agency/shared";
import { agencyCredits } from "@/lib/agency/panel";
import { aiVideoLive } from "@/lib/video/fal";
import { studioData, type StudioData } from "@/lib/video/studio-data";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Video", robots: { index: false, follow: false } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Crear video (spec §6): the same studio whichever way it was opened (an
 * existing property, an imported listing or uploaded photos without a ficha).
 * The "Clásico" montage is live; the AI modes show «Próximamente» until
 * HABITA_VIDEO_AI=1 and their provider's key (FAL_KEY) are configured. Production shows the section once
 * NEXT_PUBLIC_HABITA_VIDEO=1.
 */
export default async function Page({ searchParams }: Props) {
  if (!videoEnabled()) notFound();
  const { membership } = await requirePanelPage("/panel/video");
  const { propiedad, volver } = await searchParams;
  const id = typeof propiedad === "string" && isUuid(propiedad) ? propiedad : null;
  let data: StudioData | null = null;
  if (id) {
    const row = await demoRow(id).catch(() => null);
    if (!row || row.agency_id !== membership.agency.id || !inScopeOf(membership, row.property_id)) notFound();
    data = await studioData(row);
    if (!data) notFound();
  }
  const ai = aiVideoLive();
  // The balance the AI modes are paid from (the agency's account), shown before confirming.
  const credits = ai && id ? await agencyCredits(membership.agency.owner_id) : null;
  return (
    <>
      <PanelNav section="video" agencyName={membership.agency.name} role={membership.role} tour={!membership.support && !membership.visitor} />
      <div className="account-page container ap-page">
        <VideoStudio
          demoId={id}
          demo={data?.demo ?? null}
          kind={data?.kind}
          info={data?.info ?? null}
          published={data?.published}
          canEdit={canEdit(membership)}
          placement={data?.placement}
          backTo={typeof volver === "string" && id ? safeReturn(volver, "") || null : null}
          ai={ai}
          credits={credits}
        />
      </div>
    </>
  );
}
