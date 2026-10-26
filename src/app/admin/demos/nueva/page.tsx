import type { Metadata } from "next";
import { NewDemoForm } from "@/components/admin-demos";
import { requireAdminPage } from "@/lib/demos/admin-page";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Nueva demo",
  robots: { index: false, follow: false },
};
export default async function NewDemoPage() {
  await requireAdminPage("/admin/demos/nueva");
  return <NewDemoForm />;
}
