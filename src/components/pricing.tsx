"use client";
// Pricing, simplified: «Gratis» and «Comprar créditos» (pago único, sin
// suscripción). Shared by /precios, the panel's «Créditos» and an agency's
// demo. Buying opens the credits selector (credits-purchase.tsx), which pays
// through the existing Mercado Pago checkout.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, Copy, House, Layers, Minus, Plus, BadgeCheck, Share2 } from "lucide-react";
import { formatARS, type Product } from "@/lib/commerce/catalog";
import { creditPackages, FREE_MONTHLY_CREDITS, PRICES_PATH, type CreditPackage } from "@/lib/commerce/credit-packs";
import { track } from "@/lib/analytics";
import { MODE_INFO, VIDEO_CREDITS, type VideoMode } from "@/lib/video/plan";
import { cta } from "@/lib/interaction-tracking";
import { openCreditsPurchase } from "./credits-purchase";

const faqs = [
  [
    "¿Qué es un crédito?",
    "Un crédito transforma una foto con IA. Las demás versiones y estilos de esa misma foto no consumen otro crédito. Si una generación falla por un problema técnico, el crédito vuelve solo a tu saldo.",
  ],
  [
    "¿Cómo funciona el plan Gratis?",
    `Cada inmobiliaria verificada recibe ${FREE_MONTHLY_CREDITS} créditos gratis por mes, sin tarjeta. Se renuevan el primer día de cada mes y no se acumulan: los que no usás vencen a fin de mes. Se usan antes que los créditos comprados.`,
  ],
  [
    "¿Los créditos comprados vencen?",
    "Duran 12 meses desde la compra y se suman a tu saldo. Podés comprar más cuando quieras: pagás una sola vez y no hay suscripción ni renovación automática.",
  ],
  [
    "¿Cómo pago?",
    "Siempre con Mercado Pago: tarjeta de crédito, débito, dinero en cuenta o los medios que ofrezca. Los precios están en pesos argentinos y son finales. Los créditos se acreditan cuando Mercado Pago confirma el pago.",
  ],
  [
    "Ya tengo un plan mensual o anual, ¿qué pasa?",
    "Sigue igual: conservás tu plan, tus fotos y tu historial. Lo gestionás (o lo cancelás) desde Mi cuenta, y si querés podés sumar créditos aparte.",
  ],
  [
    "¿Hacen reembolsos?",
    "Podés arrepentirte dentro de los 10 días corridos desde la compra con el botón de arrepentimiento, sin explicar el motivo. Para otros casos escribinos desde Soporte.",
  ],
];
/** What the panel does without spending credits (only AI generations use them). */
const FREE_FEATURES = ["Propiedades", "Usuarios del equipo", "Sitio web propio", "Demos para compartir"];
/** The video styles the video studio offers today, in its order and with its names. */
const SHEET_VIDEO_MODES: VideoMode[] = ["classic", "clip", "cinematic"];
const ars = (cents: number) => formatARS(cents).replace(/\s/g, "");

export function PricingPlans({
  products,
  enabled,
  email,
  currentSku,
  signupHref,
  initialSku,
  balance,
  surface = "precios",
}: {
  products: Product[];
  enabled: boolean;
  trial?: boolean;
  /** Signed-in email. */
  email?: string;
  /** A plan the user is still subscribed to (sold before the simplification). */
  currentSku?: string;
  firstPackUsed?: boolean;
  renderedAt?: number;
  /** Someone without an account yet (an invited agency): buying starts by creating it. */
  signupHref?: string;
  /** A pack chosen before signing in or creating the account: its selector opens right away. */
  initialSku?: string;
  userId?: string;
  /** The signed-in account's balance, when known. */
  balance?: number | null;
  /** Where this page is shown, for analytics. */
  surface?: "precios" | "panel" | "demo";
}) {
  const packages = creditPackages(products);
  const cheapest = packages[0];
  const best = packages.reduce((m, p) => (p.discount > (m?.discount ?? 0) ? p : m), packages[0]);
  const [faq, setFaq] = useState<number | null>(null);
  const where = signupHref ? "demo" : surface;
  const open = (source: string, sku?: string) => openCreditsPurchase({ source: `${where}_${source}`, sku, signupHref });

  // Once per page view (a remount of the same page does not count twice).
  const viewed = useRef(false);
  useEffect(() => {
    if (viewed.current) return;
    viewed.current = true;
    track("pricing_viewed", { surface: where, signed_in: Boolean(email), packages: packages.length });
  }, [where, email, packages.length]);

  // Back from signing in (or creating the account) with a pack chosen: its selector opens once.
  const reopened = useRef(false);
  useEffect(() => {
    if (reopened.current || !initialSku || !email || signupHref) return;
    if (!packages.some((p) => p.sku === initialSku)) return;
    reopened.current = true;
    openCreditsPurchase({ source: `${where}_return`, sku: initialSku });
  }, [initialSku, email, signupHref, packages, where]);

  const freeHref = signupHref || (email ? "/panel" : "/acceso?next=%2Fpanel");
  const ready = packages.length > 0 && (enabled || Boolean(signupHref) || !email);

  return (
    <div className="pricing-page hb-pricing">
      <div className="container">
        <header className="hb-pricing-head">
          <span className="eyebrow">
            <BadgeCheck size={16} aria-hidden="true" /> SIN SUSCRIPCIÓN · PAGO CON MERCADO PAGO
          </span>
          <h1>
            Empezá gratis.
            <br />
            Pagá cuando lo necesites.
          </h1>
          <p>Transformá tus propiedades con IA, probá diferentes estilos y compartí los resultados.</p>
          {typeof balance === "number" && (
            <p className="hb-pricing-balance">
              <Layers size={16} aria-hidden="true" />
              <span>
                Tenés <strong>{balance}</strong> {balance === 1 ? "crédito disponible" : "créditos disponibles"}
              </span>
            </p>
          )}
        </header>

        {currentSku && (
          <p className="hb-pricing-legacy" role="note">
            Tenés un plan activo: sigue igual. Lo gestionás desde{" "}
            <Link href="/cuenta" className="text-link">
              Mi cuenta
            </Link>
            , y podés sumar créditos cuando quieras.
          </p>
        )}

        {packages.length > 0 && <PriceSheet packages={packages} ready={ready} where={where} onBuy={(sku) => open("price_sheet", sku)} />}

        <div className="hb-plans">
          <article className="hb-plan">
            <h2>Gratis</h2>
            <p className="hb-plan-for">Para descubrir Habita</p>
            <div className="hb-plan-price">$0</div>
            <ul>
              <li>
                <Check size={17} aria-hidden="true" /> {FREE_MONTHLY_CREDITS} créditos con IA por mes
              </li>
              <li>
                <Check size={17} aria-hidden="true" /> Para inmobiliarias verificadas
              </li>
              <li>
                <Check size={17} aria-hidden="true" /> Demo interactiva y sitio de la inmobiliaria
              </li>
              <li>
                <Check size={17} aria-hidden="true" /> Compartir resultados
              </li>
              <li>
                <Check size={17} aria-hidden="true" /> Sin tarjeta
              </li>
            </ul>
            <Link
              href={freeHref}
              className="button button-outline hb-plan-cta"
              {...cta("pricing_start_free", `${where}_free`, signupHref ? "signup_invitation" : "panel", "habita_b2b")}
            >
              Empezar gratis
            </Link>
          </article>

          <article className="hb-plan hb-plan-buy">
            <h2>Comprar créditos</h2>
            <p className="hb-plan-for">Para seguir creando</p>
            <div className="hb-plan-from">{cheapest ? "Desde" : " "}</div>
            <div className="hb-plan-price">{cheapest ? ars(cheapest.cents) : "Próximamente"}</div>
            <ul>
              <li>
                <Check size={17} aria-hidden="true" /> {cheapest ? `Paquetes de ${packages.map((p) => p.credits).join(", ").replace(/, (\d+)$/, " o $1")} créditos` : "Paquetes de créditos"}
              </li>
              <li>
                <Check size={17} aria-hidden="true" /> Sin suscripción
              </li>
              <li>
                <Check size={17} aria-hidden="true" /> Pagás una sola vez
              </li>
              <li>
                <Check size={17} aria-hidden="true" /> Se suman a tu saldo
              </li>
              <li>
                <Check size={17} aria-hidden="true" /> {best && best.discount >= 0.01 ? `Hasta ${Math.round(best.discount * 100)}% menos por volumen` : "Comprás cuando quieras"}
              </li>
            </ul>
            <button
              type="button"
              className="button button-primary hb-plan-cta"
              disabled={!ready}
              {...cta("pricing_buy_credits", `${where}_buy`, signupHref ? "signup_invitation" : "checkout", "habita_b2b")}
              onClick={() => open("buy_card")}
            >
              {ready ? "Comprar créditos" : "Disponible pronto"} <ArrowUpRight size={18} aria-hidden="true" />
            </button>
          </article>
        </div>

        <section className="hb-how" id="como-funcionan-los-creditos" aria-labelledby="hb-how-title">
          <h2 id="hb-how-title">Cómo funcionan los créditos</h2>
          <ol>
            <li>
              <House size={22} aria-hidden="true" />
              <strong>1 crédito = 1 foto transformada</strong>
              <span>Las demás versiones y estilos de esa foto no usan otro crédito.</span>
            </li>
            <li>
              <Layers size={22} aria-hidden="true" />
              <strong>Un solo saldo</strong>
              <span>Los {FREE_MONTHLY_CREDITS} gratis del mes se usan primero; después, los que compraste.</span>
            </li>
            <li>
              <BadgeCheck size={22} aria-hidden="true" />
              <strong>Sin sorpresas</strong>
              <span>Si una generación falla por un problema técnico, el crédito vuelve solo.</span>
            </li>
          </ol>
        </section>

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
                  <button onClick={() => setFaq(faq === i ? null : i)} aria-expanded={faq === i} aria-controls={`pricing-faq-${i}`}>
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

/**
 * All the prices in one card, made to be sent as a screenshot or a link
 * (people ask for them a lot). The link, /panel/precios, opens this card in
 * the agency's own panel, or on /precios for someone without one.
 */
function PriceSheet({
  packages,
  ready,
  where,
  onBuy,
}: {
  packages: CreditPackage[];
  ready: boolean;
  where: string;
  onBuy: (sku: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);
  useEffect(() => setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function"), []);
  const link = () => `${window.location.origin}${PRICES_PATH}`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(link());
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
      track("pricing_link_copied", { surface: where });
    } catch {
      window.prompt("Copiá el link de precios:", link());
    }
  }
  async function share() {
    try {
      await navigator.share({ title: "Precios de habita.", text: "Los precios de habita.: 10 créditos gratis por mes y paquetes de créditos sin suscripción.", url: link() });
      track("pricing_link_shared", { surface: where });
    } catch {
      /* Closed without sharing. */
    }
  }
  return (
    <section className="hb-sheet-wrap" id="precios" aria-labelledby="hb-sheet-title">
      <div className="hb-sheet">
        <header>
          <span className="hb-sheet-brand">habita.</span>
          <h2 id="hb-sheet-title">Precios</h2>
        </header>
        <div className="hb-sheet-free">
          <div>
            <strong>Gratis</strong>
            <span>{FREE_MONTHLY_CREDITS} créditos por mes · sin tarjeta</span>
          </div>
          <b>$0</b>
        </div>
        <p className="hb-sheet-label">Paquetes de créditos · pago único</p>
        <ul>
          {packages.map((p) => (
            <li key={p.sku}>
              <button type="button" disabled={!ready} onClick={() => onBuy(p.sku)} {...cta("pricing_sheet_pack", `${where}_sheet`, "checkout", "habita_b2b", { plan: p.sku })}>
                <span className="hb-sheet-amount">
                  <strong>{p.credits}</strong> créditos
                </span>
                <span className="hb-sheet-unit">
                  {ars(p.unitCents)} c/u
                  {p.discount >= 0.01 && <em>−{Math.round(p.discount * 100)}%</em>}
                </span>
                <b>{ars(p.cents)}</b>
              </button>
            </li>
          ))}
        </ul>
        <div className="hb-sheet-uses" aria-label="Cuántos créditos usa cada cosa">
          <p>Imagen</p>
          <dl>
            <div>
              <dt>Foto transformada con IA</dt>
              <dd>1 crédito</dd>
            </div>
          </dl>
          <p>Video</p>
          <dl>
            {SHEET_VIDEO_MODES.map((m) => (
              <div key={m}>
                <dt>{MODE_INFO[m].name}</dt>
                <dd className={VIDEO_CREDITS[m] ? "" : "is-free"}>{VIDEO_CREDITS[m] ? `${VIDEO_CREDITS[m]} créditos` : "Sin créditos"}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="hb-sheet-free-list">
          <p>Incluido gratis, sin usar créditos</p>
          <ul>
            {FREE_FEATURES.map((f) => (
              <li key={f}>
                <Check size={14} aria-hidden="true" /> {f}
              </li>
            ))}
          </ul>
        </div>
        <footer>
          <span>Sin suscripción · Pagás con Mercado Pago · Los créditos duran 12 meses</span>
        </footer>
      </div>
      <div className="hb-sheet-share">
        <button type="button" className="button button-outline" onClick={() => void copy()}>
          {copied ? <Check size={17} aria-hidden="true" /> : <Copy size={17} aria-hidden="true" />} {copied ? "¡Link copiado!" : "Copiar link de precios"}
        </button>
        {canShare && (
          <button type="button" className="button button-outline" onClick={() => void share()}>
            <Share2 size={17} aria-hidden="true" /> Compartir
          </button>
        )}
        <small>Tip: hacé una captura de esta tarjeta para mandarla por WhatsApp.</small>
      </div>
    </section>
  );
}
