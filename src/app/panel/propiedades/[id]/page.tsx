import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DemoEditor } from "@/components/demo-editor";
import { PanelNav } from "@/components/agency-panel";
import { requirePanelPage } from "@/lib/agency/page";
import { inScope, requireDemoRead } from "@/lib/agency/server";
import { demoDetailFor } from "@/lib/demos/detail-view";
import { demoRow } from "@/lib/demos/server";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Propiedad", robots: { index: false, follow: false } };
export default async function PropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { membership } = await requirePanelPage(`/panel/propiedades/${id}`);
  const demo = await demoRow(id).catch(() => null);
  if (!demo || demo.agency_id !== membership.agency.id || !inScope(membership, demo.property_id)) notFound();
  // The property comes with the page (the same answer as GET /api/admin/demos/<id>): on a phone the
  // photos used to appear ~8 s later, after the editor's code loaded and asked for them (UX-005).
  // If it fails here, the editor asks for it as before.
  const initial = await requireDemoRead(id)
    .then((access) => demoDetailFor(access))
    .then((d) => JSON.parse(JSON.stringify(d)))
    .catch(() => null);
  return (
    <>
      <PanelNav section="propiedades" agencyName={membership.agency.name} role={membership.role} tour={!membership.support && !membership.visitor} />
      <DemoEditor id={id} mode="agency" initial={initial} />
    </>
  );
}
