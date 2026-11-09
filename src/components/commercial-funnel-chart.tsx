import Link from "next/link";
import type { ReactNode } from "react";
import { PERIODS, barScale, type Period, type funnelCounts } from "@/lib/agency/demo-funnel";
export const STAYED = ["Sin interés todavía", "Interesados, sin demo", "No se enviaron", "No abrieron la demo", "Visitaron, sin interactuar", "Interactuaron, sin cuenta", "Cuenta sin uso", "Sin suscripción"];
const OF_PREVIOUS = ["", "de los contactados", "de los interesados", "de las creadas", "de las enviadas", "de las visitadas", "de las que interactuaron", "de las cuentas creadas", "de las cuentas activas"];

export function CommercialFunnelChart({ funnel, lostAt, period, step, stayed, lostOnly, href, presetHref, action, rangeFields }: {
  funnel: ReturnType<typeof funnelCounts>; lostAt: number[]; period: Period; step: number | null; stayed: boolean; lostOnly: boolean;
  href: (change: Record<string, string | null>) => string; presetHref: (key: string) => string; action: string; rangeFields: ReactNode;
}) {
  const scale = barScale(funnel.map(f => f.count));
  return (
      <section className="ah-dfunnel" aria-labelledby="ah-dfunnel-title">
        <div className="ah-dfunnel-head">
          <div>
            <h2 id="ah-dfunnel-title">Funnel comercial</h2>
            <p>Cada paso cuenta las inmobiliarias que llegaron hasta ahí. El % compara con el paso anterior.</p>
          </div>
          <div className="ah-period">
            <span>Período:</span>
            <nav className="ah-period-presets" aria-label="Período">
              {PERIODS.map((p) => (
                <Link key={p.key} href={presetHref(p.key)} className={period.key === p.key ? "is-on" : undefined} aria-current={period.key === p.key ? "true" : undefined}>
                  {p.label}
                </Link>
              ))}
            </nav>
            <form action={action} className="ah-period-range">
              {rangeFields}
              <label>
                Desde <input type="date" name="desde" key={period.from} defaultValue={period.from ?? ""} />
              </label>
              <label>
                Hasta <input type="date" name="hasta" key={period.to} defaultValue={period.to ?? ""} />
              </label>
              <button className="button button-small button-outline">Aplicar</button>
            </form>
          </div>
        </div>
        <ul className="ah-dfunnel-legend" aria-hidden="true">
          <li className="is-went">Pasaron al paso siguiente</li>
          <li className="is-stayed">Se quedaron (para hacer seguimiento)</li>
          <li className="is-lost">Perdidas (no interesadas)</li>
        </ul>
        <ol className="ah-dfunnel-chart">
          {funnel.map((f, i) => {
            const last = i === funnel.length - 1;
            const went = last ? f.count : funnel[i + 1].count;
            const lost = last ? 0 : lostAt[i];
            const stay = f.count - went - lost;
            // Heights in % of the plot, on the broken scale (barScale): the bar, and inside it who went on at the
            // height of the next bar, so each step lines up with the one after it; above, who stayed and who was lost.
            const total = scale.height(f.count);
            const wentH = last ? total : scale.height(went);
            const restH = total - wentH;
            const isOn = (s: number, st: boolean, l = false) => step === s && stayed === st && lostOnly === l;
            const segs = (stay > 0 ? 1 : 0) + (lost > 0 ? 1 : 0) + (went > 0 ? 1 : 0);
            return (
              <li key={f.label}>
                <Link
                  href={href({ paso: isOn(i, false) ? null : String(i), quedo: null })}
                  className={`ah-dfunnel-top${isOn(i, false) ? " is-on" : ""}`}
                  aria-current={isOn(i, false) ? "true" : undefined}
                  title={`Ver las ${f.count} que llegaron a «${f.label}»`}
                >
                  <strong>{f.count}</strong>
                  <small>{i === 0 ? "Base del período" : f.ofPrevious === null ? "—" : `${f.ofPrevious}% ${OF_PREVIOUS[i]}`}</small>
                </Link>
                <div className="ah-dfunnel-plot">
                  {f.count ? (
                    <div
                      className={`ah-dfunnel-col${scale.isBroken(f.count) ? " is-broken" : ""}`}
                      style={{ height: `max(${total}%, ${segs * 24}px)`, ["--w" as string]: `${total}%` }}
                      title={scale.isBroken(f.count) ? "Barra cortada: no está a escala por encima de la línea" : undefined}
                    >
                      {stay > 0 && (
                        <Link
                          href={href({ paso: isOn(i, true) ? null : String(i), quedo: isOn(i, true) ? null : "1" })}
                          className={`ah-dfunnel-seg is-stayed${isOn(i, true) ? " is-on" : ""}`}
                          style={{ flexGrow: (restH * stay) / (stay + lost) }}
                          aria-current={isOn(i, true) ? "true" : undefined}
                          aria-label={`${stay}: ${STAYED[i].toLowerCase()}. Ver sus inmobiliarias`}
                        >
                          {stay}
                        </Link>
                      )}
                      {lost > 0 && (
                        <Link
                          href={href({ paso: isOn(i, true, true) ? null : String(i), quedo: isOn(i, true, true) ? null : "perdidas" })}
                          className={`ah-dfunnel-seg is-lost${isOn(i, true, true) ? " is-on" : ""}`}
                          style={{ flexGrow: (restH * lost) / (stay + lost) }}
                          aria-current={isOn(i, true, true) ? "true" : undefined}
                          aria-label={`${lost} perdidas (no interesadas). Ver sus inmobiliarias`}
                        >
                          {lost}
                        </Link>
                      )}
                      {/* The cut, between who went on and the rest: what is above it is not to scale. */}
                      {scale.isBroken(f.count) && (stay > 0 || lost > 0) && went > 0 && <span className="ah-dfunnel-break" aria-hidden="true" />}
                      {went > 0 && (
                        <Link
                          href={href({ paso: isOn(last ? i : i + 1, false) ? null : String(last ? i : i + 1), quedo: null })}
                          className={`ah-dfunnel-seg is-went${last ? " is-last" : ""}${isOn(last ? i : i + 1, false) ? " is-on" : ""}`}
                          style={{ flexGrow: wentH }}
                          aria-current={isOn(last ? i : i + 1, false) ? "true" : undefined}
                          aria-label={last ? `${went} suscriptas. Ver sus inmobiliarias` : `${went} pasaron a «${funnel[i + 1].label}». Ver sus inmobiliarias`}
                        >
                          {went}
                        </Link>
                      )}
                    </div>
                  ) : (
                    <span className="ah-dfunnel-zero" />
                  )}
                </div>
                <span className="ah-dfunnel-label">
                  {i + 1}. {f.label}
                  {last ? <small className="is-went">Clientes pagos</small> : stay > 0 ? <small>{stay} {STAYED[i].toLowerCase()}</small> : !lost ? <small>&nbsp;</small> : null}
                  {lost > 0 && <small className="is-lost">{lost} perdidas</small>}
                </span>
              </li>
            );
          })}
        </ol>
        <p className="ah-dfunnel-note">
          Tocá una parte de una barra para ver sus inmobiliarias: lo verde pasó al paso siguiente; lo naranja se quedó ahí; lo gris se perdió (no
          interesadas). Una barra cortada no está a escala por encima del corte, para que se vean los pasos chicos. Los dos primeros pasos salen
          de la columna «Estado» de la planilla de prospección (se sincroniza cada hora) y el período los cuenta por la fecha del primer contacto; una
          inmobiliaria con demo cuenta también en esos pasos. «Con interacción» incluye descargas e imágenes generadas en la demo; «Cuenta con interacción»: la
          cuenta subió o importó una propiedad, o generó una imagen. Un envío a un número incorrecto o sin WhatsApp no cuenta como contacto. Las inmobiliarias de prueba (QA) no cuentan.
        </p>
      </section>
  );
}
