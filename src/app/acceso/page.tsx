import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { currentUser } from "@/lib/supabase/server";
import { safeNext } from "@/lib/commerce/redirect";
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
  if (params.modo !== "actualizar") {
    const user = await currentUser().catch(() => null);
    if (user && !user.is_anonymous && user.email_confirmed_at) {
      const next = safeNext(
        typeof params.next === "string" ? params.next : null,
        "/proyectos",
      );
      redirect(next.startsWith("/acceso") ? "/proyectos" : next);
    }
  }
  return (
    <Suspense
      fallback={
        <div className="container account-page">Preparando tu acceso…</div>
      }
    >
      <AuthForm />
    </Suspense>
  );
}
