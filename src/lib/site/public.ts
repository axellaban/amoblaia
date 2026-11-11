import "server-only";
import type { Metadata } from "next";
import { publicSite, type PublicSite } from "@/lib/agency/site";
import { cloudConfigured } from "@/lib/supabase/config";
import { PAGE_SLUG, type SiteDoc, type SitePage } from "./schema";
import { siteDocFor } from "./server";

export type LoadedSite = { catalog: PublicSite; doc: SiteDoc | null };

/** A published site (or, with preview, the members' look at the draft). Null: no such site. */
export async function loadSite(slug: string, preview = false): Promise<LoadedSite | null> {
  if (!cloudConfigured()) return null;
  try {
    const catalog = await publicSite(slug, { preview });
    if (!catalog) return null;
    const doc = await siteDocFor(catalog.agencyId, catalog.name, catalog.website, preview).catch(() => null);
    return { catalog, doc };
  } catch {
    console.error("site_lookup_failed");
    return null;
  }
}

/** A page of the built site by its address; property links (20+ characters) never match. */
export const pageOf = (doc: SiteDoc, slug: string): SitePage | null => (slug === "" || PAGE_SLUG.test(slug) ? (doc.pages.find((p) => p.slug === slug) ?? null) : null);

export function pageMetadata(site: LoadedSite, page: SitePage): Metadata {
  const { catalog, doc } = site;
  const st = doc!.settings;
  const home = page.slug === "";
  const title = page.seoTitle || (home ? st.seoTitle || `${catalog.name} · Propiedades` : `${page.title} · ${catalog.name}`);
  const description = page.seoDescription || st.seoDescription || `Propiedades en venta y alquiler de ${catalog.name}.`;
  const image = st.shareImage || catalog.properties.find((p) => p.cover)?.cover || undefined;
  return {
    title: { absolute: title },
    description,
    robots: st.indexable ? { index: true, follow: true } : { index: false, follow: true },
    alternates: { canonical: home ? `/inmobiliaria/${catalog.slug}` : `/inmobiliaria/${catalog.slug}/${page.slug}` },
    openGraph: { title, description, siteName: catalog.name, type: "website", locale: "es_AR", ...(image ? { images: [{ url: image }] } : {}) },
    ...(catalog.logo ? { icons: { icon: catalog.logo } } : {}),
  };
}

/** schema.org data for search engines: the agency as a real-estate business. */
export function agencyJsonLd(site: LoadedSite) {
  const { catalog, doc } = site;
  const st = doc!.settings;
  const sameAs = [st.instagram, st.facebook, st.linkedin, st.youtube, st.tiktok].filter(Boolean);
  return {
    "@context": "https://schema.org",
    "@type": "RealEstateAgent",
    name: catalog.name,
    ...(st.tagline ? { description: st.tagline } : {}),
    ...(st.phone ? { telephone: st.phone } : {}),
    ...(st.email ? { email: st.email } : {}),
    ...(st.address ? { address: st.address } : {}),
    ...(st.hours ? { openingHours: st.hours } : {}),
    ...(sameAs.length ? { sameAs } : {}),
  };
}
