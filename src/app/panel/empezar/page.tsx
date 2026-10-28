import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { InvitationSignup } from "@/components/agency-invitation";
import { AgencyOnboarding } from "@/components/agency-panel";
import { invitationOf } from "@/lib/agency/invitation";
import { membershipOf } from "@/lib/agency/server";
import { presentationPath } from "@/lib/agency/demo-invite";
import { publishedDemo } from "@/lib/demos/server";
import { coverVersion, publicImageUrl } from "@/lib/demos/shared";
import { currentUser } from "@/lib/supabase/server";
import { cloudConfigured, cloudEnabled } from "@/lib/supabase/config";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Creá tu inmobiliaria", robots: { index: false, follow: false } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : null);

/**
 * Start of the agency account, also from a demo's call to action: the
 * demo's public data (agency name, listing) only pre-fills the form and
 * offers to import that listing again. Its photos and stagings move only
 * with the one-time code the team sends to the agency.
 */
export default async function StartPage({ searchParams }: Props) {
  if (!cloudEnabled() || !cloudConfigured()) notFound();
  const q = await searchParams;
  const token = one(q.demo);
  const code = one(q.codigo);
  const user = await currentUser().catch(() => null);
  const signedIn = Boolean(user && !user.is_anonymous && user.email_confirmed_at);
  // Not knowing whether the account already has an agency is an error, not a "no".
  const membership = signedIn ? await membershipOf(user!.id) : null;
  const demo = token ? await publishedDemo(token).catch(() => null) : null;
  // Someone who already works for that demo's agency goes straight to the property, not through a form.
  if (demo && membership && membership.agency.id === demo.agencyId) redirect(`/panel/propiedades/${demo.id}`);
  // The team's invitation: only an e-mail and a password to enter.
  if (code && !signedIn) {
    const invitation = await invitationOf(code);
    const here = `/panel/empezar?${new URLSearchParams({ codigo: code, ...(token ? { demo: token } : {}) })}`;
    // The demo the agency came from, only when the invitation is for that same agency.
    const cover = demo?.cover ?? null;
    const version = cover ? coverVersion(cover, demo!.styles[0]?.id ?? "") : null;
    const property =
      demo && invitation && demo.agencyId === invitation.agencyId
        ? {
            id: demo.id,
            title: demo.title,
            location: demo.location,
            before: cover ? publicImageUrl(token!, cover.id, null, 1280) : null,
            after: cover && version ? publicImageUrl(token!, cover.id, version, 1280) : null,
            back: presentationPath(token!, code),
          }
        : null;
    return <InvitationSignup code={code} here={here} invitation={invitation} property={property} />;
  }
  return (
    <AgencyOnboarding
      signedIn={signedIn}
      hasAgency={Boolean(membership)}
      code={code}
      demo={
        demo
          ? { token: token!, id: demo.id, agencyId: demo.agencyId, agencyName: demo.agencyName, title: demo.title, listingUrl: demo.listingUrl }
          : null
      }
    />
  );
}
