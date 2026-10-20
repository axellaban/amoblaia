"use client";
import Link from "next/link";
import { useState, useRef } from "react";
import { Check, ArrowUpRight, LoaderCircle, Sparkles } from "lucide-react";
import {
  offers,
  skuFor,
  formatARS,
  type Product,
} from "@/lib/commerce/catalog";
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
    [payerEmail, setPayerEmail] = useState("");
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
      product = products.find((p) => p.sku === sku),
      ready = enabled && product?.active && product.price_cents;
    return (
      <article
        className={`price-card ${offer.id === "standard" ? "featured" : ""}`}
        key={offer.id}
      >
        {offer.id === "standard" && (
          <span className="price-ribbon">PARA TU CARTERA</span>
        )}
        <span className="eyebrow">
          {offer.kind === "pack" ? "PAGO ÚNICO" : "SUSCRIPCIÓN"}
        </span>
        <h2>{offer.name}</h2>
        <p>{offer.description}</p>
        <div className="photo-allowance">
          <strong>{offer.photos}</strong> fotos
          {offer.kind !== "pack" && " / mes"}
        </div>
        <div
          className={product?.price_cents ? "price" : "price price-pending"}
        >
          {product?.price_cents
            ? formatARS(product.price_cents)
            : "Próximamente"}
          <span>
            {product?.price_cents
              ? offer.kind === "pack"
                ? "pago único"
                : annual
                  ? "por año, cobrado completo"
                  : "por mes"
              : "estamos preparando este plan"}
          </span>
        </div>
        {annual && offer.kind !== "pack" && product?.price_cents && (
          <p className="field-hint">
            Equivale a {formatARS(product.price_cents / 12)} por mes. El cupo se
            renueva mensualmente.
          </p>
        )}
        <ul>
          {[
            "Hasta 3 resultados por foto original",
            "Amoblar, rediseñar y vaciar",
            "10 estilos y 8 ambientes",
            "Descargas JPG sin límite",
            "Proyectos privados en tu cuenta",
            offer.kind === "pack"
              ? "Fotos del pack sin vencimiento"
              : "Cancelá la renovación desde tu cuenta",
          ].map((t) => (
            <li key={t}>
              <Check size={16} />
              {t}
            </li>
          ))}
        </ul>
        <button
          className={`button ${offer.id === "standard" ? "button-primary" : "button-outline"}`}
          disabled={!ready || Boolean(busy)}
          onClick={() => buy(sku)}
        >
          {busy === sku ? (
            <LoaderCircle size={18} className="spin" />
          ) : (
            <ArrowUpRight size={18} />
          )}{" "}
          {ready
            ? offer.kind === "pack"
              ? "Comprar pack"
              : "Elegir plan"
            : "Disponible pronto"}
        </button>
      </article>
    );
  }
  return (
    <div className="pricing-page">
      <div className="container">
        <div className="page-intro centered">
          <span className="eyebrow">PARA CADA PROPIEDAD, UNA POSIBILIDAD</span>
          <h1>
            Mostrá lo que
            <br />
            <span>puede ser un hogar.</span>
          </h1>
          <p>
            Elegí un pack para una publicación o un plan para tu trabajo de cada
            mes.
            <br />
            Pagos en pesos argentinos con Mercado Pago.
          </p>
        </div>
        <div className="trial-banner">
          <Sparkles size={24} />
          <div>
            <h2>
              {trial
                ? "Probá con una foto propia, gratis."
                : "Conocé el estudio gratis."}
            </h2>
            <p>
              {trial
                ? "Una foto por cuenta verificada, una sola vez. Sin tarjeta."
                : "Explorá los ejemplos antes de elegir tu plan."}
            </p>
          </div>
          <Link
            className="button button-dark"
            href={trial ? "/acceso" : "/estudio"}
          >
            Empezar <ArrowUpRight size={17} />
          </Link>
        </div>
        <div className="plans-heading">
          <div>
            <span className="eyebrow">PARA QUIEN PUBLICA TODOS LOS MESES</span>
            <h2>Tu próximo hábito de trabajo.</h2>
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
              Anual
            </button>
          </div>
        </div>
        {enabled && (
          <label className="mp-email">
            Email de tu cuenta de Mercado Pago{" "}
            <span>
              Para contratar una suscripción; si lo dejás vacío usamos el email
              de amoblaIA.
            </span>
            <input
              type="email"
              placeholder="tu@email.com"
              value={payerEmail}
              onChange={(e) => setPayerEmail(e.target.value)}
              maxLength={254}
            />
          </label>
        )}
        <div className="pricing-grid commercial-plans">
          {offers.filter((o) => o.kind === "subscription").map(card)}
        </div>
        <div className="plans-heading">
          <div>
            <span className="eyebrow">PARA UNA NECESIDAD PUNTUAL</span>
            <h2>Una compra. Tus próximas fotos.</h2>
            <p>
              Sin renovación automática. También podés sumar un pack a tu
              suscripción.
            </p>
          </div>
        </div>
        <div className="pricing-grid pack-plans">
          {offers.filter((o) => o.kind === "pack").map(card)}
        </div>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="pricing-footnote">
          <h3>Qué cuenta como una foto.</h3>
          <p>
            Una foto original incluye hasta tres resultados en total, combinando
            estilos y operaciones. Descargar no consume fotos. Las fallas
            técnicas confirmadas no consumen tu cupo; una generación en revisión
            conserva su reserva hasta que el equipo resuelva el caso.
          </p>
          <p>
            Los cupos de suscripción se renuevan por período y no se acumulan.
            Los packs no vencen. En el anual, el cupo se habilita mes a mes y se
            cobra el año completo. Cancelar detiene futuras renovaciones y
            conserva el período ya pagado.
          </p>
          <p>
            Los proyectos se guardan mientras estén disponibles en tu cuenta,
            con un límite inicial de 150 fotos originales por usuario. Podés
            borrar proyectos para liberar espacio. Las condiciones de reembolso
            se detallan en los <Link href="/terminos">términos de uso</Link>.
          </p>
        </div>
      </div>
    </div>
  );
}
