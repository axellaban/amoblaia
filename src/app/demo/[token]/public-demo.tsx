import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { DemoView } from "@/components/demo-view";
import { PricingPlans } from "@/components/pricing";
import { buyerViewPath, inviteFor, presentationPath, pricesViewPath, type DemoInvite } from "@/lib/agency/demo-invite";
import { invitationOf } from "@/lib/agency/invitation";
import { publishedDemo } from "@/lib/demos/server";
import { coverVersion, demoPath, ogImageUrl, stageWidth } from "@/lib/demos/shared";
import type { Product } from "@/lib/commerce/catalog";
import { cloudConfigured } from "@/lib/supabase/config";
import { adminClient } from "@/lib/supabase/server";

// Shared by the buyers' page (/demo/<token>) and the agency's presentation
// (/demo/<token>/presentacion[/<codigo>][/ficha], or its short link
// /p/<propiedad>-<codigo>[/ficha]). Read on every request.
export const load = cache(async (token: string, withPending = false) => {
  if (!cloudConfigured()) return null;
  try {
    return await publishedDemo(token, { withPending });
  } catch {
    console.error("demo_page_lookup_failed");
    return null;
  }
});

export async function publicDemoMetadata(token: string, presentation: boolean): Promise<Metadata> {
  const demo = await load(token);
  const robots = { index: false, follow: false };
  if (!demo) return { title: { absolute: "Propiedad no disponible" }, robots };
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
  const url = presentation ? `${demoPath(token)}/presentacion` : demoPath(token);
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

/** The plans of /precios, as they are: the same catalog and the same component, without buying here. */
async function plansOf(signupHref: string) {
  let products: Product[] = [];
  if (cloudConfigured()) {
    try {
      const { data } = await adminClient().from("products").select("*");
      products = (data || []) as Product[];
    } catch {
      /* Plans stay unavailable when the catalog cannot be loaded, as on /precios. */
    }
  }
  return (
    <PricingPlans
      products={products}
      enabled={false}
      trial={false}
      renderedAt={Date.now()}
      signupHref={signupHref}
    />
  );
}

/**
 * The demo page. `presentation` is the agency's link (it may show the strip);
 * `code` is its invitation, only honored there and for an agency's own demo;
 * `ficha` shows the buyers' page to the agency, still with the way into its panel;
 * `prices` opens its plans under the agency's bar (only there: otherwise, the demo).
 */
export async function PublicDemo({
  token,
  presentation,
  code,
  ficha,
  prices = false,
  shortPath = null,
}: {
  token: string;
  presentation: boolean;
  code: string | null;
  ficha: boolean;
  prices?: boolean;
  /** Opened from its short link (/p/<propiedad>-<codigo>): the agency keeps moving under it. */
  shortPath?: string | null;
}) {
  const demo = await load(token);
  if (!demo) notFound();
  const invitation = presentation && demo.prospect && code ? code : null;
  let invite: DemoInvite = null;
  if (invitation)
    try {
      invite = inviteFor({ token, agencyId: demo.agencyId }, invitation, await invitationOf(invitation));
    } catch {
      console.error("demo_invitation_lookup_failed");
    }
  const ownView = Boolean(invitation && invite && "href" in invite && !ficha);
  // The agency's own demo also shows the images it generated there before approving them (buyers never do).
  const shown = ownView ? ((await load(token, true)) ?? demo) : demo;
  const owner =
    ownView && invitation && invite && "href" in invite
      ? {
          code: invitation,
          href: invite.href,
          panelHref: invite.panelHref,
          freeCredits: invite.freeCredits,
          buyerHref: shortPath ? `${shortPath}/ficha` : buyerViewPath(token, invitation),
          demoHref: shortPath ?? presentationPath(token, invitation),
          pricesHref: shortPath ? `${shortPath}/precios` : pricesViewPath(token, invitation),
        }
      : null;
  // "Ver como comprador": the buyers' page, with only the way back to the agency's demo.
  const backToDemo = invitation && invite && "href" in invite && ficha ? (shortPath ?? presentationPath(token, invitation)) : null;
  // The plans live in the agency's environment: without it (a code no longer valid), the presentation itself.
  if (prices && !owner) redirect(shortPath ?? presentationPath(token, code));
  const plans = owner ? await plansOf(owner.href) : null;
  // The big photo's width for this device: phones get a lighter one (lib/demos/shared.ts, STAGE_WIDTH).
  const h = await headers();
  const stage = stageWidth(h.get("user-agent"), h.get("sec-ch-ua-mobile"));
  // No floating assistant here: nothing covers the photo, the styles or the contact (demo and buyers' page alike).
  return <DemoView demo={shown} source={{ kind: "public", token }} presentation={presentation} invite={invite} owner={owner} plans={plans} backToDemo={backToDemo} stage={stage} />;
}
