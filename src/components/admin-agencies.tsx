"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Link2, Plus } from "lucide-react";
import { api } from "@/components/admin-demos";
import { CLAIM_LABEL, type AdminAgencyDetail } from "@/lib/agency/stage";

const date = (iso: string) => new Date(iso).toLocaleDateString("es-AR");

/** Invitations of an agency without an account: create a new link, revoke a pending one. */
export function AgencyInvitations({ agencyId, claims, hasOwner }: { agencyId: string; claims: AdminAgencyDetail["claims"]; hasOwner: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function create() {
    setBusy("new");
    setError("");
    try {
      setCreated(await api<{ url: string; expiresAt: string }>(`/api/admin/inmobiliarias/${agencyId}/invitaciones`, { method: "POST" }));
      setCopied(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos crear la invitación.");
    } finally {
      setBusy("");
    }
  }
  async function revoke(id: string) {
    if (!window.confirm("¿Revocar esta invitación? El enlace deja de funcionar enseguida.")) return;
    setBusy(id);
    setError("");
    try {
      await api(`/api/admin/inmobiliarias/${agencyId}/invitaciones/${id}`, { method: "DELETE" });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos revocarla.");
    } finally {
      setBusy("");
    }
  }
  async function copy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.url);
      setCopied(true);
    } catch {
      setError("No pudimos copiarlo: seleccioná el enlace y copialo a mano.");
    }
  }

  return (
    <section className="account-panel aa-section" aria-labelledby="aa-claims">
      <div className="aa-section-head">
        <h2 id="aa-claims">Invitaciones</h2>
        {!hasOwner && (
          <button type="button" className="button button-small" disabled={busy === "new"} onClick={create}>
            <Plus size={15} /> Nueva invitación
          </button>
        )}
      </div>
      <p className="aa-help">
        {hasOwner
          ? "La inmobiliaria ya tiene su cuenta: no hacen falta invitaciones."
          : "Cada enlace sirve una vez y vence a los 30 días. Solo se guarda su huella: si se pierde, creá otro."}
      </p>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {created && (
        <div className="aa-created" role="status">
          <Link2 size={16} aria-hidden="true" />
          <input readOnly value={created.url} aria-label="Enlace de la invitación" onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="button button-small button-outline" onClick={copy}>
            <Copy size={15} /> {copied ? "Copiado" : "Copiar"}
          </button>
          <small>Vence el {date(created.expiresAt)}.</small>
        </div>
      )}
      {claims.length ? (
        <ul className="aa-list">
          {claims.map((c) => (
            <li key={c.id}>
              <span className={`dm-status ${c.state === "pending" ? "is-live" : ""}`}>{CLAIM_LABEL[c.state]}</span>
              <span>
                Creada el {date(c.createdAt)} ·{" "}
                {c.state === "used"
                  ? `usada el ${date(c.usedAt!)}`
                  : c.state === "revoked"
                    ? `revocada el ${date(c.revokedAt!)}`
                    : c.state === "expired"
                      ? `venció el ${date(c.expiresAt)}`
                      : `vence el ${date(c.expiresAt)}`}
              </span>
              {c.state === "pending" && (
                <button type="button" className="button button-small button-outline" disabled={busy === c.id} onClick={() => revoke(c.id)}>
                  Revocar
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="aa-empty">Todavía no se creó ninguna invitación.</p>
      )}
    </section>
  );
}
