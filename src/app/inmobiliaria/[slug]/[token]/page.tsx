import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { DemoView } from "@/components/demo-view";
import { SiteAnalytics } from "@/components/site/site-analytics";
import { SiteRenderer } from "@/components/site/site-render";
import { loadSite, pageMetadata, pageOf } from "@/lib/site/public";
import { publicSite } from "@/lib/agency/site";
import { publishedDemo } from "@/lib/demos/server";
import { cloudConfigured } from "@/lib/supabase/config";
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string; token: string }> };
/** A published property of a published site: the same page as its shared link, inside the agency's site. */
const load = cache(async (slug: string, token: string) => {
  if (!cloudConfigured()) return null;
  try {
    const [site, demo] = await Promise.all([publicSite(slug), publishedDemo(token)]);
    return site && demo && demo.agencyId === site.agencyId ? { site, demo } : null;
  } catch {
    console.error("site_property_lookup_failed");
    return null;
  }
});

/** A page of the site built in Sitio web (/inmobiliaria/<site>/nosotros); property links never match one. */
const loadPage = cache(async (slug: string, page: string) => {
  if (!/^[a-z0-9-]{2,19}$/.test(page)) return null;
  const site = await loadSite(slug);
  const found = site?.doc ? pageOf(site.doc, page) : null;
  return site && found ? { site, page: found } : null;
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, token } = await params;
  const sitePage = await loadPage(slug, token);
  if (sitePage) return pageMetadata(sitePage.site, sitePage.page);
  const found = await load(slug, token);
  if (!found) return { title: { absolute: "Propiedad no disponible" }, robots: { index: false, follow: false } };
  return {
    title: { absolute: `${found.demo.title} · ${found.site.name}` },
    description: [found.demo.location, found.demo.features, found.demo.price].filter(Boolean).join(" · ") || undefined,
    robots: { index: false, follow: true },
    alternates: { canonical: `/demo/${token}` },
  };
}

export default async function SitePropertyPage({ params }: Props) {
  const { slug, token } = await params;
  const sitePage = await loadPage(slug, token);
  if (sitePage?.site.doc)
    return (
      <>
        <SiteRenderer doc={sitePage.site.doc} catalog={sitePage.site.catalog} pageSlug={sitePage.page.slug} mode="public" />
        <SiteAnalytics doc={sitePage.site.doc} />
      </>
    );
  const found = await load(slug, token);
  if (!found) {
    // A link shared from the catalog keeps working after the catalog moves or is unpublished: the ficha is still public.
    const demo = cloudConfigured() ? await publishedDemo(token).catch(() => null) : null;
    if (demo) redirect(`/demo/${encodeURIComponent(token)}`);
    notFound();
  }
  return (
    <>
      <div className="as-back">
        <div className="container">
          <Link href={`/inmobiliaria/${slug}`}>← Todas las propiedades de {found.site.name}</Link>
        </div>
      </div>
      <DemoView demo={{ ...found.demo, prospect: false }} source={{ kind: "public", token }} />
    </>
  );
}
