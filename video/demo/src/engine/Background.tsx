import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import type { Theme } from "./types";

/** Fondo de marca: degradé con dos luces que se mueven despacio. */
export const Background: React.FC<{ theme: Theme; glow?: string; glow2?: string }> = ({ theme, glow, glow2 }) => {
  const f = useCurrentFrame();
  const a = Math.sin(f / 90) * 8;
  const b = Math.cos(f / 110) * 8;
  return (
    <AbsoluteFill style={{ background: `linear-gradient(160deg, ${theme.bg} 0%, ${theme.bg2} 100%)` }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at ${20 + a}% ${15 + b}%, ${glow ?? theme.accent}40 0%, transparent 45%), radial-gradient(circle at ${85 - b}% ${90 + a}%, ${glow2 ?? theme.accent}30 0%, transparent 50%)`,
        }}
      />
      <AbsoluteFill
        style={{
          opacity: theme.dark ? 0.07 : 0.05,
          backgroundImage: `radial-gradient(${theme.dark ? "#fff" : "#000"} 1px, transparent 1px)`,
          backgroundSize: "28px 28px",
        }}
      />
    </AbsoluteFill>
  );
};
