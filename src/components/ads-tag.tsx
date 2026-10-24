"use client";
import Script from "next/script";
import { usePathname } from "next/navigation";
import { GOOGLE_ADS_ID } from "@/lib/ads";
import { isBareRoute } from "@/lib/routes";
/** Google Ads tag, in production only and never on shared showcases. */
export function AdsTag() {
  const pathname = usePathname();
  if (isBareRoute(pathname)) return null;
  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ADS_ID}`}
        strategy="afterInteractive"
      />
      <Script id="google-ads-tag" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GOOGLE_ADS_ID}');`}
      </Script>
    </>
  );
}
