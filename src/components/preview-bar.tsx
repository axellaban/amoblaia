"use client";
// The bar over a property's «Vista previa», inside the panel: back to where it
// was opened from (the home, «Mis demostraciones» or the editor), desktop or
// phone, «Editar», and «Compartir» once published («Publicar» while it is still
// a draft). Entering the preview publishes nothing: only the button does,
// after the person asks.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Link2, Loader2, Monitor, Pencil, Share2, Smartphone } from "lucide-react";
import { api } from "./admin-demos";
import { track } from "@/lib/analytics";
import { shareLink } from "@/lib/agency/share";

export function PreviewBar({
  id,
  title,
  published,
  view,
  backTo = null,
  linkPath = null,
  canWork = true,
}: {
  id: string;
  title: string;
  published: boolean;
  view: "escritorio" | "movil";
  /** A panel path to go back to; none: the property's editor. */
  backTo?: string | null;
  /** The public link's path, once published. */
  linkPath?: string | null;
  /** Editing and publishing: not for view-only users. */
  canWork?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const keep = backTo ? `volver=${encodeURIComponent(backTo)}` : "";
  const here = `/panel/propiedades/${id}/vista-previa`;
  const desktopHref = keep ? `${here}?${keep}` : here;
  const phoneHref = `${here}?vista=movil${keep ? `&${keep}` : ""}`;
  const editor = `/panel/propiedades/${id}?${new URLSearchParams({ seccion: "fotos", ...(backTo ? { volver: backTo } : {}) })}`;
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
  async function share() {
    if (!linkPath) return;
    const link = `${window.location.origin}${linkPath}`;
    setError("");
    setNote("");
    const outcome = await shareLink(link, title, id);
    if (outcome === "copied") setNote("Link copiado.");
    else if (outcome === "failed") setError(`No pudimos copiar el link. Copialo desde acá: ${link}`);
  }
  return (
    <div className="pv-bar" role="region" aria-label="Vista previa">
      <Link href={backTo ?? editor} className="button button-small pv-back">
        <ArrowLeft size={15} aria-hidden="true" /> {backTo ? "Volver" : "Volver al editor"}
      </Link>
      <span className="pv-label">
        <strong>{title}</strong>
        <span role="status">{published ? "Así la ve el comprador cuando abre tu link." : "Borrador: así la va a ver el comprador cuando la publiques."}</span>
      </span>
      <span className="pv-devices" role="group" aria-label="Ver en">
        <Link href={desktopHref} className={view === "escritorio" ? "is-on" : ""} aria-current={view === "escritorio" ? "true" : undefined}>
          <Monitor size={15} aria-hidden="true" /> Escritorio
        </Link>
        <Link href={phoneHref} className={view === "movil" ? "is-on" : ""} aria-current={view === "movil" ? "true" : undefined}>
          <Smartphone size={15} aria-hidden="true" /> Móvil
        </Link>
      </span>
      <span className="pv-actions">
        {canWork && (
          <Link href={editor} className="button button-small button-light">
            <Pencil size={15} aria-hidden="true" /> Editar
          </Link>
        )}
        {published && linkPath ? (
          <button type="button" className="button button-small button-light" onClick={() => void share()}>
            <Share2 size={15} aria-hidden="true" /> Compartir
          </button>
        ) : (
          canWork && (
            <button type="button" className="button button-small button-light" disabled={busy} onClick={() => void publish()}>
              {busy ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <Link2 size={15} aria-hidden="true" />} Publicar y obtener link
            </button>
          )
        )}
      </span>
      {note && (
        <p className="pv-note" role="status">
          {note}
        </p>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
