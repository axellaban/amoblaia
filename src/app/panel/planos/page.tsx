import type { Metadata } from "next";
import { FutureFeatureRoute } from "@/components/future-feature-route";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Planos", robots: { index: false, follow: false } };
export default function Page() {
  return <FutureFeatureRoute feature="planos" />;
}
