import type { MetadataRoute } from "next";
const base = process.env.APP_URL || "https://amoblaia.vercel.app";
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/administracion", "/admin/", "/cuenta", "/auth/"],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
