import type { Metadata } from "next";
import { DemoEditor } from "@/components/demo-editor";
import { requireAdminPage } from "@/lib/demos/admin-page";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Editar demo",
  robots: { index: false, follow: false },
};
export default async function EditDemoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireAdminPage(`/admin/demos/${id}`);
  return <DemoEditor id={id} />;
}
