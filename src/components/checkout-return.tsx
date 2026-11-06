"use client";
import { redirectKeepingClick } from "@/lib/ads";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, Clock, Layers, LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";
import {
  checkoutMessages,
  type CheckoutResult,
} from "@/lib/commerce/checkout-result";
import { track } from "@/lib/analytics";
import { metaTrack } from "@/lib/meta";
import { safeReturnTo } from "@/lib/commerce/credit-packs";
import { openCreditsPurchase } from "./credits-purchase";

/** A credits purchase's outcome, once per order and outcome, also across reloads.
 * Only the package and amounts: never payment details. */
function trackCredits(result: CheckoutResult) {
  if (result.credits == null) return;
  const outcome =
    result.state === "approved"
      ? "credits_payment_approved"
      : result.state === "pending" || result.state === "review"
        ? "credits_payment_pending"
        : result.state === "rejected" || result.state === "cancelled"
          ? "credits_payment_failed"
          : null;
  if (!outcome) return;
  const once = (event: string, props: Record<string, string | number>) => {
    const key = `habita-${event}-${result.order}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, "1");
    } catch {
      /* Without storage it may repeat on a reload; the order ID tells them apart. */
    }
    track(event, props);
  };
  const base = { order_id: result.order, credits: result.credits };
  once(outcome, { ...base, state: result.state, ...(result.value != null && { monto: result.value }) });
  if (outcome === "credits_payment_approved" && typeof result.balance === "number")
    once("credits_balance_updated", { ...base, balance: result.balance });
}

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
      trackCredits(next);
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
  if (result?.credits != null)
    return <CreditsResult result={result} busy={busy} error={error} onCheck={() => void check()} />;
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
          <Link href="/inicio?ir=imagenes" className="button button-primary">
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

/** Where «Volver» leads: the page the purchase started from, or the panel. */
function backTarget() {
  const back = safeReturnTo(new URLSearchParams(window.location.search).get("volver"));
  return back || "/panel";
}

/** A credits pack: «¡Listo!» only once the server confirmed the payment. */
function CreditsResult({ result, busy, error, onCheck }: { result: CheckoutResult; busy: boolean; error: string; onCheck: () => void }) {
  const [back, setBack] = useState("/panel");
  useEffect(() => setBack(backTarget()), []);
  const backLabel = back.startsWith("/panel") && !back.startsWith("/panel/creditos") && back !== "/panel" ? "Volver a donde estabas" : "Volver al panel";
  const state = result.state;
  const buyMore = (
    <button type="button" className="button button-outline" onClick={() => openCreditsPurchase({ source: `checkout_${state}` })}>
      {state === "approved" ? "Comprar más créditos" : "Elegir otro paquete"}
    </button>
  );
  if (state === "approved")
    return (
      <section className="account-panel hb-done" aria-labelledby={`payment-${result.order}`}>
        <span className="hb-done-check" aria-hidden="true">
          <Check size={34} strokeWidth={3} />
        </span>
        <h2 id={`payment-${result.order}`}>¡Listo!</h2>
        <p role="status">
          Se acreditaron {result.credits} {result.credits === 1 ? "crédito" : "créditos"} en tu cuenta.
        </p>
        {typeof result.balance === "number" && (
          <div className="hb-done-balance">
            <Layers size={24} aria-hidden="true" />
            <span>
              <small>Nuevo saldo</small>
              <strong>
                {result.balance} {result.balance === 1 ? "crédito" : "créditos"}
              </strong>
            </span>
          </div>
        )}
        <div className="hb-done-actions">
          <Link href={back} className="button button-primary">
            {backLabel}
          </Link>
          {buyMore}
        </div>
      </section>
    );
  const waiting = state === "pending" || state === "review";
  const failed = state === "rejected" || state === "cancelled";
  return (
    <section className={`account-panel hb-done ${failed ? "failed" : "waiting"}`} aria-labelledby={`payment-${result.order}`}>
      <span className="hb-done-check" aria-hidden="true">
        {failed ? <TriangleAlert size={30} /> : <Clock size={30} />}
      </span>
      <h2 id={`payment-${result.order}`}>
        {waiting ? "Pago pendiente" : failed ? "El pago no se completó" : "Tu compra"}
      </h2>
      <p role="status" aria-live="polite">
        {busy && <LoaderCircle size={18} className="spin" />}
        {waiting
          ? `Mercado Pago todavía está confirmando el pago de ${result.credits} créditos. Los vamos a acreditar apenas se apruebe; no hace falta pagar de nuevo.`
          : failed
            ? "Mercado Pago no aprobó el pago, así que no se acreditaron créditos ni se te cobró. Podés intentarlo de nuevo."
            : checkoutMessages[state]}
      </p>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <div className="hb-done-actions">
        {result.url ? (
          <a href={result.url} className="button button-primary">
            Continuar en Mercado Pago <ArrowUpRight size={17} />
          </a>
        ) : failed ? (
          buyMore
        ) : null}
        {!failed && (
          <button className="button button-outline" onClick={onCheck} disabled={busy}>
            <RefreshCw size={17} className={busy ? "spin" : ""} /> Verificar pago
          </button>
        )}
        <Link href={back} className="text-link">
          Volver al panel
        </Link>
      </div>
    </section>
  );
}
