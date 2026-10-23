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
import { formatARS, isFullyReversed } from "@/lib/commerce/catalog";
import { CheckoutReturn } from "./checkout-return";
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
    orders: {
      snapshot: { name: string; kind: string; photos: number };
      payments?: { status: string }[];
    };
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
  checkouts: { id: string; snapshot: { name: string } }[];
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
  duplicate: "Duplicado, se reintegra",
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
  const [returnOrder, setReturnOrder] = useState("");
  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/account", { cache: "no-store" });
      if (r.status === 401) {
        window.location.assign(
          `/acceso?next=${encodeURIComponent(window.location.pathname + window.location.search)}`,
        );
        return;
      }
      const p = await r.json();
      if (!r.ok) throw new Error(p.error);
      if (p.anonymous) {
        window.location.assign(
          `/acceso?next=${encodeURIComponent(window.location.pathname + window.location.search)}`,
        );
        return;
      }
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
    const order =
      new URLSearchParams(window.location.search).get("orden") || "";
    if (/^[0-9a-f-]{36}$/i.test(order)) setReturnOrder(order);
    // Return flags are presentation hints, never evidence of payment.
  }, [load]);
  // A refunded plan paid for nothing: it shows no paid period.
  const refunded = (s: Account["subscriptions"][number]) =>
    isFullyReversed((s.orders?.payments || []).map((p) => p.status));
  // Subscriptions that ended without ever being charged (abandoned or
  // replaced checkouts) are noise in the list.
  const subscriptions = (account?.subscriptions || []).filter(
    (s) => s.status !== "cancelled" || s.paid_until,
  );
  // Until Mercado Pago confirms the first charge, refresh on its own so the
  // photos appear without reloading (for at most ten minutes).
  const awaitingPayment = Boolean(
    account?.subscriptions.some(
      (s) => s.status === "authorized" && !s.paid_until,
    ),
  );
  useEffect(() => {
    if (!awaitingPayment) return;
    let rounds = 0;
    const timer = setInterval(() => {
      if (++rounds > 40) clearInterval(timer);
      else if (document.visibilityState === "visible") void load();
    }, 15000);
    return () => clearInterval(timer);
  }, [awaitingPayment, load]);
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
      if (p.anonymous) {
        window.location.assign(
          `/acceso?next=${encodeURIComponent(window.location.pathname + window.location.search)}`,
        );
        return;
      }
      setNotice(
        account?.subscriptions.find((s) => s.id === id)?.status === "pending"
          ? "Descartamos el pago sin completar. No se hizo ningún cobro."
          : "Cancelamos la renovación. Conservás el período ya pagado.",
      );
      setCancel("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos cancelar.");
    } finally {
      setBusy(false);
    }
  }
  // Paid photos still in their period: shows the balance against what was bought.
  const active = (account?.grants || []).filter(
    (g) =>
      !g.source_key.startsWith("trial:") &&
      !g.revoked &&
      (!g.expires_at || Date.parse(g.expires_at) > Date.now()),
  );
  const period = {
    total: active.reduce((n, g) => n + g.total, 0),
    // One date only when the whole balance ends together; otherwise the
    // list below gives each expiry.
    renews:
      new Set(active.map((g) => g.expires_at)).size === 1
        ? active[0]?.expires_at
        : null,
  };
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
              // Same path as the header: the server clears the session and
              // the trial cookie. The local session is dropped regardless.
              await fetch("/api/session", { method: "DELETE" }).catch(
                () => null,
              );
              await browserClient()
                ?.auth.signOut({ scope: "local" })
                .catch(() => null);
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
      {returnOrder && (
        <CheckoutReturn
          key={returnOrder}
          order={returnOrder}
          onSettled={load}
        />
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
              <span>{account.free ? "TU PLAN" : "FOTOS DISPONIBLES"}</span>
              <strong>
                {account.free ? "Prueba gratis" : account.credits}
              </strong>
              <p>
                {account.free
                  ? "Diseños con marca de agua, de a 3 por tanda. Para fotos sin marca, elegí un plan."
                  : period.total
                    ? `Te quedan ${account.credits} de ${period.total} fotos${period.renews ? ` hasta el ${date(period.renews)}` : ""}. Cada foto incluye sus regeneraciones.`
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
                {account.subscriptions.some((s) =>
                  ["authorized", "paused"].includes(s.status),
                )
                  ? "Cambiar de plan"
                  : "Elegir un plan"}
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
          {(account.checkouts || [])
            .filter((o) => o.id !== returnOrder)
            .map((o) => (
              <section key={o.id} className="account-panel">
                <h2>Compra por confirmar · {o.snapshot.name}</h2>
                <Link
                  href={`/cuenta?orden=${o.id}`}
                  className="button button-outline"
                  onClick={() => setReturnOrder(o.id)}
                >
                  Verificar o continuar el pago <ArrowUpRight size={17} />
                </Link>
              </section>
            ))}
          <section className="account-panel">
            <h2>Mis suscripciones</h2>
            {!subscriptions.length ? (
              <p>
                Todavía no tenés una suscripción. Podés{" "}
                <Link href="/precios">elegir un plan</Link>.
              </p>
            ) : (
              subscriptions.map((s) => (
                <div key={s.id} className="subscription-row">
                  <div>
                    <h3>{s.orders?.snapshot?.name || "Plan amoblaIA"}</h3>
                    <p>
                      {s.status === "pending"
                        ? "Pago sin completar"
                        : refunded(s)
                          ? "Reembolsada"
                          : s.status === "authorized" && !s.paid_until
                            ? "Esperando el primer pago"
                            : statuses[s.status] || s.status}{" "}
                      · {s.orders?.snapshot?.photos} fotos por mes
                    </p>
                    <p>
                      {refunded(s)
                        ? s.status === "cancelled"
                          ? "Se devolvió el pago y el plan no se renueva."
                          : "Se devolvió el pago. Estamos cancelando la renovación."
                        : s.paid_until
                          ? `Período pagado hasta ${date(s.paid_until)}`
                          : s.status === "pending"
                            ? "Completá el pago en Mercado Pago o verificá su estado."
                            : "Esperando la confirmación del primer pago."}
                    </p>
                  </div>
                  {s.status === "pending" ? (
                    <div className="subscription-actions">
                      <Link className="button button-primary" href="/precios">
                        Elegir un plan
                      </Link>
                      <button
                        className="button button-outline"
                        disabled={busy}
                        onClick={() => cancelSubscription(s.id)}
                      >
                        Descartar
                      </button>
                    </div>
                  ) : (
                    ["authorized", "paused"].includes(s.status) &&
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
                      <div className="subscription-actions">
                        <Link className="button button-primary" href="/precios">
                          Cambiar de plan
                        </Link>
                        <button
                          className="button button-outline"
                          disabled={busy}
                          onClick={() => setCancel(s.id)}
                        >
                          Cancelar renovación
                        </button>
                      </div>
                    ))
                  )}
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
            {active
              .filter((g) => g.remaining > 0)
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
