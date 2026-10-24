import { cache } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { loadPublicShowcase } from "@/lib/showcase";
import { imagePath, type ShowcaseOrigin } from "@/lib/showcase-shared";
import { ShowcaseViewer } from "./showcase-viewer";

/** One lookup per request, shared by the metadata and the page. */
export const loadShowcase = cache(async (token: string) => {
  try {
    return { data: await loadPublicShowcase(token), failed: false };
  } catch {
    console.error("showcase_page_failed");
    return { data: null, failed: true };
  }
});

export async function showcaseMetadata(token: string): Promise<Metadata> {
  const { data } = await loadShowcase(token);
  const robots = { index: false, follow: false };
  if (!data) return { title: "Ficha no disponible", robots };
  const description =
    "Estado actual de la propiedad y propuestas de ambientación virtual.";
  const first = data.rooms[0];
  return {
    title: { absolute: data.title },
    description,
    robots,
    openGraph: {
      title: data.title,
      description,
      // The preview shows the real photo, never a staged one.
      images: first
        ? [imagePath(token, { kind: "original", id: first.id })]
        : undefined,
    },
  };
}

export async function ShowcasePage({
  token,
  origin,
}: {
  token: string;
  origin: ShowcaseOrigin;
}) {
  const { data, failed } = await loadShowcase(token);
  if (failed)
    return (
      <div className={`sc sc-${origin}`}>
        <div className="sc-unavailable" role="alert">
          <h1>No pudimos abrir la ficha</h1>
          <p>Hubo un problema momentáneo. Actualizá la página en unos minutos.</p>
        </div>
      </div>
    );
  if (!data) notFound();
  return <ShowcaseViewer data={data} token={token} origin={origin} />;
}

export function ShowcaseUnavailable() {
  return (
    <div className="sc">
      <div className="sc-unavailable">
        <h1>Esta ficha no está disponible</h1>
        <p>
          El enlace puede estar desactivado o incompleto. Consultá a la
          inmobiliaria que te lo compartió.
        </p>
      </div>
    </div>
  );
}
