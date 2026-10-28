import type { Metadata } from "next";
import Link from "next/link";
import { ImportImages, type Method } from "@/components/agency-images";
import { PanelNav } from "@/components/agency-panel";
import { requirePanelPage } from "@/lib/agency/page";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Importar imágenes", robots: { index: false, follow: false } };
const METHODS: Method[] = ["url", "many", "files"];

/** Importar imágenes: photos from listings or files, no ficha needed. ?metodo=url|many|files opens that tab. */
export default async function ImagesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { membership } = await requirePanelPage("/panel/imagenes");
  const { metodo } = await searchParams;
  const initial = METHODS.find((m) => m === metodo) ?? "url";
  return (
    <>
      <PanelNav section="inicio" agencyName={membership.agency.name} />
      <div className="account-page container ap-page">
        <p>
          <Link href="/panel" className="text-link">
            ← Volver al inicio
          </Link>
        </p>
        <h1>Importar imágenes</h1>
        <p className="dm-help">Para ambientar y descargar tus fotos. Importar no genera imágenes ni usa créditos.</p>
        <ImportImages initialMethod={initial} />
      </div>
    </>
  );
}
