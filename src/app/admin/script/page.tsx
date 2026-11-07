import type { Metadata } from "next";
import Link from "next/link";
import { FollowupScript } from "@/components/admin-followup-script";
import { HttpError } from "@/lib/commerce/http";
import { requireAdminPage } from "@/lib/demos/admin-page";
import { readScript } from "@/lib/followup/server";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Script",
  robots: { index: false, follow: false },
};

/** Script: el guion que la extensión lee antes de trabajar en Follow-up (docs/FOLLOWUP.md). */
export default async function ScriptPage() {
  await requireAdminPage("/admin/script");
  const data = await readScript().catch((e: unknown) => (e instanceof HttpError ? e.message : null));
  return (
    <div className="ah-page fu-page">
      <header className="ah-head">
        <div>
          <h1>Script</h1>
          <p>El guion que lee la extensión antes de trabajar en Follow-up: cómo hablar, qué evitar y qué hacer cuando algo no coincide. Las indicaciones de cada mensaje van en sus observaciones.</p>
        </div>
      </header>
      {data && typeof data === "object" ? (
        <FollowupScript body={data.body} updatedAt={data.updated_at} />
      ) : (
        <div className="account-panel" role="alert">
          <h2>No pudimos cargar el script</h2>
          <p>{data ?? "Probá de nuevo en unos segundos."}</p>
          <Link href="/admin/script" className="button button-small">
            Reintentar
          </Link>
        </div>
      )}
    </div>
  );
}
