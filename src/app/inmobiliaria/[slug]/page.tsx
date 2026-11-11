import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { AgencySite } from "@/components/agency-site";
import { SiteAnalytics } from "@/components/site/site-analytics";
import { SiteRenderer } from "@/components/site/site-render";
import { agencyJsonLd, loadSite, pageMetadata, pageOf } from "@/lib/site/public";
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };
const load = cache((slug: string) => loadSite(slug));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const site = await load((await params).slug);
  if (!site) return { title: { absolute: "Inmobiliaria no disponible" }, robots: { index: false, follow: false } };
  const home = site.doc && pageOf(site.doc, "");
  if (home) return pageMetadata(site, home);
  return {
    title: { absolute: `${site.catalog.name} · Propiedades` },
    description: `Propiedades de ${site.catalog.name}. Mirá cada espacio y cómo podría verse amueblado.`,
    // Not indexed while habita is the agency's catalog and not its main site.
    robots: { index: false, follow: true },
  };
}

/** The agency's website: the one built in Sitio web, or its plain catalog until it publishes one. */
export default async function AgencySitePage({ params }: Props) {
  const site = await load((await params).slug);
  if (!site) notFound();
  if (!site.doc) return <AgencySite site={site.catalog} />;
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(agencyJsonLd(site)).replace(/</g, "\\u003c") }} />
      <SiteRenderer doc={site.doc} catalog={site.catalog} pageSlug="" mode="public" />
      <SiteAnalytics doc={site.doc} />
    </>
  );
}
