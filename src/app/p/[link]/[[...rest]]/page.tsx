import { notFound } from "next/navigation";
import { cache } from "react";
import { shortLinkCode } from "@/lib/agency/demo-invite";
import { shortLinkDemoToken } from "@/lib/agency/invitation";
import { cloudConfigured } from "@/lib/supabase/config";
import { PublicDemo, publicDemoMetadata } from "../../../demo/[token]/public-demo";

// The agency's short link: /p/<propiedad>-<codigo>, the same presentation as
// /demo/<token>/presentacion/<codigo>; /precios or /ficha after it. The
// property's name is only for reading: the code alone finds the demo.
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ link: string; rest?: string[] }>;
};

const tokenOf = cache(async (code: string) => {
  if (!cloudConfigured()) return null;
  try {
    return await shortLinkDemoToken(code);
  } catch {
    console.error("short_link_lookup_failed");
    return null;
  }
});

/** The view, from the path after the link. */
function viewOf(rest: string[] = []) {
  if (rest.length === 0) return { ficha: false, prices: false };
  if (rest.length === 1 && rest[0] === "ficha") return { ficha: true, prices: false };
  if (rest.length === 1 && rest[0] === "precios") return { ficha: false, prices: true };
  return null;
}

export async function generateMetadata({ params }: Props) {
  const { link } = await params;
  const code = shortLinkCode(link);
  const token = code ? await tokenOf(code) : null;
  return publicDemoMetadata(token ?? "", true);
}

export default async function ShortLinkPage({ params }: Props) {
  const { link, rest } = await params;
  const code = shortLinkCode(link);
  const view = viewOf(rest);
  if (!code || !view) notFound();
  const token = await tokenOf(code);
  if (!token) notFound();
  return <PublicDemo token={token} presentation code={code} ficha={view.ficha} prices={view.prices} shortPath={`/p/${link}`} />;
}
