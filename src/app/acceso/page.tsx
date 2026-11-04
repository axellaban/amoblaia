import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { currentUser } from "@/lib/supabase/server";
import { currentVisit } from "@/lib/agency/visit";
import { cloudConfigured, cloudEnabled } from "@/lib/supabase/config";
import { safeNext } from "@/lib/commerce/redirect";
import { withClickIds } from "@/lib/ads";
export const metadata: Metadata = {
  title: "Tu cuenta",
  robots: { index: false, follow: false },
};
export default async function Access({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  // A signed-in account goes straight to where it was heading instead of
  // seeing the sign-in page again (password updates still need the form).
  // Same condition as the rest of the account features: with cloud accounts
  // off, /proyectos would send the user back here in a loop. /inicio picks
  // the agency's panel or the photos.
  if (params.modo !== "actualizar" && cloudEnabled() && cloudConfigured()) {
    const user = await currentUser().catch(() => null);
    if (user && !user.is_anonymous && user.email_confirmed_at) {
      const next = safeNext(
        typeof params.next === "string" ? params.next : null,
        "/inicio",
      );
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(params))
        if (typeof value === "string") search.set(key, value);
      redirect(
        withClickIds(next.startsWith("/acceso") ? "/inicio" : next, search),
      );
    }
  }
  // From an agency's panel link (its visit is in this browser): the card names that agency.
  const visit = cloudEnabled() && cloudConfigured() ? await currentVisit().catch(() => null) : null;
  return (
    <Suspense
      fallback={
        <div className="container account-page">Preparando tu acceso…</div>
      }
    >
      <AuthForm panelAgency={visit?.agency.name ?? null} />
    </Suspense>
  );
}
