"use client";

import { useState } from "react";
import { api } from "@/components/admin-demos";

const when = (iso: string) => new Date(iso).toLocaleString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });

/** /admin/script: one text for the whole team and the extension. */
export function FollowupScript({ body, updatedAt }: { body: string; updatedAt: string | null }) {
  const [text, setText] = useState(body);
  const [saved, setSaved] = useState({ body, at: updatedAt });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dirty = text !== saved.body;
  async function save() {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ body: string; updated_at: string }>("/api/admin/follow-up/script", { method: "PUT", body: JSON.stringify({ body: text }) });
      setSaved({ body: r.body, at: r.updated_at });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos guardar el script.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="fu-script account-panel">
      <textarea
        data-testid="followup-script"
        value={text}
        maxLength={20000}
        aria-label="Script para la extensión"
        placeholder={"Ej.:\n1. Antes de ejecutar, revisá que el estado de la inmobiliaria sea el correcto. Si no, corregilo en «Estado».\n2. Mirá la última acción y su fecha: si escribimos hace menos de 3 días, no mandes otro mensaje.\n3. Leé las observaciones del mensaje antes de enviarlo."}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="fu-actions">
        <button type="button" className="button button-primary button-small" data-testid="followup-script-save" disabled={busy || !dirty} onClick={save}>
          {busy ? "Guardando…" : "Guardar script"}
        </button>
        {dirty && (
          <button type="button" className="fu-link" disabled={busy} onClick={() => setText(saved.body)}>
            Descartar cambios
          </button>
        )}
        <p className="fu-note" role="status">
          {dirty ? "Hay cambios sin guardar." : saved.at ? `Guardado el ${when(saved.at)}.` : "Todavía no hay script."} {text.length.toLocaleString("es-AR")} / 20.000 caracteres.
        </p>
      </div>
      {error && (
        <p className="fu-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
