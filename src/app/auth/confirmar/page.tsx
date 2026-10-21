import type { Metadata } from "next";
import { ConfirmForm } from "@/components/confirm-form";
export const metadata: Metadata = {
  title: "Confirmá tu acceso",
  robots: { index: false, follow: false },
};
// The email link lands here; only pressing the button signs in (POST to
// /auth/confirm), so a link opened by someone else cannot log them in.
export default async function Confirm({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const value = (key: string) =>
    typeof params[key] === "string" ? (params[key] as string) : "";
  const recovery = value("type") === "recovery";
  return (
    <div className="account-page container">
      <div className="auth-card confirm-card">
        <h2>{recovery ? "Elegí una nueva contraseña" : "Confirmá tu email"}</h2>
        <p>
          {recovery
            ? "Continuá para cambiar la contraseña de tu cuenta de amoblaIA."
            : "Continuá para activar tu cuenta de amoblaIA. Si no pediste este enlace, cerrá esta página."}
        </p>
        <ConfirmForm
          tokenHash={value("token_hash")}
          type={value("type")}
          next={value("next")}
        />
      </div>
    </div>
  );
}
