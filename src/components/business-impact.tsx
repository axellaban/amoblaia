"use client";
// «El impacto en tu negocio»: three industry figures and a calculator, the
// same in the home, the prices, the panel's home and the agency's demo.
// They are international studies on staging and visual presentation in
// general, never habita.'s own results, and the note under them says so.
import { useId, useState } from "react";
import { ArrowUpRight, Clock, TrendingUp, Users } from "lucide-react";
import { cta } from "@/lib/interaction-tracking";
import { ARS_PER_USD, CREDITS_PER_PROPERTY, DEFAULT_UNIT_CENTS, IMPACT_NOTE, IMPACT_STATS } from "@/lib/business-impact";

const ICONS = { precio: TrendingUp, velocidad: Clock, consultas: Users } as const;

export { IMPACT_NOTE, IMPACT_STATS };

type Variant = "band" | "hero";

/**
 * The three figures. «band»: the dark strip with its label (prices, panel,
 * the agency's demo); «hero»: the same strip with a line under each figure
 * (home). On a phone, one figure per row.
 */
export function ImpactStats({ variant = "band", where, note = true }: { variant?: Variant; where: string; note?: boolean }) {
  const titleId = useId();
  return (
    <div className={`bi is-${variant}`}>
      <div className="bi-band">
        {variant === "band" && (
          <p className="bi-kicker" id={titleId}>
            El impacto en tu negocio
          </p>
        )}
        <ul className="bi-stats" aria-labelledby={variant === "band" ? titleId : undefined}>
          {IMPACT_STATS.map(({ id, value, label, text, source, href }) => {
            const Icon = ICONS[id];
            return (
            <li key={id} className="bi-stat">
              <Icon className="bi-icon" size={26} aria-hidden="true" />
              <strong className="bi-value">{value}</strong>
              <span className="bi-label">{label}</span>
              {variant === "hero" && <span className="bi-text">{text}</span>}
              <a className="bi-source" href={href} target="_blank" rel="noopener noreferrer" {...cta(`impact_source_${id}`, `${where}_impact`, "external_source", "content")}>
                {source} <ArrowUpRight size={13} aria-hidden="true" />
                <span className="visually-hidden"> (se abre en otra pestaña)</span>
              </a>
            </li>
            );
          })}
        </ul>
      </div>
      {note && <p className="bi-note">{IMPACT_NOTE}</p>}
    </div>
  );
}

const usd = (n: number) => `US$ ${Math.round(n).toLocaleString("es-AR")}`;
const pct = (n: number) => `${String(n).replace(".", ",")}%`;

/**
 * More sales: more interested buyers, and more of them converting. Both add
 * up multiplied, as a percentage: +20% interested and +10% conversion is +32%.
 */
export function volumeLift(interested: number, conversion: number) {
  return ((1 + interested / 100) * (1 + conversion / 100) - 1) * 100;
}

/**
 * What a better sale could mean: price × estimated improvement, and the
 * agency's commission on it; with the volume lift (volumeLift), both grow by it.
 */
export function impactOf(price: number, improvement: number, commission: number, volume = 0) {
  const value = ((price * improvement) / 100) * (1 + volume / 100);
  return { value, commission: (value * commission) / 100 };
}

/** habita.'s cost in dollars for a number of properties, at CREDITS_PER_PROPERTY credits each. */
export function habitaCostUsd(properties: number, unitCents: number = DEFAULT_UNIT_CENTS) {
  return (properties * CREDITS_PER_PROPERTY * unitCents) / 100 / ARS_PER_USD;
}

const MAX_PROPERTIES = 10000;
const clampProps = (n: number) => (Number.isFinite(n) ? Math.min(MAX_PROPERTIES, Math.max(1, Math.round(n))) : 1);

const SLIDERS = [
  { key: "price", label: "Precio promedio de la propiedad", min: 30000, max: 1000000, step: 5000, show: usd },
  { key: "improvement", label: "Mejora estimada del precio", min: 1, max: 19, step: 1, show: pct },
  { key: "commission", label: "Comisión inmobiliaria", min: 1, max: 6, step: 0.5, show: pct },
  { key: "interested", label: "Más interesados", min: 0, max: 100, step: 1, show: pct },
  { key: "conversion", label: "Mejor conversión de los interesados", min: 0, max: 100, step: 1, show: pct },
] as const;
/** The two sliders whose lift the volume row sums up (volumeLift); by default ≈ +30% (1,15 × 1,13). */
const VOLUME_KEYS: readonly string[] = ["interested", "conversion"];
const pctRound = (n: number) => `${Math.round(n).toLocaleString("es-AR")}%`;

type Values = Record<(typeof SLIDERS)[number]["key"], number>;

/** «¿Cuánto podrías ganar con una mejor venta?»: an estimate the agency moves with its own numbers. */
export function ImpactCalculator({ where, unitCents }: { where: string; unitCents?: number }) {
  const id = useId();
  const [v, setV] = useState<Values>({ price: 150000, improvement: 10, commission: 3, interested: 15, conversion: 13 });
  const [props, setProps] = useState(1);
  const [propsText, setPropsText] = useState("1");
  const [touched, setTouched] = useState(false);
  const volume = volumeLift(v.interested, v.conversion);
  const one = impactOf(v.price, v.improvement, v.commission, volume);
  const r = { value: one.value * props, commission: one.commission * props };
  const cost = habitaCostUsd(props, unitCents);
  const roi = cost > 0 ? r.commission / cost : 0;
  const setCount = (n: number) => {
    const c = clampProps(n);
    setProps(c);
    setPropsText(String(c));
    setTouched(true);
  };
  return (
    <section className="bi-calc" aria-labelledby={`${id}-title`} data-impact-calculator={where}>
      <div className="bi-calc-head">
        <p className="bi-calc-kicker">Calculadora de impacto</p>
        <h3 id={`${id}-title`}>¿Cuánto podrías ganar con una mejor venta?</h3>
        <p>Movela con una propiedad tuya. Es una estimación, no una promesa.</p>
      </div>
      <div className="bi-calc-inputs">
        <div className="bi-calc-props">
          <label htmlFor={`${id}-props`}>Propiedades</label>
          <div className="bi-calc-stepper">
            <button type="button" aria-label="Restar una propiedad" onClick={() => setCount(props - 1)} disabled={props <= 1}>
              −
            </button>
            <input
              id={`${id}-props`}
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_PROPERTIES}
              value={propsText}
              onChange={(e) => {
                setPropsText(e.target.value);
                const n = parseInt(e.target.value, 10);
                if (!Number.isNaN(n)) {
                  setProps(clampProps(n));
                  setTouched(true);
                }
              }}
              onBlur={() => setPropsText(String(props))}
            />
            <button type="button" aria-label="Sumar una propiedad" onClick={() => setCount(props + 1)}>
              +
            </button>
          </div>
        </div>
        {SLIDERS.map(({ key, label, min, max, step, show }) => (
          <div key={key} className={`bi-calc-row${VOLUME_KEYS.includes(key) ? " is-volume" : ""}`}>
            <label htmlFor={`${id}-${key}`}>{label}</label>
            <input
              id={`${id}-${key}`}
              type="range"
              min={min}
              max={max}
              step={step}
              value={v[key]}
              aria-valuetext={show(v[key])}
              onChange={(e) => {
                setV((prev) => ({ ...prev, [key]: Number(e.target.value) }));
                setTouched(true);
              }}
            />
            <output htmlFor={`${id}-${key}`} className="bi-calc-box">
              {show(v[key])}
            </output>
          </div>
        ))}
        <div className="bi-calc-volume">
          <span>
            Aumento en volumen de ventas
            <small>Más interesados × mejor conversión</small>
          </span>
          <output className="bi-calc-box">+{pctRound(volume)}</output>
        </div>
      </div>
      <div className="bi-calc-result" aria-live={touched ? "polite" : "off"}>
        <span>Mayor valor de venta</span>
        <strong>+{usd(r.value)}</strong>
        <span>Beneficio incremental</span>
        <strong className="is-small">+{usd(r.commission)}</strong>
        <p className="bi-calc-assume">Incluye +{pctRound(volume)} de ventas por más interesados y mejor conversión.</p>
        <div className="bi-calc-roi">
          <div>
            <span>Costo Habita estimado</span>
            <b>≈ {usd(cost)}</b>
          </div>
          <div className="is-right">
            <span className="is-roi">Retorno sobre inversión</span>
            <b className="is-big">{Math.round(roi).toLocaleString("es-AR")}x</b>
          </div>
        </div>
        <p className="bi-calc-assume">Asumiendo {CREDITS_PER_PROPERTY} créditos (imágenes ambientadas) por propiedad.</p>
      </div>
    </section>
  );
}

/** The figures and, under them, the calculator (prices and the panel's home). */
export function BusinessImpact({ where, unitCents }: { where: string; unitCents?: number }) {
  return (
    <div className="bi-block">
      <ImpactStats variant="band" where={where} note={false} />
      <ImpactCalculator where={where} unitCents={unitCents} />
      <p className="bi-note">{IMPACT_NOTE}</p>
    </div>
  );
}
