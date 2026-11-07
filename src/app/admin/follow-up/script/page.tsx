import type { Metadata } from "next";
import Link from "next/link";
import { ScriptEditor } from "@/components/admin-followup";
import { HttpError } from "@/lib/commerce/http";
import { requireAdminPage } from "@/lib/demos/admin-page";
import { readScript } from "@/lib/followup/server";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Script",
  robots: { index: false, follow: false },
};

/** Follow-up → Script: el guion general que lee la extensión antes de trabajar (docs/FOLLOWUP.md). */
export default async function ScriptPage() {
  await requireAdminPage("/admin/follow-up/script");
  const data = await readScript().catch((e: unknown) => (e instanceof HttpError ? e.message : null));
  return (
    <div className="ah-page fu-page">
      <header className="ah-head">
        <div>
          <h1>Script</h1>
          <p>El guion que lee la extensión antes de trabajar Follow-up: qué revisar, cuándo corregir el estado, qué hacer si algo no coincide y el tono.</p>
        </div>
      </header>
      {data && typeof data === "object" ? (
        <ScriptEditor body={data.body} updatedAt={data.updated_at} />
      ) : (
        <div className="account-panel" role="alert">
          <h2>No pudimos cargar el script</h2>
          <p>{data ?? "Probá de nuevo en unos segundos."}</p>
          <Link href="/admin/follow-up/script" className="button button-small">
            Reintentar
          </Link>
        </div>
      )}
    </div>
  );
}
