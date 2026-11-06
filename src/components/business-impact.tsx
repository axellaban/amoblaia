"use client";
// «El impacto en tu negocio»: three industry figures and a calculator, the
// same in the home, the prices, the panel's home and the agency's demo.
// They are international studies on staging and visual presentation in
// general, never habita.'s own results, and the note under them says so.
import { useId, useState } from "react";
import { ArrowUpRight, Clock, TrendingUp, Users } from "lucide-react";
import { cta } from "@/lib/interaction-tracking";

export const IMPACT_STATS = [
  {
    id: "precio",
    icon: TrendingUp,
    value: "+19%",
    label: "sobre el precio publicado",
    text: "Promedio de propiedades con staging.",
    source: "RESA · 2023",
    href: "https://www.realestatestagingassociation.com/",
  },
  {
    id: "velocidad",
    icon: Clock,
    value: "3×",
    label: "más rápido en vender",
    text: "Velocidad de venta reportada con staging.",
    source: "Lemon & Lime · 2025",
    href: "https://www.lemonandlimeinteriors.co.uk/",
  },
  {
    id: "consultas",
    icon: Users,
    value: "95%",
    label: "mayor intención de consultar",
    text: "Encuestados más propensos a llamar ante recorridos 3D.",
    source: "Matterport · Real Estate",
    href: "https://matterport.com/industries/real-estate",
  },
] as const;

export const IMPACT_NOTE =
  "Estudios internacionales sobre staging y presentación visual en general (RESA y Lemon & Lime: staging; Matterport: recorridos 3D). No son resultados medidos de habita.";

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
          {IMPACT_STATS.map(({ id, icon: Icon, value, label, text, source, href }) => (
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
          ))}
        </ul>
      </div>
      {note && <p className="bi-note">{IMPACT_NOTE}</p>}
    </div>
  );
}

const usd = (n: number) => `US$ ${Math.round(n).toLocaleString("es-AR")}`;
const pct = (n: number) => `${String(n).replace(".", ",")}%`;

/** What a better sale could mean: price × estimated improvement, and the agency's commission on it. */
export function impactOf(price: number, improvement: number, commission: number) {
  const value = (price * improvement) / 100;
  return { value, commission: (value * commission) / 100 };
}

const SLIDERS = [
  { key: "price", label: "Precio de la propiedad", min: 30000, max: 1000000, step: 5000, show: usd },
  { key: "improvement", label: "Mejora estimada del precio", min: 1, max: 19, step: 1, show: pct },
  { key: "commission", label: "Comisión inmobiliaria", min: 1, max: 6, step: 0.5, show: pct },
] as const;

type Values = Record<(typeof SLIDERS)[number]["key"], number>;

/** «¿Cuánto podrías ganar con una mejor venta?»: an estimate the agency moves with its own numbers. */
export function ImpactCalculator({ where }: { where: string }) {
  const id = useId();
  const [v, setV] = useState<Values>({ price: 150000, improvement: 5, commission: 3 });
  const [touched, setTouched] = useState(false);
  const r = impactOf(v.price, v.improvement, v.commission);
  return (
    <section className="bi-calc" aria-labelledby={`${id}-title`} data-impact-calculator={where}>
      <div className="bi-calc-head">
        <p className="bi-calc-kicker">Calculadora de impacto</p>
        <h3 id={`${id}-title`}>¿Cuánto podrías ganar con una mejor venta?</h3>
        <p>Movela con una propiedad tuya. Es una estimación, no una promesa.</p>
      </div>
      <div className="bi-calc-inputs">
        {SLIDERS.map(({ key, label, min, max, step, show }) => (
          <div key={key} className="bi-calc-row">
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
      </div>
      <div className="bi-calc-result" aria-live={touched ? "polite" : "off"}>
        <span>Mayor valor de venta</span>
        <strong>+{usd(r.value)}</strong>
        <span>Tu comisión extra</span>
        <strong className="is-small">+{usd(r.commission)}</strong>
      </div>
    </section>
  );
}

/** The figures and, under them, the calculator (prices and the panel's home). */
export function BusinessImpact({ where }: { where: string }) {
  return (
    <div className="bi-block">
      <ImpactStats variant="band" where={where} note={false} />
      <ImpactCalculator where={where} />
      <p className="bi-note">{IMPACT_NOTE}</p>
    </div>
  );
}
