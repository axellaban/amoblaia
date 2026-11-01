import type { Metadata } from "next";
import Link from "next/link";
import { ImportImages, type Method } from "@/components/agency-images";
import { PanelNav } from "@/components/agency-panel";
import { redirect } from "next/navigation";
import { requirePanelPage } from "@/lib/agency/page";
import { canEdit } from "@/lib/agency/shared";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Estudio de imágenes", robots: { index: false, follow: false } };
const METHODS: Method[] = ["url", "many", "files"];

/** Importar imágenes: photos from listings or files, no ficha needed. ?metodo=url|many|files opens that tab. */
export default async function ImagesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { membership } = await requirePanelPage("/panel/imagenes");
  // Importing creates photo groups: not for viewers, nor for users limited to some properties.
  if (!canEdit(membership.role) || membership.scope) redirect("/panel");
  const { metodo } = await searchParams;
  const initial = METHODS.find((m) => m === metodo) ?? "url";
  return (
    <>
      <PanelNav section="imagenes" agencyName={membership.agency.name} role={membership.role} />
      <div className="account-page container ap-page">
        <p>
          <Link href="/panel" className="text-link">
            ← Volver al inicio
          </Link>
        </p>
        <h1>Estudio de imágenes</h1>
        <p className="dm-help">Traé fotos desde una publicación o subilas para mejorarlas, ambientarlas, quitar muebles y descargarlas. Importar no genera imágenes ni usa créditos.</p>
        <ImportImages initialMethod={initial} />
      </div>
    </>
  );
}
