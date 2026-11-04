"use client";
// «Comprar créditos», the same selector everywhere: pricing, the panel's
// balance, and the «Necesitás más créditos» stop when a generation has no
// balance. Mounted once (app/layout.tsx); any page opens it with
// openCreditsPurchase(). Paying always goes to the existing Mercado Pago
// checkout (/api/checkout), which takes only the SKU and charges the
// catalog price.
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, Info, Layers, LoaderCircle, X } from "lucide-react";
import { formatARS } from "@/lib/commerce/catalog";
import type { CreditPackage } from "@/lib/commerce/credit-packs";
import { track } from "@/lib/analytics";
import { redirectKeepingClick } from "@/lib/ads";

const EVENT = "habita:credits";
type Request = {
  /** Where it was opened from, for analytics (pricing_free, panel_balance, editor…). */
  source: string;
  /** "no_credits": first the «Necesitás más créditos» explanation. */
  reason?: "no_credits";
  /** The package to start selected. */
  sku?: string;
  /** A visitor without an account yet (an agency's demo): paying creates it first. */
  signupHref?: string;
};
type Packs = {
  packages: CreditPackage[];
  enabled: boolean;
  signedIn: boolean;
  buyer: "self" | "owner";
  agency: string | null;
  balance: number | null;
};

/** Opens the credits selector from anywhere in Habita. */
export function openCreditsPurchase(request: Request) {
  window.dispatchEvent(new CustomEvent<Request>(EVENT, { detail: request }));
}

/** "$9.900": prices in whole pesos, as on the pricing page. */
const ars = (cents: number) => formatARS(cents).replace(/\s/g, "");

export function CreditsPurchaseHost() {
  const [request, setRequest] = useState<Request | null>(null);
  const [step, setStep] = useState<"need" | "pick">("pick");
  const [packs, setPacks] = useState<Packs | null>(null);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const keys = useRef<Record<string, string>>({});
  const dialogRef = useRef<HTMLElement>(null);
  const busyRef = useRef(false);
  busyRef.current = busy;

  const load = useCallback(async (preferred?: string) => {
    setLoadError("");
    try {
      const response = await fetch("/api/billing/packs", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No pudimos cargar los paquetes.");
      const next = payload as Packs;
      setPacks(next);
      setSelected((current) =>
        current && next.packages.some((p) => p.sku === current)
          ? current
          : next.packages.find((p) => p.sku === preferred)?.sku || next.packages[0]?.sku || "",
      );
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "No pudimos cargar los paquetes.");
    }
  }, []);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<Request>).detail;
      if (!detail || busyRef.current) return;
      setRequest(detail);
      setStep(detail.reason === "no_credits" ? "need" : "pick");
      setError("");
      setSelected(detail.sku || "");
      track("credits_purchase_opened", { source: detail.source.slice(0, 40), reason: detail.reason || "buy" });
      void load(detail.sku);
    };
    window.addEventListener(EVENT, onOpen);
    return () => window.removeEventListener(EVENT, onOpen);
  }, [load]);

  const close = useCallback(() => {
    if (!busyRef.current) setRequest(null);
  }, []);

  // Escape closes it, Tab stays inside, and focus goes back to the button that opened it.
  useEffect(() => {
    if (!request) return;
    const opener = document.activeElement as HTMLElement | null;
    const focusFirst = setTimeout(() => (dialogRef.current?.querySelector<HTMLElement>("[data-autofocus]") ?? dialogRef.current?.querySelector<HTMLElement>("button:not([disabled])"))?.focus(), 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "Tab" && dialogRef.current) {
        const items = [...dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), a[href]")];
        if (!items.length) return;
        const first = items[0],
          last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      clearTimeout(focusFirst);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      opener?.focus?.();
    };
  }, [request, close, step]);

  if (!request) return null;
  const pkg = packs?.packages.find((p) => p.sku === selected);
  const here = `${window.location.pathname}${window.location.search}`;

  function choose(p: CreditPackage) {
    if (p.sku === selected) return;
    setSelected(p.sku);
    setError("");
    track("credits_package_selected", { sku: p.sku, credits: p.credits, source: request!.source.slice(0, 40) });
  }

  async function pay() {
    if (!pkg || !packs || busy) return;
    setError("");
    if (request!.signupHref) {
      const url = new URL(request!.signupHref, window.location.origin);
      url.searchParams.set("plan", pkg.sku);
      window.location.assign(`${url.pathname}${url.search}`);
      return;
    }
    if (!packs.signedIn) {
      redirectKeepingClick(`/acceso?next=${encodeURIComponent(`/precios?plan=${pkg.sku}`)}`);
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku: pkg.sku,
          // One order per package and opening: a retry after a lost answer reuses it.
          key: (keys.current[pkg.sku] ||= crypto.randomUUID()),
          returnTo: here,
        }),
      });
      if (response.status === 401) {
        redirectKeepingClick(`/acceso?next=${encodeURIComponent(here)}`);
        return;
      }
      const payload = await response.json();
      // A definite refusal closed that order: the next try is a new one.
      if (response.status >= 400 && response.status < 500) delete keys.current[pkg.sku];
      if (!response.ok) throw new Error(payload.error || "No pudimos abrir Mercado Pago.");
      track("credits_checkout_started", { sku: pkg.sku, credits: pkg.credits, source: request!.source.slice(0, 40) }, true);
      // Shared with Maru Coach's funnel.
      track("checkout_creado", { plan: pkg.sku }, true);
      window.location.assign(payload.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos abrir Mercado Pago.");
      setBusy(false);
    }
  }

  const canPay = Boolean(pkg) && (Boolean(request.signupHref) || (packs?.enabled && packs.buyer === "self"));
  return (
    <div
      className="modal-backdrop hb-credits-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section ref={dialogRef} className="hb-credits" role="dialog" aria-modal="true" aria-labelledby="hb-credits-title">
        <button className="hb-credits-close" aria-label="Cerrar" disabled={busy} onClick={close}>
          <X size={20} />
        </button>
        {step === "need" ? (
          <div className="hb-credits-need">
            <span className="hb-credits-badge" aria-hidden="true">
              <Layers size={26} />
            </span>
            <h2 id="hb-credits-title">Necesitás más créditos</h2>
            <p>Comprá créditos para seguir transformando tus propiedades.</p>
            {typeof packs?.balance === "number" && packs.buyer === "self" && (
              <p className="hb-credits-balance-line">
                Te {packs.balance === 1 ? "queda" : "quedan"} <strong>{packs.balance}</strong> {packs.balance === 1 ? "crédito" : "créditos"}.
              </p>
            )}
            <button className="button button-primary hb-credits-cta" data-autofocus onClick={() => setStep("pick")}>
              Comprar créditos
            </button>
            <button className="hb-credits-later" onClick={close}>
              Ahora no
            </button>
          </div>
        ) : (
          <>
            <h2 id="hb-credits-title">Comprar créditos</h2>
            <p className="hb-credits-sub">Elegí cuántos créditos necesitás para seguir creando</p>
            {!packs ? (
              loadError ? (
                <div className="hb-credits-state" role="alert">
                  <p>{loadError}</p>
                  <button className="button button-outline" onClick={() => void load(selected)}>
                    Reintentar
                  </button>
                </div>
              ) : (
                <p className="hb-credits-state" role="status">
                  <LoaderCircle size={20} className="spin" /> Cargando paquetes…
                </p>
              )
            ) : !packs.packages.length ? (
              <p className="hb-credits-state">Los paquetes de créditos van a estar disponibles muy pronto.</p>
            ) : (
              <div className="hb-credits-list" role="radiogroup" aria-label="Paquetes de créditos">
                {packs.packages.map((p) => {
                  const on = p.sku === selected;
                  return (
                    <button
                      key={p.sku}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      className={`hb-credits-option${on ? " selected" : ""}`}
                      disabled={busy}
                      onClick={() => choose(p)}
                      {...(on ? { "data-autofocus": true } : {})}
                    >
                      <span className="hb-credits-radio" aria-hidden="true">
                        {on && <Check size={14} strokeWidth={3} />}
                      </span>
                      <span className="hb-credits-amount">{p.credits} créditos</span>
                      {p.discount >= 0.01 && <span className="hb-credits-off">−{Math.round(p.discount * 100)}%</span>}
                      <span className="hb-credits-price">
                        <strong>{ars(p.cents)}</strong>
                        <small>{ars(p.unitCents)} por crédito</small>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            <p className="hb-credits-note">
              <Info size={16} aria-hidden="true" />
              <span>
                <strong>Pago único · Sin suscripción</strong>
                <br />
                Los créditos se suman a tu saldo cuando Mercado Pago confirma el pago.
              </span>
            </p>
            {packs?.buyer === "owner" && (
              <p className="hb-credits-warn" role="note">
                Los créditos de {packs.agency || "la inmobiliaria"} los compra la cuenta dueña. Pedíselos a quien la administra.
              </p>
            )}
            {packs && !packs.enabled && !request.signupHref && packs.buyer === "self" && packs.packages.length > 0 && (
              <p className="hb-credits-warn" role="note">
                Estamos terminando de habilitar los pagos. Probá de nuevo en un rato.
              </p>
            )}
            {error && (
              <p className="inline-error" role="alert">
                {error}
              </p>
            )}
            <button className="button button-primary hb-credits-cta" disabled={!canPay || busy} onClick={() => void pay()}>
              {busy ? <LoaderCircle size={18} className="spin" /> : null}
              {busy ? "Abriendo Mercado Pago…" : pkg ? `Pagar ${ars(pkg.cents)} con Mercado Pago` : "Pagar con Mercado Pago"}
              {!busy && <ArrowUpRight size={18} />}
            </button>
            <p className="hb-credits-secure">Pagás en Mercado Pago con tarjeta, dinero en cuenta o los medios que ofrezca.</p>
          </>
        )}
      </section>
    </div>
  );
}
