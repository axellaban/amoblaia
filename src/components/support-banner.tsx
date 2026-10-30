"use client";
// Shown on every panel page while a team member is in a support view.
import { useState } from "react";
import { Eye, UserCog } from "lucide-react";
import { api } from "./admin-demos";

/** acting: the team member works as the agency (Entrar como la inmobiliaria), not just looking. */
export function SupportBanner({ agencyId, agencyName, acting = false }: { agencyId: string; agencyName: string; acting?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className={`support-banner ${acting ? "is-acting" : ""}`} role="status">
      {acting ? <UserCog size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
      {acting ? (
        <span>
          <strong>Estás dentro de {agencyName} como su dueño.</strong> Los cambios son reales y las ambientaciones usan sus créditos. Queda
          registrado; vence en una hora.
        </span>
      ) : (
        <span>
          <strong>Vista de soporte:</strong> estás viendo el panel de {agencyName} como lo ve su dueño. Solo lectura; vence en una hora.
        </span>
      )}
      {error && <span className="support-banner-error">{error}</span>}
      <button
        type="button"
        className="button button-small"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const { url } = await api<{ url: string }>(`/api/admin/inmobiliarias/${agencyId}/soporte`, { method: "DELETE" });
            window.location.assign(url);
          } catch (e) {
            setError(e instanceof Error ? e.message : "No pudimos salir. Probá de nuevo.");
            setBusy(false);
          }
        }}
      >
        {acting ? "Salir de la inmobiliaria" : "Salir de la vista de soporte"}
      </button>
    </div>
  );
}
