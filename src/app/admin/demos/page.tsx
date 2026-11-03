import { redirect } from "next/navigation";
import { requireAdminPage } from "@/lib/demos/admin-page";
export const dynamic = "force-dynamic";

/** Demos now live inside each agency («Propiedades y demos»): the old list leads to «Inmobiliarias». */
export default async function DemosPage() {
  await requireAdminPage("/admin/demos");
  redirect("/admin/inmobiliarias");
}
