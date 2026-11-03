import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DemoEditor } from "@/components/demo-editor";
import { PanelNav } from "@/components/agency-panel";
import { requirePanelPage } from "@/lib/agency/page";
import { inScope } from "@/lib/agency/server";
import { demoRow } from "@/lib/demos/server";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Propiedad", robots: { index: false, follow: false } };
export default async function PropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { membership } = await requirePanelPage(`/panel/propiedades/${id}`);
  const demo = await demoRow(id).catch(() => null);
  if (!demo || demo.agency_id !== membership.agency.id || !inScope(membership, demo.property_id)) notFound();
  return (
    <>
      <PanelNav section="propiedades" agencyName={membership.agency.name} role={membership.role} />
      <DemoEditor id={id} mode="agency" />
    </>
  );
}
