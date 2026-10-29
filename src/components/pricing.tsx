"use client";
import { redirectKeepingClick } from "@/lib/ads";
import Link from "next/link";
import { useState, useRef, useEffect, type CSSProperties } from "react";
import {
  Check,
  ArrowUpRight,
  LoaderCircle,
  Sparkles,
  Plus,
  Minus,
  BadgeCheck,
  X,
  Timer,
  House,
  Coins,
} from "lucide-react";
import {
  offers,
  skuFor,
  formatARS,
  launchOffer,
  type Product,
} from "@/lib/commerce/catalog";
import { track } from "@/lib/analytics";
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
    "¿Qué diferencia hay entre los créditos y un plan?",
    "Los créditos se pagan una sola vez, sin suscripción, y duran 12 meses: cada crédito es una foto original, con sus regeneraciones. Cuantos más comprás, menos pagás cada uno. Los planes se renuevan cada mes y salen más baratos por foto si publicás todos los meses.",
  ],
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
/** "25/10 a las 23:59" in Argentina (UTC−3, no daylight saving). Built by
 * hand: Intl output differs between Node and browsers and breaks hydration. */
function arDate(time: number) {
  const d = new Date(time - 3 * 3600e3);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCDate()}/${d.getUTCMonth() + 1} a las ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
/** "2 d 05 h 09 m 03 s" until `end`. */
function countdown(end: number, now: number) {
  const left = Math.max(0, Math.floor((end - now) / 1000));
  const pad = (n: number) => String(n).padStart(2, "0");
  const days = Math.floor(left / 86400);
  return `${days ? `${days} d ` : ""}${pad(Math.floor(left / 3600) % 24)} h ${pad(Math.floor(left / 60) % 60)} m ${pad(left % 60)} s`;
}
export function PricingPlans({
  products,
  enabled,
  trial,
  email,
  currentSku,
  firstPackUsed = false,
  renderedAt,
  signupHref,
  initialSku,
}: {
  products: Product[];
  enabled: boolean;
  trial: boolean;
  /** Signed-in email, used to require sign-in before opening checkout. */
  email?: string;
  /** The plan the user is subscribed to, if any. */
  currentSku?: string;
  /** Whether this account already bought the one-per-account pack. */
  firstPackUsed?: boolean;
  /** Server time of this render, so the countdown hydrates identically. */
  renderedAt: number;
  /** Someone without an account yet (an invited agency): buying starts by creating it here. */
  signupHref?: string;
  /** The plan chosen before creating the account: its payment opens right away. */
  initialSku?: string;
}) {
  // Creating the account first, keeping the chosen plan for after it.
  const toSignup = (sku: string) => {
    const url = new URL(signupHref!, window.location.origin);
    url.searchParams.set("plan", sku);
    window.location.assign(`${url.pathname}${url.search}`);
  };
  const checkoutKeys = useRef<Record<string, string>>({});
  const [now, setNow] = useState(renderedAt);
  const launch = (sku: string) => {
    const p = products.find((p) => p.sku === sku && p.active);
    return p ? launchOffer(p, now) : null;
  };
  const launches = offers
    .map((o) => ({
      offer: launch(skuFor(o.id)),
      list: products.find((p) => p.sku === skuFor(o.id))?.price_cents || 0,
    }))
    .filter((l) => l.offer && l.list);
  const launchEnds = launches.length
    ? Math.min(...launches.map((l) => Date.parse(l.offer!.endsAt)))
    : 0;
  const launchMonths = launches[0]?.offer?.months || 0;
  const launchCut = Math.max(
    0,
    ...launches.map((l) => 1 - l.offer!.cents / l.list),
  );
  useEffect(() => {
    if (!launchEnds) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [launchEnds]);
  const firstPack = firstPackUsed
    ? undefined
    : products.find((p) => p.sku === "pack-first" && p.active && p.price_cents);
  // Credit packs, smallest first, are the stops of the credits slider. The
  // one-per-account pack has its own section.
  const creditPacks = products
    .filter(
      (p) =>
        p.kind === "pack" && p.active && p.price_cents && !p.per_account_limit,
    )
    .sort((a, b) => a.photos - b.photos);
  const [packIndex, setPackIndex] = useState(() =>
    Math.max(
      0,
      creditPacks.findIndex((p) =>
        initialSku?.startsWith("pack-") ? p.sku === initialSku : p.photos >= 20,
      ),
    ),
  );
  // During the launch, plans open on the monthly prices that carry it.
  const [annual, setAnnual] = useState(
      currentSku
        ? !currentSku.endsWith("-month")
        : !products.some((p) => p.active && launchOffer(p, renderedAt)),
    ),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [payerEmail, setPayerEmail] = useState(""),
    [selectedSku, setSelectedSku] = useState(""),
    [faq, setFaq] = useState<number | null>(null);
  const [expandedPlans, setExpandedPlans] = useState<Record<string, boolean>>(
    {},
  );
  // Back from creating the account with a plan chosen: its payment opens once, right away.
  const reopened = useRef(false);
  useEffect(() => {
    if (reopened.current || !initialSku || !email || !enabled) return;
    if (!products.some((p) => p.sku === initialSku && p.active && p.price_cents)) return;
    reopened.current = true;
    if (initialSku.endsWith("-year")) setAnnual(true);
    else if (initialSku.endsWith("-month")) setAnnual(false);
    // Packs go straight to Checkout Pro; plans confirm the payer's email first.
    if (initialSku.startsWith("pack-")) void buy(initialSku);
    else setSelectedSku(initialSku);
  }, [initialSku, email, enabled, products]);
  const selectedProduct = products.find((p) => p.sku === selectedSku);
  const selectedDeal = selectedProduct ? launch(selectedProduct.sku) : null;
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
    track("plan_click", { plan: sku });
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
        redirectKeepingClick("/acceso?next=%2Fprecios");
        return;
      }
      const payload = await response.json();
      // A definite refusal closed that order: the next try is a new one.
      // Uncertain errors (5xx) keep the key so a retry cannot duplicate it.
      if (response.status >= 400 && response.status < 500)
        delete checkoutKeys.current[slot];
      if (!response.ok) throw new Error(payload.error);
      track("checkout_creado", { plan: sku }, true);
      window.location.assign(payload.url);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No pudimos abrir el checkout.",
      );
      setBusy("");
    }
  }
  // Back to this price after signing in, with its payment opened (see initialSku).
  const signInFor = (sku: string) => `/acceso?next=${encodeURIComponent(`/precios?plan=${sku}`)}`;
  // Packs go straight to Checkout Pro, which takes any account.
  function buyPack(sku: string) {
    if (signupHref) return toSignup(sku);
    setError("");
    setPayerEmail("");
    if (!email) {
      redirectKeepingClick(signInFor(sku));
      return;
    }
    void buy(sku);
  }
  function creditsCard() {
    const pack = creditPacks[Math.min(packIndex, creditPacks.length - 1)],
      cents = pack.price_cents || 0,
      unit = cents / pack.photos,
      cut = 1 - unit / ((creditPacks[0].price_cents || 0) / creditPacks[0].photos),
      ready = enabled || Boolean(signupHref),
      // Compared with the monthly plans (launch price included), named as such: an annual plan is paid upfront.
      plans = offers
        .map((o) => {
          const sku = skuFor(o.id);
          return { ...o, cents: launch(sku)?.cents || price(sku) };
        })
        .filter((o) => o.cents),
      bigger = plans.find((o) => o.photos > pack.photos),
      covered = plans.filter((o) => o.photos <= pack.photos).pop(),
      days = pack.valid_days;
    return (
      <article className="price-card credits-card">
        <span className="price-ribbon">Sin suscripción</span>
        <div className="price-panel">
          <div className="credits-pick">
            <span className="eyebrow">
              <Coins size={15} /> PAGO ÚNICO ·{" "}
              {!days
                ? "NO VENCEN"
                : days % 365 === 0
                  ? `VÁLIDOS ${(days / 365) * 12} MESES`
                  : `VÁLIDOS ${days} DÍAS`}
            </span>
            <h2>Créditos</h2>
            <p>
              Comprá solo lo que necesitás. Un crédito es una foto, con
              regeneraciones.
            </p>
            <div className="credits-amount">
              <div className="photo-allowance">
                <strong>{pack.photos}</strong> créditos
              </div>
              <span className={`credits-cut ${cut >= 0.01 ? "" : "none"}`}>
                {cut >= 0.01
                  ? `−${Math.round(cut * 100)}% por volumen`
                  : "Precio de lista"}
              </span>
            </div>
            <input
              id="credits-amount"
              type="range"
              className="credits-range"
              aria-label="Cantidad de créditos"
              aria-valuetext={`${pack.photos} créditos`}
              min={0}
              max={creditPacks.length - 1}
              step={1}
              value={Math.min(packIndex, creditPacks.length - 1)}
              style={
                {
                  "--fill": `${(Math.min(packIndex, creditPacks.length - 1) / Math.max(1, creditPacks.length - 1)) * 100}%`,
                } as CSSProperties
              }
              onChange={(e) => setPackIndex(Number(e.target.value))}
            />
            <div className="credits-stops">
              {creditPacks.map((p, i) => (
                <button
                  key={p.sku}
                  type="button"
                  className={p.sku === pack.sku ? "selected" : ""}
                  aria-label={`${p.photos} créditos`}
                  aria-pressed={p.sku === pack.sku}
                  onClick={() => setPackIndex(i)}
                >
                  {p.photos}
                </button>
              ))}
            </div>
          </div>
          <div className="credits-buy">
            <div className="price">
              {formatARS(cents)} <span>por única vez</span>
            </div>
            <small className="per-photo">{formatARS(unit)} por crédito</small>
            <p className="credits-compare">
              {bigger && cents >= bigger.cents * 0.9 ? (
                <>
                  Por <b>{formatARS(bigger.cents)} por mes</b>, el plan
                  mensual <b>{bigger.name}</b> te da <b>{bigger.photos} fotos</b> todos
                  los meses.
                </>
              ) : covered &&
                pack.photos >= 20 &&
                covered.cents / covered.photos < unit ? (
                <>
                  ¿Lo usás todos los meses? Con el plan mensual{" "}
                  <b>{covered.name}</b> la foto
                  sale <b>{formatARS(covered.cents / covered.photos)}</b>.
                </>
              ) : pack.photos >= 20 ? (
                "Sin suscripción: usalos a tu ritmo, sin cupo que se pierda a fin de mes."
              ) : (
                "Ideal para una o dos propiedades, sin cupo que se pierda a fin de mes."
              )}
            </p>
            <button
              className="button button-primary"
              disabled={!ready || Boolean(busy)}
              onClick={() => buyPack(pack.sku)}
            >
              {busy === pack.sku ? (
                <LoaderCircle size={18} className="spin" />
              ) : (
                <ArrowUpRight size={18} />
              )}{" "}
              {ready ? `Comprar ${pack.photos} créditos` : "Disponible pronto"}
            </button>
          </div>
        </div>
      </article>
    );
  }
  function card(offer: (typeof offers)[number]) {
    const sku = skuFor(offer.id, annual),
      cents = price(sku),
      deal = annual ? null : launch(sku),
      monthly = annual ? cents / 12 : deal?.cents || cents,
      yearlyMonthly = price(skuFor(offer.id, true)) / 12,
      ready = (enabled || Boolean(signupHref)) && cents > 0,
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
              {deal && (
                <div className="price-was">
                  <span className="visually-hidden">Precio regular: </span>
                  <s>{formatARS(cents)}</s>
                  <em>−{Math.round((1 - deal.cents / cents) * 100)}%</em>
                </div>
              )}
              <div className="price">
                {formatARS(monthly)} <span>por mes</span>
              </div>
              <small className="per-photo">
                {formatARS(monthly / offer.photos)} por foto
                {deal && ` · los primeros ${deal.months} meses`}
              </small>
              {deal ? (
                <small className="annual-hint">
                  Después {formatARS(cents)} por mes
                </small>
              ) : annual ? (
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
              if (signupHref) return toSignup(sku);
              // The order belongs to the signed-in customer before leaving for MP.
              if (!email) {
                redirectKeepingClick(signInFor(sku));
                return;
              }
              setSelectedSku(sku);
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
  const trialBanner = (
    <div className="trial-banner">
      <Sparkles size={24} />
      <div>
        <h2>Probá con tus fotos, sin registrarte.</h2>
        <p>Hasta 3 diseños por tanda, con marca de agua. Sin tarjeta.</p>
      </div>
      <Link className="button button-dark" href="/estudio">
        Probar gratis <ArrowUpRight size={17} />
      </Link>
    </div>
  );
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
            <p>Comprá créditos o elegí un plan de virtual staging.</p>
          </div>
          <div
            className="billing-toggle"
            aria-label="Frecuencia de facturación"
          >
            <button
              className={!annual ? "selected" : ""}
              aria-pressed={!annual}
              onClick={() => setAnnual(false)}
            >
              Mensual
            </button>
            <button
              className={annual ? "selected" : ""}
              aria-pressed={annual}
              onClick={() => setAnnual(true)}
            >
              Anual {savingLabel && <em>{savingLabel}</em>}
            </button>
          </div>
        </div>
        {launchEnds ? (
          <div className="launch-banner">
            <Timer size={26} />
            <div>
              <h2>
                Precio de lanzamiento: hasta{" "}
                {Math.floor((launchCut * 100) / 5) * 5}% menos
              </h2>
              <p>
                En los planes mensuales, durante los primeros {launchMonths}{" "}
                meses. Termina el {arDate(launchEnds)} h.
                {firstPack && (
                  <>
                    {" "}
                    <a href="#primera-propiedad">
                      ¿Una sola propiedad? 5 fotos por{" "}
                      {formatARS(firstPack.price_cents || 0)}
                    </a>
                  </>
                )}
              </p>
            </div>
            <span className="launch-countdown" role="timer">
              <span className="visually-hidden">Termina en </span>
              {countdown(launchEnds, now)}
            </span>
            {annual && (
              <button
                className="button button-small"
                onClick={() => setAnnual(false)}
              >
                Ver precios mensuales
              </button>
            )}
          </div>
        ) : (
          trial && trialBanner
        )}
        <div className="pricing-grid commercial-plans">
          {creditPacks.length > 0 && creditsCard()}
          {offers.map(card)}
        </div>
        {launchEnds > 0 && (
          <p className="launch-terms">
            Precio de lanzamiento válido para suscripciones mensuales
            contratadas hasta el {arDate(launchEnds)} h (hora de Argentina). Se
            cobra en los primeros {launchMonths} pagos; desde el siguiente se
            cobra el precio regular indicado. No aplica a planes anuales ni a
            packs.
          </p>
        )}
        {firstPack && (
          <section className="first-pack" id="primera-propiedad">
            <House size={30} />
            <div>
              <span className="eyebrow">PAGO ÚNICO · SIN SUSCRIPCIÓN</span>
              <h2>{firstPack.name}</h2>
              <p>
                {firstPack.photos} fotos para amoblar un aviso completo, con
                regeneraciones y sin marca de agua. Una por cuenta; usalas
                dentro de los {firstPack.valid_days || 30} días.
              </p>
            </div>
            <div className="first-pack-buy">
              <strong>{formatARS(firstPack.price_cents || 0)}</strong>
              <small>
                {formatARS((firstPack.price_cents || 0) / firstPack.photos)} por
                foto
              </small>
              <button
                className="button button-primary"
                disabled={!(enabled || signupHref) || Boolean(busy)}
                onClick={() => buyPack(firstPack.sku)}
              >
                {busy === firstPack.sku ? (
                  <LoaderCircle size={18} className="spin" />
                ) : (
                  <ArrowUpRight size={18} />
                )}{" "}
                {enabled || signupHref ? "Comprar" : "Disponible pronto"}
              </button>
            </div>
          </section>
        )}
        {launchEnds > 0 && trial && trialBanner}
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
                    {selectedDeal
                      ? `${formatARS(selectedDeal.cents)} por mes los primeros ${selectedDeal.months} meses, después ${formatARS(selectedProduct.price_cents || 0)} por mes`
                      : `${formatARS(selectedProduct.price_cents || 0)} ${
                          selectedProduct.kind === "year"
                            ? "por año, en un solo cobro"
                            : selectedProduct.kind === "month"
                              ? "por mes"
                              : "por única vez"
                        }`}
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
