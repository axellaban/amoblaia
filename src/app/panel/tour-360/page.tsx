import type { Metadata } from "next";
import { FutureFeatureRoute } from "@/components/future-feature-route";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Tour 360", robots: { index: false, follow: false } };
export default function Page() {
  return <FutureFeatureRoute feature="tour_360" />;
}
