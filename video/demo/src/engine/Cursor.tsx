import React from "react";
import { interpolate } from "remotion";

/** Flecha estilo macOS, con presión al hacer clic y una onda del color de acento. */
export const Cursor: React.FC<{ x: number; y: number; since: number; accent: string; size?: number }> = ({
  x,
  y,
  since,
  accent,
  size = 26,
}) => {
  const press = since < 10 ? interpolate(since, [0, 3, 10], [1, 0.8, 1], { extrapolateRight: "clamp" }) : 1;
  const ring = since < 18 ? since / 18 : 1;
  return (
    <>
      {since < 18 && (
        <div
          style={{
            position: "absolute",
            left: x - 30,
            top: y - 30,
            width: 60,
            height: 60,
            borderRadius: "50%",
            border: `3px solid ${accent}`,
            background: `${accent}33`,
            transform: `scale(${0.3 + ring * 1.1})`,
            opacity: 1 - ring,
            pointerEvents: "none",
          }}
        />
      )}
      <svg
        width={size}
        height={size * 1.3}
        viewBox="0 0 20 26"
        style={{
          position: "absolute",
          left: x - 2,
          top: y - 2,
          transform: `scale(${press})`,
          transformOrigin: "2px 2px",
          filter: "drop-shadow(0 2px 3px rgba(0,0,0,.35))",
          overflow: "visible",
        }}
      >
        <path
          d="M1.5 1.5 L1.5 20.5 L6.3 16.1 L9.4 23.4 L12.9 21.9 L9.9 14.8 L16.4 14.4 Z"
          fill="#111"
          stroke="#fff"
          strokeWidth={1.6}
          strokeLinejoin="round"
        />
      </svg>
    </>
  );
};
