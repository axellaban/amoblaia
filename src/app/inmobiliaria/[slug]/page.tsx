import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { AgencySite } from "@/components/agency-site";
import { publicSite } from "@/lib/agency/site";
import { cloudConfigured } from "@/lib/supabase/config";
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };
const load = cache(async (slug: string) => {
  if (!cloudConfigured()) return null;
  try {
    return await publicSite(slug);
  } catch {
    console.error("site_lookup_failed");
    return null;
  }
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const site = await load((await params).slug);
  if (!site) return { title: { absolute: "Inmobiliaria no disponible" }, robots: { index: false, follow: false } };
  return {
    title: { absolute: `${site.name} · Propiedades` },
    description: `Propiedades de ${site.name}. Mirá cada espacio y cómo podría verse amueblado.`,
    // Not indexed while habita is the agency's catalog and not its main site.
    robots: { index: false, follow: true },
  };
}

export default async function AgencySitePage({ params }: Props) {
  const site = await load((await params).slug);
  if (!site) notFound();
  return <AgencySite site={site} />;
}
