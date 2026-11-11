import type { Metadata } from "next";
import Link from "next/link";
import { AgencySite } from "@/components/agency-site";
import { SiteRenderer } from "@/components/site/site-render";
import { requirePanelPage } from "@/lib/agency/page";
import { agencyCatalog } from "@/lib/agency/site";
import { siteDocFor } from "@/lib/site/server";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Vista previa de mi sitio", robots: { index: false, follow: false } };

/** The agency's site as it will look (the editor's draft), for its members, whether or not it is public yet. */
export default async function SitePreviewPage({ searchParams }: { searchParams: Promise<{ pagina?: string }> }) {
  const { membership } = await requirePanelPage("/panel/sitio/vista-previa");
  const { pagina = "" } = await searchParams;
  const a = membership.agency;
  const catalog = await agencyCatalog(a.id);
  const doc = catalog ? await siteDocFor(a.id, catalog.name, catalog.website, true).catch(() => null) : null;
  const site = catalog ? { ...catalog, logo: catalog.logo ? catalog.logo.replace(/^\/inmobiliaria\/[^/]+\/logo/, "/api/panel/logo") : null } : null;
  return (
    <>
      <div className="demo-preview-bar" role="status">
        <div className="container">
          <span>
            Vista previa de tu sitio · {a.site_published ? "lo publicado lo ven tus clientes; esto muestra también los cambios sin publicar." : "todavía no es público: solo lo ves vos."}
          </span>
          <span className="demo-preview-actions">
            <Link href="/panel/sitio" className="button button-small button-light">
              Volver al editor
            </Link>
          </span>
        </div>
      </div>
      {site && doc ? (
        <SiteRenderer doc={doc} catalog={site} pageSlug={typeof pagina === "string" ? pagina : ""} mode="preview" />
      ) : site && a.slug ? (
        <AgencySite site={site} preview />
      ) : (
        <div className="account-page container">
          <p>Armá tu sitio en «Sitio web» para verlo.</p>
        </div>
      )}
    </>
  );
}
