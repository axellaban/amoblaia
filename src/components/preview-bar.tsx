"use client";
// The bar over a property's «Vista previa»: back to the editor (its tab kept),
// desktop or phone, and «Publicar» when it is still a draft. Entering the
// preview publishes nothing: only the button does, after the person asks.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Link2, Loader2, Monitor, Smartphone } from "lucide-react";
import { api } from "./admin-demos";
import { track } from "@/lib/analytics";

export function PreviewBar({ id, published, view }: { id: string; published: boolean; view: "escritorio" | "movil" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const here = `/panel/propiedades/${id}/vista-previa`;
  async function publish() {
    setBusy(true);
    setError("");
    try {
      await api(`/api/admin/demos/${id}`, { method: "PATCH", body: JSON.stringify({ action: "publish" }) });
      track("property_published", { property_id: id, origin: "preview" });
      router.push(`/panel/propiedades/${id}?seccion=publicacion&publicada=1`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos publicarla.");
      setBusy(false);
    }
  }
  return (
    <div className="demo-preview-bar pv-bar" role="region" aria-label="Vista previa">
      <div className="container">
        <Link href={`/panel/propiedades/${id}?seccion=fotos`} className="button button-small button-light">
          <ArrowLeft size={15} aria-hidden="true" /> Volver al editor
        </Link>
        <span role="status">
          Vista previa · {published ? "publicada: así la ven tus clientes." : "borrador: todavía no es pública."}
        </span>
        <span className="demo-preview-actions">
          <span className="pv-devices" role="group" aria-label="Ver en">
            <Link href={here} className={view === "escritorio" ? "is-on" : ""} aria-current={view === "escritorio" ? "true" : undefined}>
              <Monitor size={15} aria-hidden="true" /> Escritorio
            </Link>
            <Link href={`${here}?vista=movil`} className={view === "movil" ? "is-on" : ""} aria-current={view === "movil" ? "true" : undefined}>
              <Smartphone size={15} aria-hidden="true" /> Móvil
            </Link>
          </span>
          <Link href={`/panel/propiedades/${id}?seccion=datos`} className="button button-small button-light">
            Corregir datos
          </Link>
          {!published && (
            <button type="button" className="button button-small button-primary" disabled={busy} onClick={() => void publish()}>
              {busy ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <Link2 size={15} aria-hidden="true" />} Publicar y obtener enlace
            </button>
          )}
        </span>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
