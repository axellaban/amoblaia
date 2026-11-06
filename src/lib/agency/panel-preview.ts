// The preview of a link to an agency's panel when it is shared (WhatsApp,
// redes): «Tu panel de <inmobiliaria>», its free credits, the three tools
// (the first with its own property, when it has a demo), «Ingresar a tu panel»
// and «El impacto en tu negocio». The links themselves (/i/…, /p/…/panel,
// /presentacion/<codigo>/panel, /panel/visita) redirect people straight into
// the panel; only link-preview bots get a page with this preview, which also
// keeps them from starting a visit.
import "server-only";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { adminClient } from "@/lib/supabase/server";
import { cloudConfigured } from "@/lib/supabase/config";
import { liveVisit } from "@/lib/agency/visit";
import { publishedDemo } from "@/lib/demos/server";
import { coverVersion, ogImageUrl } from "@/lib/demos/shared";
import { FREE_MONTHLY_CREDITS } from "@/lib/commerce/credit-packs";

/** Link-preview crawlers (WhatsApp, Facebook/Instagram, X, LinkedIn, Slack, Telegram, Discord, iMessage…). */
const PREVIEW_BOT = /whatsapp|facebookexternalhit|facebot|meta-externalagent|twitterbot|linkedinbot|slackbot|telegrambot|discordbot|skypeuripreview|pinterest|redditbot|applebot|embedly|iframely|vkshare|google-pagerenderer/i;
export const isPreviewBot = (userAgent: string | null | undefined) => Boolean(userAgent && PREVIEW_BOT.test(userAgent));

export type PanelPreview = {
  /** Null when the link no longer opens a panel: a generic preview. */
  agencyName: string | null;
  freeCredits: number;
  /** The agency already has its account: no «sin crear cuenta». */
  claimed: boolean;
  /** Its own property's cover (path of the demo's preview image), for the first card. */
  cover: string | null;
};

/** The demo whose cover goes in the first card: the link's own, else the agency's latest published one. */
async function coverOf(agencyId: string, demoToken: string | null) {
  let token = demoToken;
  if (!token) {
    const { data } = await adminClient()
      .from("demos")
      .select("token")
      .eq("agency_id", agencyId)
      .eq("status", "published")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    token = (data as { token: string } | null)?.token ?? null;
  }
  if (!token) return null;
  const demo = await publishedDemo(token);
  if (!demo?.cover) return null;
  return ogImageUrl(token, demo.cover.id, coverVersion(demo.cover, demo.styles[0]?.id ?? ""));
}

export async function panelPreview(code: string | null): Promise<PanelPreview> {
  const generic: PanelPreview = { agencyName: null, freeCredits: 0, claimed: false, cover: null };
  if (!code || !cloudConfigured()) return generic;
  try {
    const visit = await liveVisit(code);
    if (!visit) return generic;
    const [credits, cover] = await Promise.all([
      adminClient().from("agencies").select("free_credits_pending").eq("id", visit.agency.id).maybeSingle(),
      coverOf(visit.agency.id, visit.demoToken).catch(() => null),
    ]);
    const freeCredits = credits.error ? 0 : ((credits.data as { free_credits_pending: number | null } | null)?.free_credits_pending ?? 0);
    return { agencyName: visit.agency.name, freeCredits, claimed: visit.claimed, cover };
  } catch {
    return generic;
  }
}

/** «Tenés 3 créditos gratis», or the free plan's monthly credits when the invitation brings none. */
export const creditsLine = (p: Pick<PanelPreview, "freeCredits">) =>
  p.freeCredits > 0 ? `Tenés ${p.freeCredits} ${p.freeCredits === 1 ? "crédito gratis" : "créditos gratis"}` : `${FREE_MONTHLY_CREDITS} créditos gratis por mes`;

export function panelPreviewText(p: PanelPreview) {
  const title = p.agencyName ? `Tu panel de ${p.agencyName} · habita.` : "Tu panel de habita.";
  const credits = p.freeCredits > 0 ? `, con ${p.freeCredits} ${p.freeCredits === 1 ? "crédito gratis" : "créditos gratis"}` : "";
  const description = p.agencyName
    ? `Ya está creado${credits}: demos interactivas, estudio de imágenes y videos para tus propiedades.${p.claimed ? "" : " Entrá sin crear cuenta todavía."}`
    : "Demos interactivas, estudio de imágenes y videos para tus propiedades.";
  return { title, description };
}

/** The image of the preview, for one code. */
export const panelPreviewImagePath = (code: string | null) => `/api/vista-panel${code ? `?${new URLSearchParams({ codigo: code })}` : ""}`;

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** The page a preview bot gets from a route handler (/i/…, /panel/visita): only the preview's tags. */
export async function panelPreviewResponse(code: string | null, request: Request) {
  const origin = new URL(request.url).origin;
  const p = await panelPreview(code);
  const { title, description } = panelPreviewText(p);
  const image = `${origin}${panelPreviewImagePath(code)}`;
  const tags = [
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="habita.">`,
    `<meta property="og:locale" content="es_AR">`,
    `<meta property="og:url" content="${escape(request.url)}">`,
    `<meta property="og:title" content="${escape(title)}">`,
    `<meta property="og:description" content="${escape(description)}">`,
    `<meta property="og:image" content="${escape(image)}">`,
    `<meta property="og:image:type" content="image/jpeg">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="robots" content="noindex, nofollow">`,
  ].join("\n");
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escape(title)}</title><meta name="description" content="${escape(description)}">\n${tags}</head><body><h1>${escape(title)}</h1><p>${escape(description)}</p></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" } });
}

/** The same preview as page metadata (/p/…/panel and /presentacion/<codigo>/panel). */
export async function panelPreviewMetadata(code: string | null): Promise<Metadata> {
  const { title, description } = panelPreviewText(await panelPreview(code));
  return {
    title: { absolute: title },
    description,
    robots: { index: false, follow: false },
    openGraph: {
      type: "website",
      siteName: "habita.",
      locale: "es_AR",
      title,
      description,
      images: [{ url: panelPreviewImagePath(code), width: 1200, height: 630, type: "image/jpeg", alt: title }],
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

/** Whether this request comes from a link-preview bot (pages read it from the headers). */
export async function fromPreviewBot() {
  return isPreviewBot((await headers()).get("user-agent"));
}
