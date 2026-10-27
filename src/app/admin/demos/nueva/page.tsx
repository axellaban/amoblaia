import type { Metadata } from "next";
import { NewDemoForm } from "@/components/admin-demos";
import { requireAdminPage } from "@/lib/demos/admin-page";
import { isUuid } from "@/lib/demos/shared";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Nueva demo",
  robots: { index: false, follow: false },
};
export default async function NewDemoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage("/admin/demos/nueva");
  const q = await searchParams;
  const agency = typeof q.inmobiliaria === "string" && isUuid(q.inmobiliaria) ? q.inmobiliaria : null;
  // From an agency's row: that agency is preselected (the server validates it again).
  return <NewDemoForm agencyId={agency} />;
}
