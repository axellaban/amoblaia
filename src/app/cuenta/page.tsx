import type { Metadata } from "next";
import { AccountDashboard } from "@/components/account";
export const metadata: Metadata = {
  title: "Mi cuenta",
  robots: { index: false, follow: false },
};
export default function Account() {
  return <AccountDashboard />;
}
