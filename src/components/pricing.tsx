"use client";
import Link from "next/link";
import { useState, useRef } from "react";
import {
  Check,
  ArrowUpRight,
  LoaderCircle,
  Sparkles,
  Plus,
  Minus,
  BadgeCheck,
} from "lucide-react";
import {
  offers,
  skuFor,
  formatARS,
  type Product,
} from "@/lib/commerce/catalog";
const features = [
  "Hasta 3 resultados por foto",
  "Todos los ambientes y estilos",
  "Retiro de muebles incluido",
  "Sin marca de agua",
  "Descargas sin límite",
  "Proyectos privados en tu cuenta",
];
const faqs = [
  [
    "¿Qué cuenta como una foto?",
    "Cada foto original que subís. Incluye hasta tres resultados entre estilos y operaciones, y descargarlos no consume fotos. Si una generación falla por un problema técnico, la foto no se descuenta.",
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
    "Sí. Cancelá tu plan actual desde Mi cuenta y elegí el nuevo. No hacemos prorrateos automáticos.",
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
}: {
  products: Product[];
  enabled: boolean;
  trial: boolean;
}) {
  const checkoutKeys = useRef<Record<string, string>>({});
  const [annual, setAnnual] = useState(false),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [payerEmail, setPayerEmail] = useState(""),
    [otherEmail, setOtherEmail] = useState(false),
    [faq, setFaq] = useState<number | null>(null);
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
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku,
          key: (checkoutKeys.current[sku] ||= crypto.randomUUID()),
          payerEmail: payerEmail || undefined,
        }),
      });
      if (response.status === 401) {
        window.location.assign("/acceso?next=%2Fprecios");
        return;
      }
      const payload = await response.json();
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
            disabled={!ready || Boolean(busy)}
            onClick={() => buy(sku)}
          >
            {busy === sku ? (
              <LoaderCircle size={18} className="spin" />
            ) : (
              <ArrowUpRight size={18} />
            )}{" "}
            {ready ? "Empezar" : "Disponible pronto"}
          </button>
        </div>
        <ul>
          {features.map((t) => (
            <li key={t}>
              <Check size={16} />
              {t}
            </li>
          ))}
        </ul>
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
              <h2>Probá con una foto propia, gratis.</h2>
              <p>Una foto por cuenta verificada, una sola vez. Sin tarjeta.</p>
            </div>
            <Link className="button button-dark" href="/acceso">
              Empezar <ArrowUpRight size={17} />
            </Link>
          </div>
        )}
        <div className="pricing-grid commercial-plans">{offers.map(card)}</div>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        {enabled &&
          (otherEmail ? (
            <label className="mp-email">
              Email de tu cuenta de Mercado Pago
              <input
                type="email"
                placeholder="tu@email.com"
                value={payerEmail}
                onChange={(e) => setPayerEmail(e.target.value)}
                maxLength={254}
              />
            </label>
          ) : (
            <button
              className="mp-email-toggle"
              onClick={() => setOtherEmail(true)}
            >
              ¿Tu cuenta de Mercado Pago usa otro email?
            </button>
          ))}
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
