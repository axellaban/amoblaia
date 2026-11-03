/** Screen names for analytics, kept apart so the PostHog setup can use them without loading the click tracking. */

/** Where the click was: one value per area of the product, for every event of this module. */
export function surfaceOf(pathname: string) {
  if (pathname.startsWith("/demo/")) return "demo";
  if (/^\/inmobiliaria\/[^/]+\/[^/]+/.test(pathname)) return "agency_site_property";
  if (pathname.startsWith("/inmobiliaria/")) return "agency_site";
  if (pathname.startsWith("/panel/empezar")) return "signup";
  if (pathname.startsWith("/panel")) return "panel";
  if (pathname.startsWith("/precios")) return "pricing";
  if (pathname.startsWith("/acceso")) return "auth";
  if (pathname.startsWith("/admin")) return "admin";
  if (pathname.startsWith("/p/")) return "short_link";
  if (pathname === "/") return "home";
  return "other";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A segment that is an id, a token or a code rather than a page name. */
const isOpaque = (seg: string) => UUID.test(seg) || /^\d+$/.test(seg) || (seg.length >= 12 && /\d/.test(seg) && !seg.includes("-"));

/**
 * The page as a template, the same for every property, demo or agency:
 * `/demo/:token/presentacion/:code/precios`, `/panel/propiedades/:id`… It
 * groups clicks and views by screen in PostHog (heatmaps, breakdowns), and
 * never carries a token, an invitation code or an agency's slug.
 */
export function routeOf(pathname: string): string {
  const segs = pathname.split(/[?#]/)[0].split("/").filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const prev = out[i - 1];
    if (prev === "demo" || prev === "p") out.push(":token");
    else if (prev === "presentacion") out.push(":code");
    else if (out[0] === "inmobiliaria" && i === 1) out.push(":slug");
    else if (out[0] === "inmobiliaria" && i === 2) out.push(":token");
    else if (prev === "propiedades" || prev === "proyectos" || isOpaque(seg)) out.push(":id");
    else out.push(seg.slice(0, 40));
  }
  return "/" + out.join("/");
}
