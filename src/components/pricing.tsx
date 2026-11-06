"use client";
// Pricing: «Gratis» and «Comprar créditos» (pago único, sin suscripción).
// One component, two variants: the public one (/precios and an agency's demo)
// shows the free plan next to the packs; the panel's («Precios y créditos»)
// shows only the packs, since the agency already has its account and its
// balance is shown right above by the panel. The packs, their price per
// credit and their saving come from the catalog. Buying opens the credits
// selector (credits-purchase.tsx) with the chosen pack, which pays through
// the existing Mercado Pago checkout.
import Link from "next/link";
import { useEffect, useId, useRef, useState, type SyntheticEvent } from "react";
import {
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  Check,
  ChevronDown,
  CircleHelp,
  Copy,
  ExternalLink,
  House,
  Layers,
  MessageCircle,
  Share2,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Zap,
} from "lucide-react";
import { formatARS, type Product } from "@/lib/commerce/catalog";
import {
  creditPackages,
  FREE_MONTHLY_CREDITS,
  PRICES_PATH,
  recommendedPackage,
  validityLabel,
  type CreditPackage,
} from "@/lib/commerce/credit-packs";
import { track } from "@/lib/analytics";
import { MODE_INFO, VIDEO_CREDITS, type VideoMode } from "@/lib/video/plan";
import { cta } from "@/lib/interaction-tracking";
import { UX_VERSIONS } from "@/lib/ux-context";
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
/** The pricing design on every pricing event, also where it is embedded in another flow (panel, demo). */
const PRICING_UX = `v${UX_VERSIONS.pricing}`;
/** The collapsible sections, by the anchor that opens each one (#como-funcionan-los-creditos is linked from the credits menu). */
const MORE_IDS = ["como-funcionan-los-creditos", "que-incluye", "preguntas-frecuentes"] as const;

/**
 * NAR, 2025 Profile of Home Staging (encuesta a REALTORS® de EE. UU., febrero
 * de 2025): respuestas de agentes sobre el home staging en general. No son
 * resultados de Habita ni del virtual staging con IA, y así se dice en pantalla.
 */
const STAGING_SOURCE = "https://www.nar.realtor/research-and-statistics/research-reports/profile-of-home-staging";
const STAGING_STATS = [
  { value: "83%", icon: House, text: "de los agentes de compradores dice que el staging ayuda a imaginar la propiedad como su futuro hogar." },
  { value: "49%", icon: Zap, text: "de los agentes de vendedores reporta que el staging redujo el tiempo que la propiedad estuvo a la venta." },
  { value: "29%", icon: TrendingUp, text: "de los agentes de vendedores reporta un aumento de entre 1% y 10% en el valor ofrecido." },
] as const;

const ars = (cents: number) => formatARS(cents).replace(/\s/g, "");
const pct = (discount: number) => Math.round(discount * 100);

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
  /** The signed-in account's balance, when known (shown on the public page; the panel shows the agency's own). */
  balance?: number | null;
  /** Where this page is shown, for analytics. */
  surface?: "precios" | "panel" | "demo";
}) {
  const packages = creditPackages(products);
  const recommended = recommendedPackage(packages);
  const where = signupHref ? "demo" : surface;
  /** The agency's panel: no free plan to start (it has its account) and no page heading (the panel has its own). */
  const panel = where === "panel";
  const [selected, setSelected] = useState(() => packages.find((p) => p.sku === initialSku)?.sku ?? recommended?.sku ?? "");
  const pkg = packages.find((p) => p.sku === selected) ?? recommended;
  const open = (source: string, sku?: string) => openCreditsPurchase({ source: `${where}_${source}`, sku, signupHref });
  const packsName = useId();

  // Once per page view (a remount of the same page does not count twice).
  const viewed = useRef(false);
  useEffect(() => {
    if (viewed.current) return;
    viewed.current = true;
    track("pricing_viewed", { surface: where, signed_in: Boolean(email), packages: packages.length, pricing_ux_version: PRICING_UX });
  }, [where, email, packages.length]);

  // The packs really seen: most of them on screen, once per page view.
  const packsRef = useRef<HTMLFieldSetElement>(null);
  const packsSeen = useRef(false);
  const recommendedSku = recommended?.sku;
  useEffect(() => {
    const el = packsRef.current;
    if (!el || packsSeen.current || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (packsSeen.current || !entries.some((e) => e.isIntersecting)) return;
        packsSeen.current = true;
        io.disconnect();
        track("pricing_packages_viewed", {
          surface: where,
          signed_in: Boolean(email),
          packages: packages.length,
          recommended: recommendedSku ?? "none",
          pricing_ux_version: PRICING_UX,
        });
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [where, email, packages.length, recommendedSku]);

  // Back from signing in (or creating the account) with a pack chosen: its selector opens once.
  const reopened = useRef(false);
  useEffect(() => {
    if (reopened.current || !initialSku || !email || signupHref) return;
    if (!packages.some((p) => p.sku === initialSku)) return;
    reopened.current = true;
    openCreditsPurchase({ source: `${where}_return`, sku: initialSku });
  }, [initialSku, email, signupHref, packages, where]);

  function choose(p: CreditPackage) {
    if (p.sku === selected) return;
    setSelected(p.sku);
    track("pricing_package_selected", {
      surface: where,
      sku: p.sku,
      credits: p.credits,
      discount_pct: pct(p.discount),
      recommended: p.sku === recommendedSku,
      pricing_ux_version: PRICING_UX,
    });
  }

  const freeHref = signupHref || (email ? "/panel" : "/acceso?next=%2Fpanel");
  const ready = packages.length > 0 && (enabled || Boolean(signupHref) || !email);
  const validity = validityLabel(packages[0]?.validDays);

  return (
    <div className={`pricing-page hb-pricing${panel ? " hb-pricing-panel" : ""}`}>
      <div className="container">
        {!panel && (
          <header className="hb-pricing-head">
            <span className="eyebrow">Precios</span>
            <h1>Precios simples. Sin suscripción.</h1>
            <p>Empezá gratis y comprá créditos solo cuando los necesites.</p>
            <ul className="hb-pricing-points">
              <li>
                <BadgeCheck size={18} aria-hidden="true" /> IA para ambientar tus propiedades
              </li>
              <li>
                <BadgeCheck size={18} aria-hidden="true" /> Demos interactivas y sitio web
              </li>
              <li>
                <BadgeCheck size={18} aria-hidden="true" /> Pago único, sin renovación
              </li>
            </ul>
            {typeof balance === "number" && (
              <p className="hb-pricing-balance">
                <Layers size={16} aria-hidden="true" />
                <span>
                  Tenés <strong>{balance}</strong> {balance === 1 ? "crédito disponible" : "créditos disponibles"}
                </span>
              </p>
            )}
          </header>
        )}

        {currentSku && (
          <p className="hb-pricing-legacy" role="note">
            Tenés un plan activo: sigue igual. Lo gestionás desde{" "}
            <Link href="/cuenta" className="text-link">
              Mi cuenta
            </Link>
            , y podés sumar créditos cuando quieras.
          </p>
        )}

        <div className={`hb-offer${panel ? " hb-offer-panel" : ""}`}>
          {!panel && (
            <article className="hb-free" aria-labelledby="hb-free-title">
              <h2 id="hb-free-title">Plan Gratis</h2>
              <p className="hb-free-price">$0</p>
              <ul>
                <li>
                  <Check size={16} aria-hidden="true" /> {FREE_MONTHLY_CREDITS} créditos con IA por mes
                </li>
                <li>
                  <Check size={16} aria-hidden="true" /> Demos interactivas y sitio web
                </li>
                <li>
                  <Check size={16} aria-hidden="true" /> Para inmobiliarias verificadas
                </li>
                <li>
                  <Check size={16} aria-hidden="true" /> Sin tarjeta
                </li>
              </ul>
              <Link
                href={freeHref}
                className="button button-outline hb-free-cta"
                {...cta("pricing_start_free", `${where}_free`, signupHref ? "signup_invitation" : "panel", "habita_b2b")}
              >
                Empezar gratis
              </Link>
            </article>
          )}

          <section className="hb-buy" id="precios" aria-labelledby="hb-buy-title">
            <h2 id="hb-buy-title">{panel ? "Sumá créditos cuando quieras" : "Comprá créditos cuando quieras"}</h2>
            <p className="hb-buy-sub">1 crédito = 1 foto transformada con IA</p>
            {packages.length > 0 ? (
              <fieldset className="hb-packs-grid" ref={packsRef}>
                <legend className="visually-hidden">Elegí un paquete de créditos</legend>
                {packages.map((p) => {
                  const on = p.sku === pkg?.sku;
                  const rec = p.sku === recommendedSku;
                  return (
                    <label key={p.sku} className={`hb-pack${on ? " is-selected" : ""}${rec ? " is-recommended" : ""}`}>
                      <input type="radio" className="visually-hidden" name={packsName} value={p.sku} checked={on} onChange={() => choose(p)} />
                      {rec && <span className="hb-pack-badge">Recomendado</span>}
                      <span className="hb-pack-credits">
                        <strong>{p.credits}</strong> créditos
                      </span>
                      <span className="hb-pack-price">{ars(p.cents)}</span>
                      <span className="hb-pack-unit">{ars(p.unitCents)} por crédito</span>
                      {p.discount >= 0.01 ? (
                        <span className="hb-pack-save">Ahorrás {pct(p.discount)}%</span>
                      ) : (
                        <span className="hb-pack-save is-base">Precio base</span>
                      )}
                    </label>
                  );
                })}
              </fieldset>
            ) : (
              <p className="hb-buy-soon">Los paquetes de créditos van a estar disponibles muy pronto.</p>
            )}
            <button
              type="button"
              className="button button-primary hb-buy-cta"
              disabled={!ready || !pkg}
              {...cta("pricing_buy_credits", `${where}_buy`, signupHref ? "signup_invitation" : "checkout", "habita_b2b", pkg ? { plan: pkg.sku } : {})}
              onClick={() => open("buy_card", pkg?.sku)}
            >
              {ready ? "Comprar créditos" : "Disponible pronto"}
              {ready && pkg && (
                <span className="visually-hidden">
                  : {pkg.credits} créditos por {ars(pkg.cents)}
                </span>
              )}
              <ArrowRight size={18} aria-hidden="true" />
            </button>
            <ul className="hb-buy-trust">
              <li>
                <ShieldCheck size={16} aria-hidden="true" /> Pagás con Mercado Pago
              </li>
              <li>
                <Check size={16} aria-hidden="true" /> Pago único
              </li>
              {validity && (
                <li>
                  <CalendarDays size={16} aria-hidden="true" /> Créditos válidos por {validity}
                </li>
              )}
            </ul>
          </section>
        </div>

        <StagingImpact where={where} />

        <MoreAbout />

        <ShareLink where={where} />
      </div>
    </div>
  );
}

/** What agents report about home staging (NAR 2025), said for what it is. */
function StagingImpact({ where }: { where: string }) {
  return (
    <section className="hb-impact" aria-labelledby="hb-impact-title">
      <h2 id="hb-impact-title">Qué dicen los agentes inmobiliarios sobre el home staging</h2>
      <ul>
        {STAGING_STATS.map(({ value, icon: Icon, text }) => (
          <li key={value}>
            <strong>
              <Icon size={20} aria-hidden="true" /> {value}
            </strong>
            <span>{text}</span>
          </li>
        ))}
      </ul>
      <p className="hb-impact-note">
        Respuestas de agentes de Estados Unidos sobre el home staging en general, de una encuesta de la NAR (2025). No son resultados medidos de
        Habita ni del virtual staging con IA.{" "}
        <a href={STAGING_SOURCE} target="_blank" rel="noopener noreferrer" {...cta("pricing_staging_source", `${where}_impact`, "external_source", "content")}>
          Fuente: NAR, 2025 Profile of Home Staging
          <ExternalLink size={14} aria-hidden="true" />
          <span className="visually-hidden"> (se abre en otra pestaña)</span>
        </a>
      </p>
    </section>
  );
}

/** How credits work, what is included and the FAQ: each said once, folded until asked for. */
function MoreAbout() {
  const [openId, setOpenId] = useState<string | null>(null);
  // A link to one of them (the credits menu's «Cómo funcionan») opens it, also on the same page.
  useEffect(() => {
    const fromHash = () => {
      const id = window.location.hash.slice(1);
      if ((MORE_IDS as readonly string[]).includes(id)) setOpenId(id);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);
  const item = (id: (typeof MORE_IDS)[number]) => ({
    id,
    className: "hb-more-item",
    open: openId === id,
    onToggle: (e: SyntheticEvent<HTMLDetailsElement>) => {
      const isOpen = e.currentTarget.open;
      setOpenId((current) => (isOpen ? id : current === id ? null : current));
    },
  });
  return (
    <div className="hb-more">
      <details {...item("como-funcionan-los-creditos")}>
        <summary>
          <Layers size={20} aria-hidden="true" />
          <span>¿Cómo funcionan los créditos?</span>
          <ChevronDown size={20} className="hb-more-chevron" aria-hidden="true" />
        </summary>
        <div className="hb-more-body">
          <ol className="hb-how-steps">
            <li>
              <House size={22} aria-hidden="true" />
              <strong>1 crédito = 1 foto transformada</strong>
              <span>Las demás versiones y estilos de esa foto no usan otro crédito mientras esté vigente.</span>
            </li>
            <li>
              <Layers size={22} aria-hidden="true" />
              <strong>Un solo saldo</strong>
              <span>
                Los {FREE_MONTHLY_CREDITS} gratis del mes se usan primero y vencen a fin de mes; después, los que compraste, que duran 12 meses.
              </span>
            </li>
            <li>
              <BadgeCheck size={22} aria-hidden="true" />
              <strong>Sin sorpresas</strong>
              <span>Si una generación falla por un problema técnico, el crédito vuelve solo.</span>
            </li>
          </ol>
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
        </div>
      </details>

      <details {...item("que-incluye")}>
        <summary>
          <Sparkles size={20} aria-hidden="true" />
          <span>¿Qué incluye Habita?</span>
          <ChevronDown size={20} className="hb-more-chevron" aria-hidden="true" />
        </summary>
        <div className="hb-more-body">
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
          <div className="hb-sheet-free-list">
            <p>Con créditos</p>
            <ul>
              <li>
                <Check size={14} aria-hidden="true" /> Ambientación de fotos con IA
              </li>
              {SHEET_VIDEO_MODES.filter((m) => VIDEO_CREDITS[m] > 0).map((m) => (
                <li key={m}>
                  <Check size={14} aria-hidden="true" /> Video: {MODE_INFO[m].name}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </details>

      <details {...item("preguntas-frecuentes")}>
        <summary>
          <CircleHelp size={20} aria-hidden="true" />
          <span>Preguntas frecuentes</span>
          <ChevronDown size={20} className="hb-more-chevron" aria-hidden="true" />
        </summary>
        <div className="hb-more-body">
          <dl className="hb-faq">
            {faqs.map(([q, a]) => (
              <div key={q}>
                <dt>{q}</dt>
                <dd>{a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </details>
    </div>
  );
}

/**
 * The link to the prices, to send by WhatsApp (people ask for them a lot).
 * /panel/precios opens them in the agency's own panel, or on /precios for
 * someone without one.
 */
function ShareLink({ where }: { where: string }) {
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);
  useEffect(() => setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function"), []);
  const link = () => `${window.location.origin}${PRICES_PATH}`;
  const text = `Los precios de habita.: ${FREE_MONTHLY_CREDITS} créditos gratis por mes y paquetes de créditos sin suscripción.`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(link());
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
      track("pricing_link_copied", { surface: where, pricing_ux_version: PRICING_UX });
    } catch {
      window.prompt("Copiá el link de precios:", link());
    }
  }
  function whatsapp() {
    window.open(`https://wa.me/?text=${encodeURIComponent(`${text} ${link()}`)}`, "_blank", "noopener,noreferrer");
    track("pricing_link_shared", { surface: where, channel: "whatsapp", pricing_ux_version: PRICING_UX });
  }
  async function share() {
    try {
      await navigator.share({ title: "Precios de habita.", text, url: link() });
      track("pricing_link_shared", { surface: where, channel: "native", pricing_ux_version: PRICING_UX });
    } catch {
      /* Closed without sharing. */
    }
  }
  return (
    <div className="hb-share">
      <p>¿Te pidieron los precios? Compartí este link:</p>
      <div className="hb-share-actions">
        <button type="button" className="button button-outline button-small" onClick={() => void copy()}>
          {copied ? <Check size={17} aria-hidden="true" /> : <Copy size={17} aria-hidden="true" />} {copied ? "¡Link copiado!" : "Copiar link de precios"}
        </button>
        <button type="button" className="button button-outline button-small" onClick={whatsapp}>
          <MessageCircle size={17} aria-hidden="true" /> Enviar por WhatsApp
        </button>
        {canShare && (
          <button type="button" className="button button-outline button-small" onClick={() => void share()}>
            <Share2 size={17} aria-hidden="true" /> Compartir
          </button>
        )}
      </div>
      <span className="visually-hidden" role="status">
        {copied ? "Link de precios copiado" : ""}
      </span>
    </div>
  );
}
