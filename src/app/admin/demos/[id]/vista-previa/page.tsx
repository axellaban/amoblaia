import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DemoView } from "@/components/demo-view";
import { requireAdminPage } from "@/lib/demos/admin-page";
import { demoRow, previewDemo } from "@/lib/demos/server";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Vista previa de la demo",
  robots: { index: false, follow: false },
};
/** Exactly the public page, drafts included, with images from the admin route. */
export default async function PreviewDemoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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
            Vista previa ·{" "}
            {row.status === "published"
              ? "publicada: así la ve la inmobiliaria."
              : "borrador: todavía no es pública."}
          </span>
          <Link href={`/admin/demos/${id}`} className="button button-small button-light">
            Volver al editor
          </Link>
        </div>
      </div>
      <DemoView demo={demo} source={{ kind: "preview" }} />
    </>
  );
}
