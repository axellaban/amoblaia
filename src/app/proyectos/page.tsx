import type { Metadata } from "next";
import { ProjectLibrary } from "@/components/project-library";
export const metadata: Metadata = {
  title: "Mis fotos",
  robots: { index: false, follow: false },
};
export default function Projects() {
  return <ProjectLibrary />;
}
