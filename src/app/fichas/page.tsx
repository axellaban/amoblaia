import type { Metadata } from "next";
import { ShowcaseManager } from "@/components/showcase-manager";
export const metadata: Metadata = {
  title: "Fichas de propiedades",
  robots: { index: false, follow: false },
};
export default function Showcases() {
  return <ShowcaseManager />;
}
