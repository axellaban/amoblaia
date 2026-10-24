import type { MetadataRoute } from "next";
const base = process.env.APP_URL || "https://amoblaia.vercel.app";
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Shared showcases stay crawlable for link previews; their pages say noindex.
      disallow: ["/api/", "/administracion", "/cuenta", "/auth/", "/fichas", "/embed/"],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
