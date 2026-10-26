"use client";
import { redirectKeepingClick } from "@/lib/ads";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, LoaderCircle, RefreshCw } from "lucide-react";
import {
  checkoutMessages,
  type CheckoutResult,
} from "@/lib/commerce/checkout-result";
import { track } from "@/lib/analytics";
import { metaTrack } from "@/lib/meta";

// Reported once per order, also across reloads of the return page.
function trackSubscribe(result: CheckoutResult) {
  const key = `meta-subscribe-${result.order}`;
  try {
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, "1");
  } catch {
    /* Without storage the shared event ID still deduplicates in Meta. */
  }
  metaTrack(
    "Subscribe",
    result.value != null ? { value: result.value, currency: "ARS" } : {},
    true,
    { eventId: `subscribe-${result.order}` },
  );
  track("compra_confirmada", {
    plan: result.name,
    ...(result.value != null && { monto: result.value }),
  });
}

export function CheckoutReturn({
  order,
  onSettled,
}: {
  order: string;
  onSettled: () => Promise<void>;
}) {
  const [result, setResult] = useState<CheckoutResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const check = useCallback(async () => {
    if (inFlight.current) return null;
    inFlight.current = true;
    setBusy(true);
    try {
      const response = await fetch("/api/billing/checkout-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order }),
      });
      if (response.status === 401) {
        redirectKeepingClick(
          `/acceso?next=${encodeURIComponent(`/cuenta?orden=${order}`)}`,
        );
        return null;
      }
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error || "No pudimos consultar el pago.");
      const next = payload as CheckoutResult;
      setResult(next);
      setError("");
      if (next.state === "approved") trackSubscribe(next);
      if (
        ["approved", "refunded", "cancelled", "duplicate"].includes(next.state)
      )
        await onSettled();
      return next;
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "No pudimos consultar el pago. Volvé a verificar en unos momentos.",
      );
      return null;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [order, onSettled]);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let rounds = 0;
    const poll = async () => {
      const next = await check();
      if (
        stopped ||
        ++rounds >= 40 ||
        (next &&
          [
            "approved",
            "refunded",
            "cancelled",
            "rejected",
            "duplicate",
          ].includes(next.state))
      )
        return;
      timer = setTimeout(
        () => {
          if (document.visibilityState === "visible") void poll();
          else timer = setTimeout(poll, 15000);
        },
        rounds < 3 ? 5000 : 15000,
      );
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [check]);
  const approved = result?.state === "approved";
  return (
    <section
      className="account-panel checkout-result"
      aria-labelledby={`payment-${order}`}
    >
      <h2 id={`payment-${order}`}>
        {approved ? "Pago confirmado" : "Tu compra"}
        {result?.name ? ` · ${result.name}` : ""}
      </h2>
      <p role="status" aria-live="polite">
        {approved ? (
          <Check size={20} />
        ) : busy ? (
          <LoaderCircle size={20} className="spin" />
        ) : null}
        {result
          ? checkoutMessages[result.state]
          : "Estamos consultando el estado de tu pago."}
      </p>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <div className="checkout-result-actions">
        {approved ? (
          <Link href="/estudio" className="button button-primary">
            Crear un diseño <ArrowUpRight size={17} />
          </Link>
        ) : result?.url ? (
          <a href={result.url} className="button button-primary">
            Continuar en Mercado Pago <ArrowUpRight size={17} />
          </a>
        ) : result?.state === "cancelled" || result?.state === "rejected" ? (
          <Link href="/precios" className="button button-primary">
            Elegir un plan
          </Link>
        ) : null}
        {!approved && (
          <button
            className="button button-outline"
            onClick={() => void check()}
            disabled={busy}
          >
            <RefreshCw size={17} className={busy ? "spin" : ""} /> Verificar
            pago
          </button>
        )}
      </div>
    </section>
  );
}
