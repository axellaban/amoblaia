import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DemoView } from "@/components/demo-view";
import { PanelNav } from "@/components/panel-shell";
import { PreviewBar } from "@/components/preview-bar";
import { requirePanelPage } from "@/lib/agency/page";
import { inScope } from "@/lib/agency/server";
import { canEdit, propertyLink } from "@/lib/agency/shared";
import { demoRow, previewDemo } from "@/lib/demos/server";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Vista previa de la ficha", robots: { index: false, follow: false } };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Only the panel's own pages: «Volver» never leaves it. */
const panelPath = (value: unknown) => (typeof value === "string" && /^\/panel(\/|\?|$)/.test(value) && !value.startsWith("//") ? value : null);

/**
 * The buyer's page inside the panel: the sidebar and the header stay, and the
 * ficha (exactly the public page, drafts included, with images from the
 * panel's route and the agency's switches applied) is shown in a frame,
 * desktop- or phone-sized (?vista=movil). The frame loads this same route
 * with ?marco=1, which renders the bare page so its own layout applies.
 * ?volver= is where «Volver» goes (the home or «Mis demostraciones»).
 */
export default async function PreviewPropertyPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { vista, marco, volver } = await searchParams;
  const { membership } = await requirePanelPage(`/panel/propiedades/${id}/vista-previa`);
  const row = await demoRow(id).catch(() => null);
  if (!row || row.agency_id !== membership.agency.id || !inScope(membership, row.property_id)) notFound();
  if (marco === "1") {
    const demo = await previewDemo(id).catch(() => null);
    if (!demo) notFound();
    return (
      <div className="pv-root pv-framed">
        <DemoView demo={{ ...demo, prospect: false }} source={{ kind: "preview" }} />
      </div>
    );
  }
  const phone = vista === "movil";
  const published = row.status === "published";
  const backTo = panelPath(volver);
  const title = row.title || "Tu demostración";
  const frame = `/panel/propiedades/${id}/vista-previa?marco=1`;
  // The path only: the bar adds the origin it runs on.
  const link = published ? propertyLink("", row, { slug: membership.agency.slug, sitePublished: membership.agency.site_published }) : null;
  return (
    <>
      <PanelNav section="propiedades" agencyName={membership.agency.name} role={membership.role} />
      <div className="account-page container ap-page pv-page">
        <PreviewBar
          id={id}
          title={title}
          published={published}
          view={phone ? "movil" : "escritorio"}
          backTo={backTo}
          linkPath={link}
          canWork={canEdit(membership.role)}
        />
        {phone ? (
          <div className="pv-phone">
            <iframe src={frame} title={`Vista previa de ${title} en un teléfono`} />
          </div>
        ) : (
          <div className="pv-desktop">
            <iframe src={frame} title={`Vista previa de ${title}`} />
          </div>
        )}
      </div>
    </>
  );
}
