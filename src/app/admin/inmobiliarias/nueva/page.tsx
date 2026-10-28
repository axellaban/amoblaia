import type { Metadata } from "next";
import { NewAgencyForm } from "@/components/admin-new-agency";
import { requireAdminPage } from "@/lib/demos/admin-page";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Nueva inmobiliaria",
  robots: { index: false, follow: false },
};

/** "Nueva inmobiliaria": the agency's record on its own, without its first property. */
export default async function NewAgencyPage() {
  await requireAdminPage("/admin/inmobiliarias/nueva");
  return <NewAgencyForm />;
}
