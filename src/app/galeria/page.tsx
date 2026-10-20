import type { Metadata } from "next";
import { Gallery } from "@/components/gallery";
export const metadata: Metadata = { title: "Galería de transformaciones" };
export default function GalleryPage() {
  return <Gallery />;
}
