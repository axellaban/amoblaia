import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { DemoView } from "@/components/demo-view";
import { publishedDemo } from "@/lib/demos/server";
import { coverVersion, demoPath, ogImageUrl } from "@/lib/demos/shared";
import { cloudConfigured } from "@/lib/supabase/config";

// Read on every request: unpublishing or rotating the link takes effect at once.
export const dynamic = "force-dynamic";

const load = cache(async (token: string) => {
  if (!cloudConfigured()) return null;
  try {
    return await publishedDemo(token);
  } catch {
    console.error("demo_page_lookup_failed");
    return null;
  }
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const demo = await load(token);
  const robots = { index: false, follow: false };
  if (!demo) return { title: "Demo no disponible", robots };
  // The first photo, half original and half in the main style.
  const cover = demo.cover;
  const version = cover ? coverVersion(cover, demo.styles[0]?.id ?? "") : null;
  const title = `${demo.agencyName} · ${demo.title}`;
  const description = `Mirá cómo podría verse esta propiedad${
    demo.location ? ` en ${demo.location}` : ""
  } con ambientación virtual con IA. Una muestra preparada por amoblaIA para ${demo.agencyName}.`;
  return {
    title,
    description,
    robots,
    alternates: { canonical: demoPath(token) },
    openGraph: {
      type: "website",
      siteName: "amoblaIA",
      locale: "es_AR",
      url: demoPath(token),
      title,
      description,
      images: cover
        ? [
            {
              url: ogImageUrl(token, cover.id, version),
              width: 1200,
              height: 630,
              type: "image/jpeg",
              alt: `${demo.title}: ${version ? "foto original y ambientación virtual con IA" : "foto de la propiedad"}`,
            },
          ]
        : undefined,
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function PublicDemoPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const demo = await load(token);
  if (!demo) notFound();
  return <DemoView demo={demo} source={{ kind: "public", token }} />;
}
