import type { MetadataRoute } from "next";
const base = process.env.APP_URL || "https://amoblaia.vercel.app";
const pages = ["", "/precios", "/galeria", "/estudio", "/ayuda"];
export default function sitemap(): MetadataRoute.Sitemap {
  return [...pages, "/terminos", "/privacidad"].map((path) => ({
    url: `${base}${path}`,
  }));
}
