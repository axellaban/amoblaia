import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FutureFeatureRoute } from "@/components/future-feature-route";
import { videoEnabled } from "@/lib/agency/flags";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Video", robots: { index: false, follow: false } };

/**
 * Video (spec §6). Until the video engine is live (Fase 5) this page says so
 * plainly and records interest, like the other upcoming tools; production
 * does not show it unless NEXT_PUBLIC_HABITA_VIDEO=1.
 */
export default function Page() {
  if (!videoEnabled()) notFound();
  return <FutureFeatureRoute feature="video" />;
}
