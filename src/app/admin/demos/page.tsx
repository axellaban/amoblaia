import type { Metadata } from "next";
import { DemoList } from "@/components/admin-demos";
import { requireAdminPage } from "@/lib/demos/admin-page";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Demos comerciales",
  robots: { index: false, follow: false },
};
export default async function DemosPage() {
  await requireAdminPage("/admin/demos");
  return <DemoList />;
}
