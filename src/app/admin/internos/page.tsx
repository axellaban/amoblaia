import { AdminInternal } from "@/components/admin-internal";
import { requireAdminPage } from "@/lib/demos/admin-page";
export const dynamic = "force-dynamic";

/** The team's people, accounts and devices: what stays out of the commercial metrics. */
export default async function InternalTrafficPage() {
  await requireAdminPage("/admin/internos");
  return <AdminInternal />;
}
