import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { DemoView } from "@/components/demo-view";
import { INVITE_PARAM, inviteFor, type DemoInvite } from "@/lib/agency/demo-invite";
import { invitationOf } from "@/lib/agency/invitation";
import { publishedDemo } from "@/lib/demos/server";
import { coverVersion, demoPath, ogImageUrl, PRESENTATION_PARAM } from "@/lib/demos/shared";
import { cloudConfigured } from "@/lib/supabase/config";

// Read on every request: unpublishing or rotating the link takes effect at once.
export const dynamic = "force-dynamic";

const load = cache(async (token: string) => {
  if (!cloudConfigured()) return null;
  try {
    return await publishedDemo(token);
  } catch {
    console.error("demo_page_lookup_failed");
    return null;
  }
});

type Props = {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
/** The link for the agency (?presentacion=1) may show the strip; the plain link is the buyers'. */
const isPresentation = async (searchParams: Props["searchParams"]) =>
  (await searchParams)[PRESENTATION_PARAM] === "1";

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { token } = await params;
  const demo = await load(token);
  const robots = { index: false, follow: false };
  if (!demo) return { title: { absolute: "Propiedad no disponible" }, robots };
  const presentation = await isPresentation(searchParams);
  // The first photo, half original and half in the main style.
  const cover = demo.cover;
  const version = cover ? coverVersion(cover, demo.styles[0]?.id ?? "") : null;
  const title = demo.share.title ?? `${demo.title} · ${demo.agencyName}`;
  const description = presentation
    ? `Demo de ambientación virtual preparada para ${demo.agencyName} por habita.`
    : (demo.share.description ??
      [demo.location, demo.features, demo.price ?? undefined, `Imaginá cada espacio a tu estilo con ${demo.agencyName}.`]
        .filter(Boolean)
        .join(" · "));
  const url = presentation ? `${demoPath(token)}?${PRESENTATION_PARAM}=1` : demoPath(token);
  return {
    // The agency's listing: no "· habita." suffix.
    title: { absolute: title },
    description,
    robots,
    alternates: { canonical: demoPath(token) },
    openGraph: {
      type: "website",
      siteName: demo.agencyName,
      locale: "es_AR",
      url,
      title,
      description,
      images: cover
        ? [
            {
              url: ogImageUrl(token, cover.id, version),
              width: 1200,
              height: 630,
              type: "image/jpeg",
              alt: `${demo.title}: ${version ? "foto original y ambientación ilustrativa con IA" : "foto de la propiedad"}`,
            },
          ]
        : undefined,
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function PublicDemoPage({ params, searchParams }: Props) {
  const { token } = await params;
  const demo = await load(token);
  if (!demo) notFound();
  const presentation = await isPresentation(searchParams);
  // The team's private presentation link may carry the invitation code: only then, and only for this
  // same agency, the demo opens the way into its panel. A failed lookup offers nothing, never a broken promise.
  const raw = (await searchParams)[INVITE_PARAM];
  const code = presentation && demo.prospect && typeof raw === "string" ? raw : null;
  let invite: DemoInvite = null;
  if (code)
    try {
      invite = inviteFor({ token, agencyId: demo.agencyId }, code, await invitationOf(code));
    } catch {
      console.error("demo_invitation_lookup_failed");
    }
  return <DemoView demo={demo} source={{ kind: "public", token }} presentation={presentation} invite={invite} />;
}
