import type { Metadata } from "next";
import { Suspense } from "react";
import { Studio } from "@/components/studio";
export const metadata: Metadata = {
  title: "Estudio de diseño",
  robots: { index: false, follow: false },
};
export default function StudioPage() {
  return (
    <Suspense
      fallback={
        <div
          className="container"
          style={{ paddingTop: 80, paddingBottom: 80 }}
        >
          Preparando tu estudio…
        </div>
      }
    >
      <Studio />
    </Suspense>
  );
}
