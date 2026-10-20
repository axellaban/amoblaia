"use client";
import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import {
  ArrowUpRight,
  LogOut,
  RefreshCw,
  Check,
  LoaderCircle,
  Camera,
  ShieldCheck,
} from "lucide-react";
import { formatARS } from "@/lib/commerce/catalog";
import { clearDraft } from "@/lib/studio-draft";
import { browserClient } from "@/lib/supabase/client";
type Account = {
  email: string;
  admin: boolean;
  credits: number;
  free: boolean;
  freeRemaining: number;
  blocked: boolean;
  subscriptions: {
    id: string;
    status: string;
    paid_until: string | null;
    orders: { snapshot: { name: string; kind: string; photos: number } };
  }[];
  payments: {
    id: string;
    status: string;
    amount_cents: number;
    paid_at: string | null;
  }[];
  jobs: {
    id: string;
    status: string;
    error_code: string;
    created_at: string;
  }[];
  grants: {
    id: string;
    source_key: string;
    remaining: number;
    total: number;
    expires_at: string | null;
    revoked: boolean;
  }[];
};
const date = (s: string | null) =>
  s ? new Date(s).toLocaleDateString("es-AR") : "—";
const statuses: Record<string, string> = {
  approved: "Aprobado",
  pending: "Pendiente",
  in_process: "En proceso",
  rejected: "Rechazado",
  refunded: "Reembolsado",
  charged_back: "Contracargo",
  partially_refunded: "Reembolso parcial",
  in_mediation: "En revisión",
  cancelled: "Cancelada",
  authorized: "Activa",
  paused: "Pausada",
  queued: "En espera",
  running: "Generando",
  needs_review: "En revisión",
  failed: "Falló",
};
export function AccountDashboard() {
  const [account, setAccount] = useState<Account | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [cancel, setCancel] = useState("");
  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/account", { cache: "no-store" });
      if (r.status === 401) {
        window.location.assign("/acceso");
        return;
      }
      const p = await r.json();
      if (!r.ok) throw new Error(p.error);
      setAccount(p);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos cargar tu cuenta.");
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function cancelSubscription(id: string) {
    setBusy(true);
    try {
      const r = await fetch("/api/billing/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const p = await r.json();
      if (!r.ok) throw new Error(p.error);
      setNotice("Cancelamos la renovación. Conservás el período ya pagado.");
      setCancel("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos cancelar.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="account-page container">
      <div className="account-heading">
        <div>
          <span className="eyebrow">TODO EN SU LUGAR</span>
          <h1>
            Mi cuenta<span className="accent">.</span>
          </h1>
          <p>{account?.email || "Tus fotos, planes y pagos."}</p>
        </div>
        <div className="account-actions">
          <button
            className="button button-outline"
            onClick={load}
            disabled={busy}
          >
            <RefreshCw size={16} className={busy ? "spin" : ""} />
            Actualizar
          </button>
          <button
            className="icon-button"
            aria-label="Cerrar sesión"
            onClick={async () => {
              const r = await browserClient()?.auth.signOut();
              if (r?.error) {
                setError("No pudimos cerrar la sesión.");
                return;
              }
              await clearDraft().catch(() => {});
              window.location.assign("/acceso");
            }}
          >
            <LogOut size={19} />
          </button>
        </div>
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="inline-notice" role="status">
          <Check size={17} />
          {notice}
        </p>
      )}
      {!account && busy && (
        <p>
          <LoaderCircle className="spin" size={20} />
          Cargando tu cuenta…
        </p>
      )}
      {account && (
        <>
          <div className="account-summary">
            <article className="balance-card">
              <Camera size={24} />
              <span>
                {account.free
                  ? "DISEÑOS GRATIS DISPONIBLES"
                  : "FOTOS DISPONIBLES"}
              </span>
              <strong>
                {account.free ? account.freeRemaining : account.credits}
              </strong>
              <p>
                {account.free
                  ? "25 diseños en total. Creá hasta 3 por tanda, sin tarjeta."
                  : "Regeneraciones incluidas durante tu período pago."}
              </p>
              <Link href="/estudio" className="button button-primary">
                Crear un diseño
                <ArrowUpRight size={17} />
              </Link>
            </article>
            <article className="account-panel">
              <ShieldCheck size={22} />
              <h2>Tu próxima publicación</h2>
              <p>
                Encontrá tus originales y variantes en Mis proyectos. Las
                descargas no consumen tu cupo.
              </p>
              <Link className="text-link" href="/proyectos">
                Ver mis proyectos
                <ArrowUpRight size={16} />
              </Link>
              <Link className="text-link" href="/precios">
                Elegir un plan
                <ArrowUpRight size={16} />
              </Link>
            </article>
          </div>
          {account.blocked && (
            <p className="inline-error">
              Tu cuenta necesita una revisión antes de generar. Contactá al
              equipo desde el enlace de soporte.
            </p>
          )}
          <section className="account-panel">
            <h2>Mis suscripciones</h2>
            {!account.subscriptions.length ? (
              <p>
                Todavía no tenés una suscripción. Podés{" "}
                <Link href="/precios">elegir un plan</Link>.
              </p>
            ) : (
              account.subscriptions.map((s) => (
                <div key={s.id} className="subscription-row">
                  <div>
                    <h3>{s.orders?.snapshot?.name || "Plan amoblaIA"}</h3>
                    <p>
                      {statuses[s.status] || s.status} ·{" "}
                      {s.orders?.snapshot?.photos} fotos por mes
                    </p>
                    <p>
                      {s.paid_until
                        ? `Período pagado hasta ${date(s.paid_until)}`
                        : "Esperando la confirmación del primer pago."}
                    </p>
                  </div>
                  {["authorized", "pending", "paused"].includes(s.status) &&
                    (cancel === s.id ? (
                      <div className="cancel-confirm">
                        <p>¿Querés detener los próximos cobros?</p>
                        <button
                          className="button button-outline"
                          disabled={busy}
                          onClick={() => cancelSubscription(s.id)}
                        >
                          Confirmar cancelación
                        </button>
                        <button
                          className="subtle-button"
                          onClick={() => setCancel("")}
                        >
                          Volver
                        </button>
                      </div>
                    ) : (
                      <button
                        className="button button-outline"
                        disabled={busy}
                        onClick={() => setCancel(s.id)}
                      >
                        Cancelar renovación
                      </button>
                    ))}
                </div>
              ))
            )}
          </section>
          {account.jobs.length > 0 && (
            <section className="account-panel">
              <h2>Estado de tus generaciones</h2>
              {account.jobs.map((j) => (
                <div className="data-row" key={j.id}>
                  <span>{date(j.created_at)}</span>
                  <strong>{statuses[j.status] || j.status}</strong>
                  {j.status === "needs_review" && (
                    <span>
                      El equipo puede recuperar el resultado. No vuelvas a
                      enviarlo.
                    </span>
                  )}
                  {["queued", "running"].includes(j.status) && (
                    <Link href={`/estudio?job=${j.id}`}>Ver generación</Link>
                  )}
                </div>
              ))}
            </section>
          )}
          <section className="account-panel">
            <h2>Fotos y vencimientos</h2>
            {account.grants
              .filter((g) => !g.source_key.startsWith("trial:"))
              .filter(
                (g) =>
                  g.remaining > 0 &&
                  !g.revoked &&
                  (!g.expires_at || Date.parse(g.expires_at) > Date.now()),
              )
              .map((g) => (
                <div className="data-row" key={g.id}>
                  <strong>
                    {g.remaining} de {g.total} fotos
                  </strong>
                  <span>
                    {g.expires_at
                      ? `Disponibles hasta ${date(g.expires_at)}`
                      : "Sin vencimiento"}
                  </span>
                </div>
              ))}
            {account.credits === 0 && <p>Tu próximo pack va a aparecer acá.</p>}
          </section>
          <section className="account-panel">
            <h2>Historial de pagos</h2>
            {!account.payments.length ? (
              <p>Todavía no hay pagos en tu cuenta.</p>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Importe</th>
                      <th>Estado</th>
                      <th>Referencia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {account.payments.map((p) => (
                      <tr key={p.id}>
                        <td>{date(p.paid_at)}</td>
                        <td>{formatARS(p.amount_cents)}</td>
                        <td>{statuses[p.status] || p.status}</td>
                        <td>{p.id}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="field-hint">
              El regreso desde Mercado Pago no confirma el cobro. El saldo se
              actualiza cuando verificamos el pago aprobado.
            </p>
          </section>
          {account.admin && (
            <Link className="button button-dark" href="/administracion">
              Administrar amoblaIA
              <ArrowUpRight size={17} />
            </Link>
          )}
          <div className="account-support">
            <p>¿Necesitás ayuda con una foto, un pago o una baja?</p>
            <Link href="/ayuda" className="text-link">
              Contactar al equipo
              <ArrowUpRight size={16} />
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
