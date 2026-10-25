import React from "react";
import { C, theme } from "./theme";

/** Logo de amoblaIA (mismo dibujo que src/components/shell.tsx). */
export const Logo: React.FC<{ size?: number }> = ({ size = 36 }) => (
  <span style={{ display: "inline-flex", alignItems: "center", fontFamily: theme.display, fontSize: size * 0.75, fontWeight: 650, letterSpacing: "-0.03em", color: "#fff", lineHeight: 1 }}>
    <svg viewBox="0 0 40 40" width={size} height={size} style={{ marginRight: size * 0.28 }}>
      <rect width="40" height="40" rx="11" fill="#3c59bf" />
      <g fill="none" stroke="#fbf1e8" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 31V19a8 8 0 0 1 16 0v12M8.5 31h23" />
        <path d="M15.5 27.5v-2A1.5 1.5 0 0 1 17 24h6a1.5 1.5 0 0 1 1.5 1.5v2" />
      </g>
      <path d="M31.5 4.5l1.3 3.7 3.7 1.3-3.7 1.3-1.3 3.7-1.3-3.7-3.7-1.3 3.7-1.3z" fill="#cbff9a" />
    </svg>
    amobla<span style={{ fontWeight: 800, fontSize: "0.78em", letterSpacing: "0.02em", marginLeft: size * 0.05, color: C.lime }}>IA</span>
  </span>
);
