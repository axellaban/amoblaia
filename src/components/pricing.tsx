"use client";
import Link from "next/link";
import { useState, useRef, useEffect } from "react";
import {
  Check,
  ArrowUpRight,
  LoaderCircle,
  Sparkles,
  Plus,
  Minus,
  BadgeCheck,
  X,
} from "lucide-react";
import {
  offers,
  skuFor,
  formatARS,
  type Product,
} from "@/lib/commerce/catalog";
const features = [
  "Regeneraciones incluidas",
  "Todos los ambientes y estilos",
  "Retiro de muebles incluido",
  "Mejora de foto y día a atardecer",
  "Sin marca de agua",
  "Descargas sin límite",
  "Proyectos privados en tu cuenta",
];
const faqs = [
  [
    "¿Qué cuenta como una foto?",
    "Cada foto original que subís consume una foto de tu plan. Podés generar nuevas propuestas sobre ese original durante la vigencia paga sin consumir otra foto. Las descargas no consumen cupo. Si una generación falla por un problema técnico, la foto no se descuenta.",
  ],
  [
    "¿Qué pasa con las fotos que no uso en el mes?",
    "El cupo se renueva cada mes y no se acumula. En el plan anual se cobra el año completo y el cupo se habilita mes a mes.",
  ],
  [
    "¿Puedo cancelar cuando quiera?",
    "Sí, desde Mi cuenta. Se detienen las próximas renovaciones y seguís usando lo que ya pagaste hasta el final del período.",
  ],
  [
    "¿Puedo cambiar de plan?",
    "Sí: elegí el nuevo plan y completá el pago en Mercado Pago. Al confirmarse el nuevo cobro detenemos la renovación del anterior. Conservás las fotos ya pagadas hasta su vencimiento. No hacemos prorrateos.",
  ],
  [
    "¿Hacen reembolsos?",
    "Podés arrepentirte dentro de los 10 días corridos desde la contratación con el botón de arrepentimiento, sin explicar el motivo. Para otros casos escribinos desde Soporte.",
  ],
  [
    "¿Cómo puedo pagar?",
    "Con Mercado Pago: tarjeta de crédito, débito o dinero en cuenta. Los precios están en pesos argentinos y son finales.",
  ],
];
export function PricingPlans({
  products,
  enabled,
  trial,
  email,
  currentSku,
}: {
  products: Product[];
  enabled: boolean;
  trial: boolean;
  /** Signed-in email, used to require sign-in before opening checkout. */
  email?: string;
  /** The plan the user is subscribed to, if any. */
  currentSku?: string;
}) {
  const checkoutKeys = useRef<Record<string, string>>({});
  const [annual, setAnnual] = useState(!currentSku?.endsWith("-month")),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [payerEmail, setPayerEmail] = useState(""),
    [selectedSku, setSelectedSku] = useState(""),
    [faq, setFaq] = useState<number | null>(null);
  const [expandedPlans, setExpandedPlans] = useState<Record<string, boolean>>(
    {},
  );
  const selectedProduct = products.find((p) => p.sku === selectedSku);
  const modalRef = useRef<HTMLElement>(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  // Escape closes the payment dialog, Tab stays inside it, and focus returns
  // to the plan button that opened it.
  useEffect(() => {
    if (!selectedSku) return;
    const opener = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busyRef.current) {
        e.preventDefault();
        setSelectedSku("");
      } else if (e.key === "Tab" && modalRef.current) {
        const items = [
          ...modalRef.current.querySelectorAll<HTMLElement>(
            "button:not([disabled]), input:not([disabled]), a[href]",
          ),
        ];
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
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus();
    };
  }, [selectedSku]);
  const price = (sku: string) =>
    products.find((p) => p.sku === sku && p.active)?.price_cents || 0;
  // Largest annual saving across plans, rounded down to a multiple of 5.
  const saving = Math.max(
    0,
    ...offers.map((o) => {
      const month = price(skuFor(o.id)),
        year = price(skuFor(o.id, true));
      return month && year ? 1 - year / (month * 12) : 0;
    }),
  );
  const savingLabel =
    saving >= 0.05 ? `hasta ${Math.floor((saving * 100) / 5) * 5}% menos` : "";
  async function buy(sku: string) {
    setBusy(sku);
    setError("");
    const slot = `${sku}:${payerEmail.trim().toLowerCase()}`;
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku,
          key: (checkoutKeys.current[slot] ||= crypto.randomUUID()),
          payerEmail: payerEmail.trim().toLowerCase() || undefined,
        }),
      });
      if (response.status === 401) {
        window.location.assign("/acceso?next=%2Fprecios");
        return;
      }
      const payload = await response.json();
      // A definite refusal closed that order: the next try is a new one.
      // Uncertain errors (5xx) keep the key so a retry cannot duplicate it.
      if (response.status >= 400 && response.status < 500)
        delete checkoutKeys.current[slot];
      if (!response.ok) throw new Error(payload.error);
      window.location.assign(payload.url);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No pudimos abrir el checkout.",
      );
      setBusy("");
    }
  }
  function card(offer: (typeof offers)[number]) {
    const sku = skuFor(offer.id, annual),
      cents = price(sku),
      monthly = annual ? cents / 12 : cents,
      yearlyMonthly = price(skuFor(offer.id, true)) / 12,
      ready = enabled && cents > 0,
      featured = offer.id === "professional";
    return (
      <article
        className={`price-card ${featured ? "featured" : ""}`}
        key={offer.id}
      >
        {featured && <span className="price-ribbon">Más elegido</span>}
        <div className="price-panel">
          <h2>{offer.name}</h2>
          <p>{offer.description}</p>
          <div className="photo-allowance">
            <strong>{offer.photos}</strong> fotos / mes
          </div>
          {cents > 0 ? (
            <>
              <div className="price">
                {formatARS(monthly)} <span>por mes</span>
              </div>
              <small className="per-photo">
                {formatARS(monthly / offer.photos)} por foto
              </small>
              {annual ? (
                <small className="annual-hint">
                  Se cobra {formatARS(cents)} por año
                </small>
              ) : (
                yearlyMonthly > 0 && (
                  <small className="annual-hint">
                    {formatARS(yearlyMonthly)}/mes con plan anual
                  </small>
                )
              )}
            </>
          ) : (
            <div className="price price-pending">Próximamente</div>
          )}
          <button
            className="button button-primary"
            disabled={!ready || Boolean(busy) || sku === currentSku}
            onClick={() => {
              setError("");
              setPayerEmail("");
              // The order belongs to the signed-in customer before leaving for MP.
              if (!email) {
                window.location.assign("/acceso?next=%2Fprecios");
                return;
              }
              // Packs go straight to Checkout Pro, which takes any account.
              if (sku.startsWith("pack-")) void buy(sku);
              else setSelectedSku(sku);
            }}
          >
            {busy === sku ? (
              <LoaderCircle size={18} className="spin" />
            ) : (
              <ArrowUpRight size={18} />
            )}{" "}
            {!ready
              ? "Disponible pronto"
              : sku === currentSku
                ? "Tu plan actual"
                : currentSku
                  ? "Cambiar a este plan"
                  : "Empezar"}
          </button>
        </div>
        <ul className={`plan-features ${expandedPlans[sku] ? "expanded" : ""}`}>
          {features.map((t) => (
            <li key={t}>
              <Check size={16} />
              {t}
            </li>
          ))}
        </ul>
        <button
          className="plan-expand"
          aria-expanded={Boolean(expandedPlans[sku])}
          onClick={() => setExpandedPlans((v) => ({ ...v, [sku]: !v[sku] }))}
        >
          {expandedPlans[sku] ? "Mostrar menos" : "Ver todo lo que incluye"}{" "}
          {expandedPlans[sku] ? <Minus size={15} /> : <Plus size={15} />}
        </button>
      </article>
    );
  }
  return (
    <div className="pricing-page">
      <div className="pricing-band" aria-hidden="true" />
      <div className="container">
        <div className="plans-heading">
          <div>
            <span className="eyebrow cancel-anytime">
              <BadgeCheck size={16} /> CANCELÁ CUANDO QUIERAS
            </span>
            <h1>
              Nuestros planes<span>.</span>
            </h1>
            <p>Elegí el plan de virtual staging para tu trabajo.</p>
          </div>
          <div
            className="billing-toggle"
            aria-label="Frecuencia de facturación"
          >
            <button
              className={!annual ? "selected" : ""}
              onClick={() => setAnnual(false)}
            >
              Mensual
            </button>
            <button
              className={annual ? "selected" : ""}
              onClick={() => setAnnual(true)}
            >
              Anual {savingLabel && <em>{savingLabel}</em>}
            </button>
          </div>
        </div>
        {trial && (
          <div className="trial-banner">
            <Sparkles size={24} />
            <div>
              <h2>Probá con tus fotos, sin registrarte.</h2>
              <p>
                Hasta 3 diseños por tanda. 25 en total por cuenta, con marca de
                agua. Sin tarjeta.
              </p>
            </div>
            <Link className="button button-dark" href="/acceso">
              Empezar <ArrowUpRight size={17} />
            </Link>
          </div>
        )}
        <div className="pricing-grid commercial-plans">{offers.map(card)}</div>
        {error && !selectedSku && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        {selectedSku && (
          <div
            className="modal-backdrop"
            onClick={(e) => {
              if (e.target === e.currentTarget && !busy) setSelectedSku("");
            }}
          >
            <section
              ref={modalRef}
              className="modal checkout-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="checkout-title"
            >
              <button
                className="modal-close icon-button"
                aria-label="Cerrar pago"
                disabled={Boolean(busy)}
                onClick={() => setSelectedSku("")}
              >
                <X size={20} />
              </button>
              <span className="eyebrow">PAGO SEGURO CON MERCADO PAGO</span>
              <h2 id="checkout-title">
                {currentSku ? "Cambiá de plan" : "Completá tu suscripción"}
              </h2>
              {selectedProduct && (
                <div className="checkout-summary">
                  <strong>{selectedProduct.name}</strong>
                  <p>
                    {formatARS(selectedProduct.price_cents || 0)}{" "}
                    {selectedProduct.kind === "year"
                      ? "por año, en un solo cobro"
                      : selectedProduct.kind === "month"
                        ? "por mes"
                        : "por única vez"}
                    {selectedProduct.kind !== "pack" &&
                      " · Renovación automática"}
                  </p>
                  <p>
                    {selectedProduct.photos} fotos originales por mes ·
                    Regeneraciones incluidas
                  </p>
                </div>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void buy(selectedSku);
                }}
              >
                <label htmlFor="mp-payer-email">
                  Email que vas a usar en Mercado Pago
                </label>
                <input
                  id="mp-payer-email"
                  name="payerEmail"
                  type="email"
                  required
                  autoFocus
                  autoComplete="email"
                  maxLength={254}
                  disabled={Boolean(busy)}
                  value={payerEmail}
                  onChange={(e) => {
                    setPayerEmail(e.target.value);
                    setError("");
                  }}
                  placeholder="tu-email@ejemplo.com"
                />
                {error && (
                  <p className="inline-error" role="alert">
                    {error}
                  </p>
                )}
                <button
                  className="button button-primary"
                  disabled={Boolean(busy)}
                >
                  {busy ? (
                    <LoaderCircle size={18} className="spin" />
                  ) : (
                    <ArrowUpRight size={18} />
                  )}
                  {busy
                    ? "Abriendo Mercado Pago…"
                    : "Continuar en Mercado Pago"}
                </button>
              </form>
            </section>
          </div>
        )}
        <section className="faq-layout pricing-faq">
          <div>
            <span className="eyebrow">PREGUNTAS FRECUENTES</span>
            <h2>
              ¿Tenés dudas?
              <br />
              <span>Te respondemos.</span>
            </h2>
          </div>
          <div className="faq-list">
            {faqs.map(([q, a], i) => (
              <div className={`faq-item ${faq === i ? "open" : ""}`} key={q}>
                <h3>
                  <button
                    onClick={() => setFaq(faq === i ? null : i)}
                    aria-expanded={faq === i}
                    aria-controls={`pricing-faq-${i}`}
                  >
                    {q}
                    {faq === i ? <Minus size={18} /> : <Plus size={18} />}
                  </button>
                </h3>
                <div id={`pricing-faq-${i}`} hidden={faq !== i}>
                  <p>{a}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
