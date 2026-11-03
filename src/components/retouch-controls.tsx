"use client";
// The retouch controls shared by the studio's "Editar" tab and the demo's
// owner panel: light and colour with a live preview, and the AI tools
// (shown, not yet available). Saving is the caller's.
import { useState, type ChangeEvent } from "react";
import { Cloud, Eraser, Loader2, Sparkles, Sun } from "lucide-react";
import { AUTO_ADJUST, sameAdjust, type Adjust } from "@/lib/demos/retouch";
import { TOOLS, type Tool } from "@/lib/demos/tools";

export type ToolsState = {
  tool: Tool | null;
  onPick: (tool: Tool | null) => void;
  /** Quitar objetos: the brush size and its undo and clear. */
  size: number;
  onSize: (size: number) => void;
  painted: boolean;
  onUndo: () => void;
  onClear: () => void;
  /** What the choice costs and who pays, as the server quotes it. */
  note: string;
  busy: boolean;
  onApply: () => void;
};

const LABEL: Record<Tool, string> = { sky: "Cambiar cielo", dusk: "Día a atardecer", remove: "Quitar objetos" };
const ICON: Record<Tool, typeof Cloud> = { sky: Cloud, dusk: Sun, remove: Eraser };
const HINT: Record<Tool, string> = {
  sky: "Reemplaza el cielo por uno despejado. El resto de la foto no cambia.",
  dusk: "Pasa la luz de día a un atardecer. Las luces y ventanas existentes se mantienen.",
  remove: "Pintá sobre la foto lo que querés quitar. Lo demás no cambia.",
};

function ToolsSection({ tools, id, tiles }: { tools: ToolsState; id: string; tiles: boolean }) {
  const can = tools.tool === "remove" ? tools.painted : true;
  return (
    <section className={`pw-edit-group ${tiles ? "pw-tools-tiles" : ""}`} aria-labelledby={`${id}-ai`}>
      <span id={`${id}-ai`}>{tiles ? "Herramientas con IA" : "Herramientas IA · 1 crédito"}</span>
      {tiles && (
        <div className="pw-tool-tiles">
          {TOOLS.map((t) => {
            const Icon = ICON[t];
            return (
              <button
                key={t}
                type="button"
                className={`pw-tool-tile ${tools.tool === t ? "is-on" : ""}`}
                aria-pressed={tools.tool === t}
                onClick={() => tools.onPick(tools.tool === t ? null : t)}
              >
                <Icon size={22} aria-hidden="true" />
                <span>{LABEL[t]}</span>
              </button>
            );
          })}
        </div>
      )}
      {!tiles && TOOLS.map((t) => (
        <button
          key={t}
          type="button"
          className={`pw-tool pw-tool-button ${tools.tool === t ? "is-on" : ""}`}
          aria-pressed={tools.tool === t}
          onClick={() => tools.onPick(tools.tool === t ? null : t)}
        >
          <span>{LABEL[t]}</span>
          <span className="pw-soon">IA</span>
        </button>
      ))}
      {tools.tool && (
        <div className="pw-tool-panel">
          <p className="pw-hint">{HINT[tools.tool]}</p>
          {tools.tool === "remove" && (
            <>
              <label className="pw-slider">
                <span>Pincel</span>
                <input type="range" min={10} max={160} value={tools.size} onChange={(e) => tools.onSize(Number(e.target.value))} aria-label="Tamaño del pincel" />
                <output>{tools.size}</output>
              </label>
              <div className="pw-edit-actions">
                <button type="button" className="button button-outline button-small" disabled={!tools.painted} onClick={tools.onUndo}>
                  Deshacer
                </button>
                <button type="button" className="button button-outline button-small" disabled={!tools.painted} onClick={tools.onClear}>
                  Limpiar
                </button>
              </div>
            </>
          )}
          {tools.note && <p className="pw-note">{tools.note}</p>}
          {tiles && !tools.note && <p className="pw-note">Cada herramienta usa 1 crédito; el costo se confirma antes de aplicar.</p>}
          <button type="button" className="button button-primary button-small" disabled={!can || tools.busy} onClick={tools.onApply}>
            {tools.busy ? <Loader2 size={14} className="spin" /> : null} {tools.busy ? "Empezando…" : "Aplicar"}
          </button>
        </div>
      )}
    </section>
  );
}

const signed = (n: number, decimals = 0) => {
  const s = decimals ? n.toFixed(decimals) : String(n);
  return n > 0 ? `+${s}` : s;
};

export function RetouchControls({
  id,
  adjust,
  onAdjust,
  tools,
  layout = "list",
}: {
  /** "tiles": Estudio de imágenes (Mejora automática under the sliders, the AI tools as three tiles). */
  layout?: "list" | "tiles";
  id: string;
  adjust: Adjust;
  onAdjust: (next: Adjust) => void;
  /** The AI tools; without them the section is not shown (the demo's panel). */
  tools?: ToolsState;
}) {
  const [autoPicked, setAuto] = useState(false);
  // «Aplicada» only while the values are still the automatic ones (not after saving, discarding or moving a slider).
  const auto = autoPicked && sameAdjust(adjust, AUTO_ADJUST);
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
  const tiles = layout === "tiles";
  const autoButton = (
    <button
      type="button"
      className={`button button-small button-outline ${tiles ? "pw-auto" : ""}`}
      aria-pressed={auto}
      onClick={() => {
        setAuto(true);
        onAdjust(AUTO_ADJUST);
      }}
    >
      {tiles && <Sparkles size={15} aria-hidden="true" />} {auto ? "Aplicada" : "Mejora automática"}
    </button>
  );
  if (tiles)
    return (
      <>
        <section className="pw-edit-group" aria-labelledby={`${id}-light`}>
          <span id={`${id}-light`} className="pw-edit-title">
            Luz y color
          </span>
          {sliders.map((s) => (
            <label key={s.key} className="pw-slider">
              <span>{s.label}</span>
              <input type="range" min={s.min} max={s.max} value={adjust[s.key]} onChange={set(s.key)} aria-label={s.label} />
              <output>{s.shown}</output>
            </label>
          ))}
          {autoButton}
        </section>
        {tools && <ToolsSection tools={tools} id={id} tiles />}
      </>
    );
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

      {tools && <ToolsSection tools={tools} id={id} tiles={false} />}
    </>
  );
}
