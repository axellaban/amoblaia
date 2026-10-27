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

/** Free credits for the agency: to its owner's balance now, or waiting until it claims its account. */
export function AgencyCredits({ agencyId, hasOwner, credits }: { agencyId: string; hasOwner: boolean; credits: AdminAgencyDetail["credits"] }) {
  const router = useRouter();
  const [photos, setPhotos] = useState("5");
  const [reason, setReason] = useState("Regalo de bienvenida");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const n = Number(photos);
  const valid = Number.isInteger(n) && n >= 1 && n <= 1000 && reason.trim().length >= 5;

  async function post(body: Record<string, unknown>, done: (r: { applied: string | number; pending?: number }) => string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      setNotice(done(await api(`/api/admin/inmobiliarias/${agencyId}/creditos`, { method: "POST", body: JSON.stringify(body) })));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos cargar los créditos.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="account-panel aa-section" aria-labelledby="aa-credits">
      <h2 id="aa-credits">Créditos de regalo</h2>
      <p className="aa-help">
        {hasOwner
          ? `Van al saldo de la inmobiliaria (la cuenta del dueño), que paga sus ambientaciones. Saldo actual: ${
              credits.balance === null ? "no disponible" : `${credits.balance} ${credits.balance === 1 ? "crédito" : "créditos"}`
            }.`
          : "Todavía no tiene cuenta: los créditos quedan reservados y pasan a su saldo cuando acepte la invitación."}
        {" "}1 crédito = 1 foto ambientada; las versiones extra de esa foto no consumen.
      </p>
      {credits.pending === null && (
        <p className="inline-error" role="alert">
          Falta aplicar la migración 202610300001_agency_free_credits.sql en Supabase.
        </p>
      )}
      {!!credits.pending && (
        <p className="aa-pending">
          {credits.pending} {credits.pending === 1 ? "crédito reservado" : "créditos reservados"}{" "}
          {hasOwner ? "sin aplicar." : "hasta que acepte la invitación."}
          {hasOwner && (
            <button
              type="button"
              className="button button-small button-outline"
              disabled={busy}
              onClick={() => post({ apply: true }, (r) => `Se aplicaron ${r.applied} créditos al saldo.`)}
            >
              Aplicar ahora
            </button>
          )}
        </p>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="inline-notice" role="status">
          {notice}
        </p>
      )}
      <form
        className="aa-credit-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid || busy) return;
          if (!window.confirm(`¿Regalar ${n} ${n === 1 ? "crédito" : "créditos"} a esta inmobiliaria?`)) return;
          void post({ photos: n, reason }, (r) =>
            r.applied === "owner"
              ? `Listo: ${n} ${n === 1 ? "crédito sumado" : "créditos sumados"} al saldo.`
              : `Listo: quedan ${r.pending} créditos reservados hasta que acepte la invitación.`,
          );
        }}
      >
        <label>
          Créditos
          <input type="number" min={1} max={1000} step={1} inputMode="numeric" value={photos} onChange={(e) => setPhotos(e.target.value)} />
        </label>
        <label>
          Motivo (queda registrado)
          <input maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <button className="button button-small" disabled={!valid || busy || credits.pending === null}>
          {busy ? "Guardando…" : "Regalar créditos"}
        </button>
      </form>
    </section>
  );
}
