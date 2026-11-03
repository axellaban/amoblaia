"use client";
// Who took over an agency, for the team: the e-mail, how, and whether it
// looks like the agency's own. One action: mark it as verified.
import { useState } from "react";
import { api } from "./admin-demos";
import { CLAIM_METHOD_LABEL, CLAIM_REVIEW_LABEL, type ClaimMethod, type ClaimReview } from "@/lib/agency/claim-review";

export type ClaimInfo = { email: string | null; method: ClaimMethod | null; review: ClaimReview | "confirmed" | null; website: string | null };

export function ClaimReviewNotice({ agencyId, claim }: { agencyId: string; claim: ClaimInfo }) {
  const [review, setReview] = useState(claim.review);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!review || !claim.email) return null;
  const attention = review === "mismatch" || review === "personal";
  return (
    <section className={`account-panel aa-claim ${review === "mismatch" ? "is-alert" : ""}`} aria-labelledby="aa-claim-title">
      <h2 id="aa-claim-title">Quién reclamó la cuenta</h2>
      <p>
        <strong>{claim.email}</strong> {claim.method ? CLAIM_METHOD_LABEL[claim.method] : ""} · <span className="dm-status">{CLAIM_REVIEW_LABEL[review]}</span>
      </p>
      {attention && (
        <p className="dm-help">
          {review === "mismatch"
            ? `El dominio del email no es el del sitio de la inmobiliaria${claim.website ? ` (${claim.website})` : ""}. Confirmá con el contacto que lo hizo alguien de la inmobiliaria.`
            : "Entró con un email personal: es habitual, pero confirmalo con el contacto si el link pudo haberse reenviado."}{" "}
          Si no corresponde, entrá a su panel en modo soporte y escribinos para revertir el dueño.
        </p>
      )}
      {attention && (
        <button
          type="button"
          className="button button-small"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await api(`/api/admin/inmobiliarias/${agencyId}/reclamo`, { method: "POST", body: "{}" });
              setReview("confirmed");
            } catch (e) {
              setError(e instanceof Error ? e.message : "No pudimos guardarlo.");
            } finally {
              setBusy(false);
            }
          }}
        >
          Marcar como verificado
        </button>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
