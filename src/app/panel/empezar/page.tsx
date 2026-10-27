import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InvitationSignup } from "@/components/agency-invitation";
import { AgencyOnboarding } from "@/components/agency-panel";
import { invitationOf } from "@/lib/agency/invitation";
import { membershipOf } from "@/lib/agency/server";
import { publishedDemo } from "@/lib/demos/server";
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
  // The team's invitation: only an e-mail and a password to enter.
  if (code && !signedIn) {
    const invitation = await invitationOf(code);
    const here = `/panel/empezar?${new URLSearchParams({ codigo: code, ...(token ? { demo: token } : {}) })}`;
    return <InvitationSignup code={code} here={here} invitation={invitation} />;
  }
  const demo = token ? await publishedDemo(token).catch(() => null) : null;
  return (
    <AgencyOnboarding
      signedIn={signedIn}
      hasAgency={Boolean(membership)}
      code={code}
      demo={
        demo
          ? { token: token!, id: demo.id, agencyName: demo.agencyName, title: demo.title, listingUrl: demo.listingUrl }
          : null
      }
    />
  );
}
