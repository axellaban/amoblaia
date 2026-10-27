import type { Metadata } from "next";
import Link from "next/link";
import { AgencySite } from "@/components/agency-site";
import { requirePanelPage } from "@/lib/agency/page";
import { publicSite } from "@/lib/agency/site";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Vista previa de mi sitio", robots: { index: false, follow: false } };

/** The agency's catalog as it will look, for its members, whether or not it is public yet. */
export default async function SitePreviewPage() {
  const { membership } = await requirePanelPage("/panel/sitio/vista-previa");
  const slug = membership.agency.slug;
  const site = slug ? await publicSite(slug, { preview: true }) : null;
  return (
    <>
      <div className="demo-preview-bar" role="status">
        <div className="container">
          <span>
            Vista previa de tu catálogo ·{" "}
            {membership.agency.site_published ? "publicado: así lo ven tus clientes." : "todavía no es público: solo lo ves vos."}
          </span>
          <span className="demo-preview-actions">
            <Link href="/panel/sitio" className="button button-small button-light">
              Volver a Mi sitio web
            </Link>
          </span>
        </div>
      </div>
      {site ? (
        <AgencySite site={{ ...site, logo: site.logo ? site.logo.replace(/^\/inmobiliaria\/[^/]+\/logo/, "/api/panel/logo") : null }} preview />
      ) : (
        <div className="account-page container">
          <p>Elegí la dirección de tu catálogo en «Mi sitio web» para verlo.</p>
        </div>
      )}
    </>
  );
}
