import type { Metadata } from "next";
import { PhotoBatch } from "@/components/agency-batch";
import { PanelNav } from "@/components/agency-panel";
import { requirePanelPage } from "@/lib/agency/page";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Fotos importadas", robots: { index: false, follow: false } };

/** La bandeja: the agency's photo groups, prepared and staged together. ?grupo=<id> opens that group. */
export default async function BatchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { membership } = await requirePanelPage("/panel/imagenes/lote");
  const { grupo } = await searchParams;
  return (
    <>
      <PanelNav section="imagenes" agencyName={membership.agency.name} role={membership.role} />
      <div className="account-page container ap-page">
        <PhotoBatch initialGroup={typeof grupo === "string" ? grupo : undefined} />
      </div>
    </>
  );
}
