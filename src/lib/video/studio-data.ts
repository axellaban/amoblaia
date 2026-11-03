// What «Crear video» needs for one property or photo group, on the server:
// its photos (whole), the information the video may carry (only what its
// ficha shows: hidden fields never reach a video), where its demo shows the
// video and whether it is published. Shared by the agency's panel and the
// team's administrative edit, so both open the same studio with the same data.
import "server-only";
import type { VideoPlacement } from "@/lib/demos/branding";
import { previewDemo, settingsOf } from "@/lib/demos/server";
import type { PublicDemo } from "@/lib/demos/shared";
import type { InfoSource } from "./plan";

export type StudioData = {
  demo: PublicDemo;
  info: InfoSource;
  kind: "ficha" | "fotos";
  published: boolean;
  placement: VideoPlacement;
};

/** Null when the property cannot be read (the caller answers «not found»). Access is checked by the caller. */
export async function studioData(row: { id: string; kind: string; status: string }): Promise<StudioData | null> {
  const kind = row.kind === "fotos" ? "fotos" : "ficha";
  const [raw, visible, stored] = await Promise.all([
    previewDemo(row.id, { raw: true }).catch(() => null),
    previewDemo(row.id).catch(() => null),
    settingsOf(row.id).catch(() => null),
  ]);
  if (!raw || !visible) return null;
  const ficha = kind === "ficha";
  return {
    demo: raw,
    kind,
    published: row.status === "published",
    placement: stored?.settings.videoPlacement ?? "below",
    info: {
      title: ficha ? visible.title : null,
      location: ficha ? visible.location : null,
      price: ficha ? visible.price : null,
      priceFallback: `Consultar ${/alquiler/i.test(visible.operation ?? "") ? "alquiler" : "precio"}`,
      operation: ficha ? visible.operation : null,
      facts: ficha ? visible.facts.map((f) => `${f.value} ${f.label}`.trim()).filter(Boolean) : [],
      agencyName: visible.agencyName || null,
      logo: Boolean(visible.agency.logo),
      contact: visible.contact.whatsapp ?? visible.contact.phone ?? visible.contact.email ?? null,
    },
  };
}
