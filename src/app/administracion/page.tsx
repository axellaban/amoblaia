import type { Metadata } from "next";
import { AdminDashboard } from "@/components/admin";
export const metadata: Metadata = {
  title: "Administración",
  robots: { index: false, follow: false },
};
export default function Admin() {
  return <AdminDashboard />;
}
