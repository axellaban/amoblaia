"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/components/admin-demos";

/** Adds an existing agency (with its demos) to the prospecting base, or opens it if it already is there. */
export function AddToProspecting({ agencyId }: { agencyId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function add() {
    setBusy(true);
    setError("");
    try {
      await api("/api/admin/prospeccion", { method: "POST", body: JSON.stringify({ agencyId }) });
      router.push("/admin/prospeccion?vista=prospectos");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos agregarla.");
      setBusy(false);
    }
  }
  return (
    <>
      <button type="button" className="button button-outline" onClick={add} disabled={busy}>
        {busy ? "Agregando…" : "Base de prospección"}
      </button>
      {error && (
        <span className="inline-error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
