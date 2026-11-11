import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { DemoView } from "@/components/demo-view";
import { SiteAnalytics } from "@/components/site/site-analytics";
import { SiteChrome, SiteRenderer } from "@/components/site/site-render";
import { publishedDemo } from "@/lib/demos/server";
import { loadSite, pageMetadata, pageOf } from "@/lib/site/public";
import { cloudConfigured } from "@/lib/supabase/config";
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string; token: string }> };
/**
 * Inside a published site: one of its pages (/inmobiliaria/<site>/nosotros)
 * or one of its published properties (/inmobiliaria/<site>/<token>), the
 * same page as its shared link with the site's header and footer.
 */
const load = cache(async (slug: string, token: string) => {
  const site = await loadSite(slug);
  if (!site) return null;
  const page = site.doc ? pageOf(site.doc, token) : null;
  if (page) return { site, page, demo: null };
  try {
    const demo = await publishedDemo(token);
    return demo && demo.agencyId === site.catalog.agencyId ? { site, page: null, demo } : null;
  } catch {
    console.error("site_property_lookup_failed");
    return null;
  }
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, token } = await params;
  const found = await load(slug, token);
  if (!found) return { title: { absolute: "Página no disponible" }, robots: { index: false, follow: false } };
  if (found.page) return pageMetadata(found.site, found.page);
  const demo = found.demo!;
  return {
    title: { absolute: `${demo.title} · ${found.site.catalog.name}` },
    description: [demo.location, demo.features, demo.price].filter(Boolean).join(" · ") || undefined,
    robots: { index: false, follow: true },
    alternates: { canonical: `/demo/${token}` },
  };
}

export default async function SiteInnerPage({ params }: Props) {
  const { slug, token } = await params;
  const found = await load(slug, token);
  if (!found) {
    // A link shared from the catalog keeps working after the catalog moves or is unpublished: the ficha is still public.
    const demo = cloudConfigured() && /^[A-Za-z0-9_-]{20,64}$/.test(token) ? await publishedDemo(token).catch(() => null) : null;
    if (demo) redirect(`/demo/${encodeURIComponent(token)}`);
    notFound();
  }
  const { site, page, demo } = found;
  if (page && site.doc)
    return (
      <>
        <SiteRenderer doc={site.doc} catalog={site.catalog} pageSlug={page.slug} mode="public" />
        <SiteAnalytics doc={site.doc} />
      </>
    );
  const view = <DemoView demo={{ ...demo!, prospect: false }} source={{ kind: "public", token }} embedded={Boolean(site.doc)} />;
  if (site.doc)
    return (
      <>
        <SiteChrome doc={site.doc} catalog={site.catalog} mode="public">
          {view}
        </SiteChrome>
        <SiteAnalytics doc={site.doc} />
      </>
    );
  return (
    <>
      <div className="as-back">
        <div className="container">
          <Link href={`/inmobiliaria/${slug}`}>← Todas las propiedades de {site.catalog.name}</Link>
        </div>
      </div>
      {view}
    </>
  );
}
