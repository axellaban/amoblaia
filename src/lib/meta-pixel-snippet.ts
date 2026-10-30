/** A page whose URL (or the page it came from) carries a private invitation code: the pixel would send it to Meta, so it does not load there. */
export const INVITE_URL = /[?&#]codigo=/i;

/**
 * Meta Pixel base code, as an inline script. The whole snippet, not only the
 * loader, stays out of pages with an invitation code: calling fbq('init') there
 * threw "fbq is not defined" on every agency demo (QA 29/10/2026).
 */
export function pixelSnippet(pixelId: string) {
  if (!/^\d+$/.test(pixelId)) throw new Error("INVALID_PIXEL_ID");
  return `(function(){if(${INVITE_URL}.test(location.href)||${INVITE_URL}.test(document.referrer))return;
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init','${pixelId}');fbq('track','PageView');})();`;
}
