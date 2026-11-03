import type { MetadataRoute } from "next";
import { resources, articles } from "@/lib/content";
const base = process.env.APP_URL || "https://www.habitaia.app";
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    "",
    "/precios",
    "/galeria",
    "/estudio",
    "/ayuda",
    "/faq",
    "/blog",
    "/terminos",
    "/privacidad",
    ...resources.map((r) => `/${r.slug}`),
    ...articles.map((a) => `/blog/${a.slug}`),
  ].map((path) => ({ url: `${base}${path}` }));
}
