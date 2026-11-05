"use client";
import { useEffect, useState } from "react";
import { Check, Sparkles } from "lucide-react";

/** What a staging usually takes, as told to the agency while it waits. */
export const GENERATION_TYPICAL = "entre 10 y 20 segundos";
/** The stages shown while a staging runs, with the second each one starts at. Only a guide: the server says when it is done. */
const GENERATION_STAGES: { at: number; label: (style: string) => string }[] = [
  { at: 0, label: () => "Analizando el espacio, la luz y la perspectiva" },
  { at: 4, label: (st) => `Eligiendo muebles y deco estilo ${st}` },
  { at: 9, label: () => "Ajustando materiales, sombras y reflejos" },
  { at: 15, label: () => "Puliendo los últimos detalles" },
];

/**
 * While a staging runs (the demo's «Ambientá con IA» and the panel's studio):
 * the seconds so far against what it usually takes, a bar that keeps moving
 * but never reaches the end on its own (the result shows only when it really
 * exists), the stage it is likely on and why it takes these seconds. So
 * nobody reads the wait as something broken.
 */
export function GenerationProgress({ since, styleName, note }: { since: number; styleName: string; note?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(tick);
  }, []);
  const secs = Math.max(0, (now - since) / 1000);
  // Fast at first, slower near the end: about 67% at 10 s, 85% at 20 s, never past 95%.
  const pct = Math.round(95 * (1 - Math.exp(-secs / 9)));
  const at = GENERATION_STAGES.reduce((last, s, i) => (secs >= s.at ? i : last), 0);
  const late = secs > 25;

  return (
    <div className="dv2-gen-wait">
      <div className="dv2-gen-progress">
        <div className="dv2-gen-progress-head">
          <span>{late ? "Ya casi está…" : "Trabajando en tu foto…"}</span>
          <span className="dv2-gen-progress-secs">{Math.floor(secs)} s</span>
        </div>
        <div className="dv2-gen-bar" role="progressbar" aria-label="Progreso estimado" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <span style={{ width: `${pct}%` }} />
        </div>
        <ol className="dv2-gen-stages">
          {GENERATION_STAGES.map((s, i) => (
            <li key={s.at} className={i < at ? "is-done" : i === at ? "is-on" : ""} aria-current={i === at ? "step" : undefined}>
              <span className="dv2-gen-stage-dot" aria-hidden="true">
                {i < at && <Check size={11} strokeWidth={3.5} />}
              </span>
              {s.label(styleName)}
            </li>
          ))}
        </ol>
        <p className="dv2-sr" role="status">
          {GENERATION_STAGES[at].label(styleName)}
        </p>
      </div>
      <div className="dv2-gen-why">
        <Sparkles size={16} aria-hidden="true" />
        <p>
          <strong>Suele tardar {GENERATION_TYPICAL}.</strong> Usamos uno de los modelos de IA más avanzados del mercado, que prioriza la calidad del
          resultado por sobre la velocidad.
        </p>
      </div>
      {note && <p className="dv2-gen-text">{note}</p>}
    </div>
  );
}
