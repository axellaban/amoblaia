import type { Metadata } from "next";
import { LeadsApp } from "@/components/admin-leads";
import { requireAdminPage } from "@/lib/demos/admin-page";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Leads",
  robots: { index: false, follow: false },
};

/** Leads / Engagement: agencies ranked by lead_score_v1. Data comes from the admin API, checked on every request. */
export default async function LeadsPage() {
  await requireAdminPage("/admin/leads");
  return <LeadsApp />;
}
