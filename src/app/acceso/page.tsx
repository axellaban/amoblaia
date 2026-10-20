import { Suspense } from "react";
import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
export const metadata: Metadata = {
  title: "Tu cuenta",
  robots: { index: false, follow: false },
};
export default function Access() {
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
