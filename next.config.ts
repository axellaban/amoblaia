import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
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
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};
export default config;
