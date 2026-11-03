import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DemoView } from "@/components/demo-view";
import { PreviewBar } from "@/components/preview-bar";
import { requirePanelPage } from "@/lib/agency/page";
import { inScope } from "@/lib/agency/server";
import { demoRow, previewDemo } from "@/lib/demos/server";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Vista previa de la ficha", robots: { index: false, follow: false } };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Exactly the public page, drafts included, with images from the panel's
 * route and the agency's switches applied. ?vista=movil shows it in a
 * phone-sized frame (the same page with ?marco=1, so its own layout applies).
 */
export default async function PreviewPropertyPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { vista, marco } = await searchParams;
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
  const demo = phone ? null : await previewDemo(id).catch(() => null);
  if (!phone && !demo) notFound();
  return (
    <div className="pv-root">
      <PreviewBar id={id} published={row.status === "published"} view={phone ? "movil" : "escritorio"} />
      {phone ? (
        <div className="pv-phone">
          <iframe src={`/panel/propiedades/${id}/vista-previa?marco=1`} title="Vista previa en un teléfono" />
        </div>
      ) : (
        <DemoView demo={{ ...demo!, prospect: false }} source={{ kind: "preview" }} />
      )}
    </div>
  );
}
