"use client";
import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

// amoblaIA pixel. Public by design, like the Google Ads and PostHog IDs; override per environment if needed.
// Only production sends events, unless a pixel ID is set explicitly (for example, to test in a preview).
const PIXEL_ID =
  process.env.NEXT_PUBLIC_META_PIXEL_ID ||
  (process.env.NEXT_PUBLIC_VERCEL_ENV === "production" ? "3147699175419885" : undefined);

/** Meta Pixel base code. The inline snippet sends the first PageView; later
 * client-side navigations send their own. */
export function MetaPixel() {
  const pathname = usePathname();
  const first = useRef(true);
  useEffect(() => {
    if (!PIXEL_ID) return;
    if (first.current) {
      first.current = false;
      return;
    }
    window.fbq?.("track", "PageView");
  }, [pathname]);
  if (!PIXEL_ID || !/^\d+$/.test(PIXEL_ID)) return null;
  return (
    <Script id="meta-pixel" strategy="afterInteractive">
      {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init','${PIXEL_ID}');fbq('track','PageView');`}
    </Script>
  );
}
