import Script from "next/script";
import type { SiteDoc } from "@/lib/site/schema";

/** The agency's own Google Analytics and Meta Pixel on its published site. Ids are validated (schema.ts). */
export function SiteAnalytics({ doc }: { doc: SiteDoc }) {
  const { ga4, metaPixel } = doc.settings;
  return (
    <>
      {ga4 && /^G-[A-Z0-9]{4,14}$/.test(ga4) && (
        <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${ga4}`} strategy="afterInteractive" />
          <Script id="site-ga4" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${ga4}');`}
          </Script>
        </>
      )}
      {metaPixel && /^\d{6,20}$/.test(metaPixel) && (
        <Script id="site-meta-pixel" strategy="afterInteractive">
          {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${metaPixel}');fbq('trackSingle','${metaPixel}','PageView');`}
        </Script>
      )}
    </>
  );
}
