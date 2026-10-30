"use client";
import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { INVITE_URL, pixelSnippet } from "@/lib/meta-pixel-snippet";

// habita. pixel. Public by design, like the Google Ads and PostHog IDs; override per environment if needed.
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
    if (!PIXEL_ID || INVITE_URL.test(window.location.href) || INVITE_URL.test(document.referrer)) return;
    if (first.current) {
      first.current = false;
      return;
    }
    window.fbq?.("track", "PageView");
  }, [pathname]);
  if (!PIXEL_ID || !/^\d+$/.test(PIXEL_ID)) return null;
  return (
    <Script id="meta-pixel" strategy="afterInteractive">
      {pixelSnippet(PIXEL_ID)}
    </Script>
  );
}
