import React from "react";
import { useCurrentFrame } from "remotion";
import { inOutWindow, out, prog } from "./ease";
import { useFormat } from "./layout";
import type { Theme } from "./types";

/**
 * Subtítulo de paso. Horizontal: píldora sobre el borde inferior de la ventana.
 * Vertical: titular grande arriba de la ventana.
 */
export const StepCaption: React.FC<{
  theme: Theme;
  n?: number | string;
  text: React.ReactNode;
  sub?: React.ReactNode;
  from: number;
  to: number;
}> = ({ theme, n, text, sub, from, to }) => {
  const f = useCurrentFrame();
  const format = useFormat();
  if (f < from - 1 || f > to + 1) return null;
  const v = inOutWindow(f, from, to, 12);
  const rise = (1 - prog(f, from, from + 16, out)) * 30;
  if (format === "landscape") {
    return (
      <div
        style={{
          position: "absolute",
          left: "50%",
          bottom: 34,
          transform: `translate(-50%, ${rise}px)`,
          opacity: v,
          display: "flex",
          alignItems: "center",
          gap: 18,
          padding: "16px 34px 16px 18px",
          borderRadius: 999,
          background: theme.pill,
          color: theme.pillInk,
          fontFamily: theme.display,
          fontSize: 34,
          fontWeight: 650,
          letterSpacing: "-0.01em",
          boxShadow: "0 20px 50px -12px rgba(0,0,0,.45)",
          whiteSpace: "nowrap",
        }}
      >
        {n !== undefined && (
          <span
            style={{
              width: 48,
              height: 48,
              borderRadius: "50%",
              background: theme.step,
              color: theme.stepInk,
              display: "grid",
              placeItems: "center",
              fontSize: 26,
              fontWeight: 800,
            }}
          >
            {n}
          </span>
        )}
        <span>{text}</span>
        {sub && <span style={{ opacity: 0.65, fontWeight: 500, fontSize: 28 }}>{sub}</span>}
      </div>
    );
  }
  return (
    <div
      style={{
        position: "absolute",
        left: 64,
        right: 64,
        top: 118,
        opacity: v,
        transform: `translateY(${rise}px)`,
        fontFamily: theme.display,
        color: theme.ink,
      }}
    >
      {n !== undefined && (
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 12,
            fontSize: 30,
            fontWeight: 700,
            color: theme.accent,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            marginBottom: 14,
          }}
        >
          Paso {n}
        </div>
      )}
      <div style={{ fontSize: 70, lineHeight: 1.04, fontWeight: 750, letterSpacing: "-0.02em", textWrap: "balance" } as React.CSSProperties}>{text}</div>
      {sub && <div style={{ fontSize: 34, marginTop: 12, color: theme.muted, fontWeight: 500 }}>{sub}</div>}
    </div>
  );
};

/** Texto que entra palabra por palabra. */
export const WordsIn: React.FC<{ text: string; from: number; stagger?: number; style?: React.CSSProperties; highlight?: string[]; accent?: string }> = ({
  text,
  from,
  stagger = 3,
  style,
  highlight = [],
  accent,
}) => {
  const f = useCurrentFrame();
  const words = text.split(" ");
  return (
    <span style={style}>
      {words.map((w, i) => {
        const t = prog(f, from + i * stagger, from + i * stagger + 14, out);
        const hl = highlight.some((h) => w.toLowerCase().startsWith(h.toLowerCase()));
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              opacity: t,
              transform: `translateY(${(1 - t) * 0.5}em)`,
              filter: `blur(${(1 - t) * 8}px)`,
              marginRight: "0.25em",
              color: hl ? accent : undefined,
            }}
          >
            {w}
          </span>
        );
      })}
    </span>
  );
};
