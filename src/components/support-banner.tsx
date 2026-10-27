"use client";
// Shown on every panel page while a team member is in a support view.
import { useState } from "react";
import { Eye } from "lucide-react";
import { api } from "./admin-demos";

export function SupportBanner({ agencyId, agencyName }: { agencyId: string; agencyName: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="support-banner" role="status">
      <Eye size={16} aria-hidden="true" />
      <span>
        <strong>Vista de soporte:</strong> estás viendo el panel de {agencyName} como lo ve su dueño. Solo lectura; vence en una hora.
      </span>
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
        Salir de la vista de soporte
      </button>
    </div>
  );
}
