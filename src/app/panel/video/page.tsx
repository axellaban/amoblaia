import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PanelNav } from "@/components/panel-shell";
import { VideoStudio } from "@/components/video-studio";
import { videoEnabled } from "@/lib/agency/flags";
import { requirePanelPage } from "@/lib/agency/page";
import { canEdit, inScopeOf } from "@/lib/agency/video-access";
import { demoRow, previewDemo, settingsOf } from "@/lib/demos/server";
import type { VideoPlacement } from "@/lib/demos/branding";
import { isUuid } from "@/lib/demos/shared";
import { safeReturn } from "@/lib/agency/shared";
import type { InfoSource } from "@/lib/video/plan";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Video", robots: { index: false, follow: false } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Crear video (spec §6): the same studio whichever way it was opened (an
 * existing property, an imported listing or uploaded photos without a ficha).
 * The "Clásico" montage is live; the AI modes are shown and enabled with
 * their provider. Production shows the section once NEXT_PUBLIC_HABITA_VIDEO=1.
 */
export default async function Page({ searchParams }: Props) {
  if (!videoEnabled()) notFound();
  const { membership } = await requirePanelPage("/panel/video");
  const { propiedad, volver } = await searchParams;
  const id = typeof propiedad === "string" && isUuid(propiedad) ? propiedad : null;
  let demo = null;
  let info: InfoSource | null = null;
  let placement: VideoPlacement = "below";
  let kind: "ficha" | "fotos" = "ficha";
  let published = false;
  if (id) {
    const row = await demoRow(id).catch(() => null);
    if (!row || row.agency_id !== membership.agency.id || !inScopeOf(membership, row.property_id)) notFound();
    kind = row.kind === "fotos" ? "fotos" : "ficha";
    published = row.status === "published";
    // The photos come whole; the information only as the ficha shows it (what the agency hides never reaches the video).
    const [raw, visible, stored] = await Promise.all([
      previewDemo(id, { raw: true }).catch(() => null),
      previewDemo(id).catch(() => null),
      settingsOf(id).catch(() => null),
    ]);
    if (!raw || !visible) notFound();
    demo = raw;
    placement = stored?.settings.videoPlacement ?? "below";
    const ficha = kind === "ficha";
    info = {
      title: ficha ? visible.title : null,
      location: ficha ? visible.location : null,
      price: ficha ? visible.price : null,
      priceFallback: `Consultar ${/alquiler/i.test(visible.operation ?? "") ? "alquiler" : "precio"}`,
      operation: ficha ? visible.operation : null,
      facts: ficha ? visible.facts.map((f) => `${f.value} ${f.label}`.trim()).filter(Boolean) : [],
      agencyName: visible.agencyName || null,
      logo: Boolean(visible.agency.logo),
      contact: visible.contact.whatsapp ?? visible.contact.phone ?? visible.contact.email ?? null,
    };
  }
  return (
    <>
      <PanelNav section="video" agencyName={membership.agency.name} role={membership.role} />
      <div className="account-page container ap-page">
        <VideoStudio
          demoId={id}
          demo={demo}
          kind={kind}
          info={info}
          published={published}
          canEdit={canEdit(membership)}
          placement={placement}
          backTo={typeof volver === "string" && id ? safeReturn(volver, "") || null : null}
        />
      </div>
    </>
  );
}
