import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DemoView } from "@/components/demo-view";
import { requirePanelPage } from "@/lib/agency/page";
import { demoRow, previewDemo } from "@/lib/demos/server";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Vista previa de la ficha", robots: { index: false, follow: false } };
/** Exactly the public page, drafts included, with images from the panel's route. */
export default async function PreviewPropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { membership } = await requirePanelPage(`/panel/propiedades/${id}/vista-previa`);
  const row = await demoRow(id).catch(() => null);
  if (!row || row.agency_id !== membership.agency.id) notFound();
  const demo = await previewDemo(id).catch(() => null);
  if (!demo) notFound();
  return (
    <>
      <div className="demo-preview-bar" role="status">
        <div className="container">
          <span>
            Vista previa ·{" "}
            {row.status === "published" ? "publicada: así la ven tus clientes." : "borrador: todavía no es pública."}
          </span>
          <span className="demo-preview-actions">
            <Link href={`/panel/propiedades/${id}`} className="button button-small button-light">
              Volver a la propiedad
            </Link>
          </span>
        </div>
      </div>
      <DemoView demo={{ ...demo, prospect: false }} source={{ kind: "preview" }} />
    </>
  );
}
