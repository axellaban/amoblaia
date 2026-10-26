import { redirect } from "next/navigation";
import { requireAdminPage } from "@/lib/demos/admin-page";
export const dynamic = "force-dynamic";
export default async function AdminHome() {
  await requireAdminPage("/admin/demos");
  redirect("/admin/demos");
}
