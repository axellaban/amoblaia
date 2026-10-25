import React from "react";
import { Img, staticFile } from "remotion";
import { inOutWindow, out, prog } from "./ease";
import type { Box } from "./types";

/**
 * Menú desplegable dibujado sobre un <select> nativo (los menús del sistema no salen en las
 * capturas). `hover` es el índice resaltado en cada momento.
 */
export const Dropdown: React.FC<{
  f: number;
  box: Box;
  options: string[];
  open: number;
  close: number;
  hover: (f: number) => number;
  font: string;
  accent?: string;
  rowH?: number;
}> = ({ f, box, options, open, close, hover, font, accent = "#2e5fcb", rowH = 34 }) => {
  if (f < open || f > close + 6) return null;
  const t = prog(f, open, open + 7, out) * (1 - prog(f, close, close + 6));
  const h = hover(f);
  return (
    <div
      style={{
        position: "absolute",
        left: box.x,
        top: box.y + box.h + 6,
        width: Math.max(box.w, 210),
        padding: 6,
        background: "#fff",
        borderRadius: 12,
        boxShadow: "0 0 0 1px rgba(15,20,40,.08), 0 18px 40px -8px rgba(15,20,40,.35)",
        fontFamily: font,
        fontSize: 15,
        color: "#161b26",
        transformOrigin: "top center",
        transform: `scaleY(${0.85 + 0.15 * t})`,
        opacity: t,
      }}
    >
      {options.map((o, i) => (
        <div
          key={o}
          style={{
            height: rowH,
            display: "flex",
            alignItems: "center",
            padding: "0 12px",
            borderRadius: 8,
            background: i === h ? accent : "transparent",
            color: i === h ? "#fff" : undefined,
            fontWeight: i === h ? 600 : 400,
          }}
        >
          {o}
        </div>
      ))}
    </div>
  );
};

/**
 * Tipeo: tapa el contenido del campo y escribe el texto letra por letra con el cursor de texto.
 */
export const TypeIn: React.FC<{
  f: number;
  box: Box;
  text: string;
  from: number;
  cps?: number;
  until: number;
  font: string;
  size?: number;
  color?: string;
  bg?: string;
  pad?: { x: number; y: number };
  fps?: number;
  /** Desde este cuadro el campo se ve vacío (con el placeholder) hasta que empieza el tipeo. */
  coverFrom?: number;
  placeholder?: string;
  radius?: number;
  ring?: string;
}> = ({ f, box, text, from, cps = 18, until, font, size = 15, color = "#161b26", bg = "#fff", pad = { x: 12, y: 10 }, fps = 30, coverFrom, placeholder = "", radius = 10, ring = "rgba(46,95,203,.55)" }) => {
  if (f >= until) return null;
  if (f < from) {
    if (coverFrom === undefined || f < coverFrom) return null;
    return (
      <div style={{ position: "absolute", left: box.x + 2, top: box.y + 2, width: box.w - 4, height: box.h - 4, background: bg, borderRadius: radius, padding: `${pad.y}px ${pad.x}px`, fontFamily: font, fontSize: size, lineHeight: 1.4, color: "#9aa0a6" }}>
        {placeholder}
      </div>
    );
  }
  const n = Math.min(text.length, Math.floor(((f - from) / fps) * cps));
  const blink = Math.floor((f - from) / 15) % 2 === 0 || n < text.length;
  return (
    <div
      style={{
        position: "absolute",
        left: box.x + 2,
        top: box.y + 2,
        width: box.w - 4,
        height: box.h - 4,
        background: bg,
        borderRadius: radius,
        padding: `${pad.y}px ${pad.x}px`,
        fontFamily: font,
        fontSize: size,
        lineHeight: 1.4,
        color,
        boxShadow: `inset 0 0 0 2px ${ring}`,
      }}
    >
      {text.slice(0, n)}
      <span style={{ display: "inline-block", width: 1.5, height: size * 1.15, background: color, verticalAlign: "text-bottom", opacity: blink ? 1 : 0 }} />
    </div>
  );
};

/** Instantes de cada tecla (para el sonido). */
export function keyFrames(text: string, from: number, cps = 18, fps = 30, every = 2) {
  const out: number[] = [];
  for (let i = 0; i < text.length; i += every) out.push(from + Math.round((i / cps) * fps));
  return out;
}

/** Contorno que respira alrededor de una caja (para señalar algo). */
export const Glow: React.FC<{ f: number; box: Box; from: number; to: number; color: string; radius?: number; pad?: number }> = ({
  f,
  box,
  from,
  to,
  color,
  radius = 14,
  pad = 6,
}) => {
  if (f < from || f > to) return null;
  const v = inOutWindow(f, from, to, 8);
  const pulse = 0.6 + 0.4 * Math.sin((f - from) / 5);
  return (
    <div
      style={{
        position: "absolute",
        left: box.x - pad,
        top: box.y - pad,
        width: box.w + pad * 2,
        height: box.h + pad * 2,
        borderRadius: radius,
        border: `3px solid ${color}`,
        boxShadow: `0 0 ${24 * pulse}px ${color}`,
        opacity: v,
      }}
    />
  );
};

/** Archivo arrastrado (miniatura con nombre). */
export const DragFile: React.FC<{ x: number; y: number; src: string; name: string; scale?: number; opacity?: number; font: string }> = ({
  x,
  y,
  src,
  name,
  scale = 1,
  opacity = 1,
  font,
}) => (
  <div
    style={{
      position: "absolute",
      left: x - 20,
      top: y - 20,
      transform: `scale(${scale}) rotate(-4deg)`,
      transformOrigin: "20px 20px",
      opacity,
      width: 230,
      padding: 8,
      background: "#fff",
      borderRadius: 14,
      boxShadow: "0 30px 60px -15px rgba(0,0,0,.5), 0 0 0 1px rgba(0,0,0,.06)",
      fontFamily: font,
    }}
  >
    <Img src={staticFile(src)} style={{ width: "100%", height: 140, objectFit: "cover", borderRadius: 9, display: "block" }} />
    <div style={{ fontSize: 14, fontWeight: 600, color: "#161b26", padding: "8px 4px 2px" }}>{name}</div>
  </div>
);

/** Muestra un recorte de otra captura (por ejemplo, el campo ya completado) con un destello. */
export const RevealCrop: React.FC<{ f: number; src: string; box: Box; from: number; dur?: number; pad?: number; flash?: string; iw?: number; ih?: number }> = ({
  f,
  src,
  box,
  from,
  dur = 8,
  pad = 6,
  flash = "#00f0a0",
  iw = 1440,
  ih = 900,
}) => {
  if (f < from) return null;
  const t = prog(f, from, from + dur, out);
  const glow = 1 - prog(f, from + dur, from + dur + 14);
  const b = { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 };
  return (
    <div style={{ position: "absolute", left: b.x, top: b.y, width: b.w, height: b.h, overflow: "hidden", opacity: t, borderRadius: 10, boxShadow: glow > 0 ? `0 0 ${18 * glow}px ${flash}` : undefined }}>
      <Img src={staticFile(src)} style={{ position: "absolute", left: -b.x, top: -b.y, width: iw, height: ih, maxWidth: "none" }} />
    </div>
  );
};
