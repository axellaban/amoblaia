import { redirect } from "next/navigation";
import { requireAdminPage } from "@/lib/demos/admin-page";
export const dynamic = "force-dynamic";
export default async function AdminHome() {
  // Agencies are the team's entry point; demos stay at /admin/demos.
  await requireAdminPage("/admin/inmobiliarias");
  redirect("/admin/inmobiliarias");
}
