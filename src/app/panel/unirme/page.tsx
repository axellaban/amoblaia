import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JoinAgency } from "@/components/agency-team";
import { membershipOf } from "@/lib/agency/server";
import { joinInviteOf } from "@/lib/agency/team";
import { currentUser } from "@/lib/supabase/server";
import { cloudConfigured, cloudEnabled } from "@/lib/supabase/config";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Entrá al panel de tu inmobiliaria", robots: { index: false, follow: false } };

/**
 * The link an agency shares with an employee (?codigo=): a password for the
 * invited e-mail and straight into the panel, or, already signed in with that
 * e-mail, one click to join.
 */
export default async function JoinPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!cloudEnabled() || !cloudConfigured()) notFound();
  const { codigo } = await searchParams;
  const code = typeof codigo === "string" ? codigo : "";
  const invite = await joinInviteOf(code);
  const user = await currentUser().catch(() => null);
  const signedIn = user && !user.is_anonymous && user.email_confirmed_at ? user : null;
  const membership = signedIn ? await membershipOf(signedIn.id).catch(() => null) : null;
  return (
    <JoinAgency
      code={code}
      invite={invite}
      signedInEmail={signedIn?.email ?? null}
      hasAgency={membership ? membership.agency.name : null}
    />
  );
}
