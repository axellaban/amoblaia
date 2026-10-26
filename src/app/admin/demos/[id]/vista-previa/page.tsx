import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DemoView } from "@/components/demo-view";
import { requireAdminPage } from "@/lib/demos/admin-page";
import { demoRow, previewDemo } from "@/lib/demos/server";
import { PRESENTATION_PARAM } from "@/lib/demos/shared";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Vista previa de la demo",
  robots: { index: false, follow: false },
};
/** Exactly the public page, drafts included, with images from the admin route. */
export default async function PreviewDemoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const presentation = (await searchParams)[PRESENTATION_PARAM] === "1";
  await requireAdminPage(`/admin/demos/${id}/vista-previa`);
  const [row, demo] = await Promise.all([
    demoRow(id).catch(() => null),
    previewDemo(id).catch(() => null),
  ]);
  if (!row || !demo) notFound();
  return (
    <>
      <div className="demo-preview-bar" role="status">
        <div className="container">
          <span>
            Vista previa {presentation ? "de la presentación" : "del comprador"} ·{" "}
            {row.status === "published"
              ? "publicada: así la ve la inmobiliaria."
              : "borrador: todavía no es pública."}
          </span>
          <span className="demo-preview-actions">
            <Link
              href={presentation ? `/admin/demos/${id}/vista-previa` : `/admin/demos/${id}/vista-previa?${PRESENTATION_PARAM}=1`}
              className="button button-small button-light"
            >
              {presentation ? "Ver como comprador" : "Ver como presentación"}
            </Link>
            <Link href={`/admin/demos/${id}`} className="button button-small button-light">
              Volver al editor
            </Link>
          </span>
        </div>
      </div>
      <DemoView demo={demo} source={{ kind: "preview" }} presentation={presentation} />
    </>
  );
}
