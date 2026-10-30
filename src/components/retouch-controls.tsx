"use client";
// The retouch controls shared by the studio's "Editar" tab and the demo's
// owner panel: light and colour with a live preview, and the AI tools
// (shown, not yet available). Saving is the caller's.
import { useState, type ChangeEvent } from "react";
import { AUTO_ADJUST, type Adjust } from "@/lib/demos/retouch";

const signed = (n: number, decimals = 0) => {
  const s = decimals ? n.toFixed(decimals) : String(n);
  return n > 0 ? `+${s}` : s;
};

export function RetouchControls({ id, adjust, onAdjust }: { id: string; adjust: Adjust; onAdjust: (next: Adjust) => void }) {
  const [auto, setAuto] = useState(false);
  const set = (key: keyof Adjust) => (e: ChangeEvent<HTMLInputElement>) => {
    setAuto(false);
    onAdjust({ ...adjust, [key]: Number(e.target.value) });
  };
  const sliders: { key: keyof Adjust; label: string; min: number; max: number; shown: string }[] = [
    { key: "exp", label: "Exposición", min: -10, max: 10, shown: signed(adjust.exp / 10, 1) },
    { key: "con", label: "Contraste", min: -50, max: 50, shown: signed(adjust.con) },
    { key: "temp", label: "Temperatura", min: -50, max: 50, shown: adjust.temp === 0 ? "Neutra" : adjust.temp > 0 ? "Cálida" : "Fría" },
    { key: "sha", label: "Sombras", min: -50, max: 50, shown: signed(adjust.sha) },
  ];
  return (
    <>
      <section className="pw-edit-group" aria-labelledby={`${id}-light`}>
        <div className="pw-edit-row">
          <span id={`${id}-light`}>Luz y color</span>
          <button
            type="button"
            className="button button-small button-outline"
            aria-pressed={auto}
            onClick={() => {
              setAuto(true);
              onAdjust(AUTO_ADJUST);
            }}
          >
            {auto ? "Aplicada" : "Mejora automática"}
          </button>
        </div>
        {sliders.map((s) => (
          <label key={s.key} className="pw-slider">
            <span>{s.label}</span>
            <input type="range" min={s.min} max={s.max} value={adjust[s.key]} onChange={set(s.key)} aria-label={s.label} />
            <output>{s.shown}</output>
          </label>
        ))}
      </section>

      <section className="pw-edit-group" aria-labelledby={`${id}-ai`}>
        <span id={`${id}-ai`}>Herramientas IA · 1 crédito</span>
        {["Quitar objetos", "Cambiar cielo", "Día a atardecer"].map((label) => (
          <div key={label} className="pw-tool" aria-disabled="true">
            <span>{label}</span>
            <span className="pw-soon">Próximamente</span>
          </div>
        ))}
      </section>

    </>
  );
}
