import type { NextConfig } from "next";
const posthogHost =
  process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";
const posthogAssets = posthogHost.replace(".i.posthog.com", "-assets.i.posthog.com");
const config: NextConfig = {
  poweredByHeader: false,
  // Required by the PostHog reverse proxy: its API paths end with a slash.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      { source: "/ingest/static/:path*", destination: `${posthogAssets}/static/:path*` },
      { source: "/ingest/array/:path*", destination: `${posthogAssets}/array/:path*` },
      { source: "/ingest/:path*", destination: `${posthogHost}/:path*` },
    ];
  },
  async redirects() {
    const aliases: Record<string, string> = {
      "/app": "/proyectos",
      "/settings": "/cuenta",
      "/affiliate/signup": "/afiliados",
      "/gallery": "/galeria",
      "/prices": "/precios",
      "/login": "/acceso",
      "/refunds": "/reembolsos",
      "/terms-of-service": "/terminos",
      "/privacy-policy": "/privacidad",
      "/affiliate": "/afiliados",
      "/whitelabel": "/marca-blanca",
      "/our-api": "/api",
      "/career": "/trabaja-con-nosotros",
      "/virtual-staging-how-to": "/como-hacer-virtual-staging",
      "/virtual-staging-pricing": "/precios-virtual-staging",
      "/virtual-staging-ai": "/virtual-staging-con-ia",
      "/apartment-staging": "/amoblar-departamentos",
      "/boxbrownie-competitors": "/alternativas-virtual-staging",
      "/interiorai-alternative": "/alternativas-virtual-staging",
      "/license-agreement-disclosure": "/licencia-de-imagenes",
      "/profile-setup": "/cuenta",
      "/checkout": "/precios",
    };
    return Object.entries(aliases).map(([source, destination]) => ({
      source,
      destination,
      permanent: true,
    }));
  },
  async headers() {
    const base = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=()",
      },
    ];
    // Shared showcases are for people with the link, not for search engines.
    const noIndex = { key: "X-Robots-Tag", value: "noindex, nofollow" };
    return [
      {
        // Everything except /embed/ stays unframable.
        source: "/((?!embed/).*)",
        headers: [
          ...base,
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ],
      },
      {
        // Only the showcase embed can live inside an agency's site. It has no
        // account actions. EMBED_FRAME_ANCESTORS can narrow it to known sites.
        source: "/embed/:path*",
        headers: [
          ...base,
          noIndex,
          {
            key: "Content-Security-Policy",
            value: `frame-ancestors ${process.env.EMBED_FRAME_ANCESTORS?.trim() || "*"}`,
          },
        ],
      },
      { source: "/ficha/:path*", headers: [noIndex] },
    ];
  },
};
export default config;
