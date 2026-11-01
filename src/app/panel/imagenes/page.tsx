import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ImageStudio } from "@/components/image-studio";
import { PanelNav } from "@/components/panel-shell";
import type { Method } from "@/components/agency-images";
import { requirePanelPage } from "@/lib/agency/page";
import { canEdit } from "@/lib/agency/shared";
import { isUuid } from "@/lib/demos/shared";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Estudio de imágenes", robots: { index: false, follow: false } };
const METHODS: Method[] = ["url", "many", "files"];

/**
 * Estudio de imágenes. ?pestana=fotos|url picks the tab; ?fotos=<id> opens
 * that group or property; ?metodo=url|many|files opens that import method.
 */
export default async function ImagesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { membership } = await requirePanelPage("/panel/imagenes");
  // Working photos creates versions: not for viewers, nor for users limited to some properties.
  if (!canEdit(membership.role) || membership.scope) redirect("/panel");
  const { metodo, pestana, fotos } = await searchParams;
  const method = METHODS.find((m) => m === metodo) ?? "url";
  const tab = pestana === "url" || (typeof metodo === "string" && METHODS.includes(metodo as Method)) ? "url" : "fotos";
  return (
    <>
      <PanelNav section="imagenes" agencyName={membership.agency.name} role={membership.role} />
      <div className="account-page container ap-page st-page">
        <ImageStudio initialTab={tab} initialMethod={method} initialId={typeof fotos === "string" && isUuid(fotos) ? fotos : null} />
      </div>
    </>
  );
}
