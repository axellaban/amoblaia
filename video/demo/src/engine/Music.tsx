import React from "react";
import { Audio, interpolate, staticFile, useVideoConfig } from "remotion";

/**
 * Música de fondo con entrada y salida suaves. `duck` baja el volumen en los tramos indicados
 * (por ejemplo, mientras habla una voz).
 */
export const Music: React.FC<{ file: string; volume?: number; duck?: { from: number; to: number; level?: number }[]; startFrom?: number }> = ({
  file,
  volume = 0.32,
  duck = [],
  startFrom = 0,
}) => {
  const { durationInFrames, fps } = useVideoConfig();
  return (
    <Audio
      src={staticFile(`music/${file}`)}
      startFrom={startFrom}
      volume={(f) => {
        const fadeIn = interpolate(f, [0, fps * 0.6], [0, 1], { extrapolateRight: "clamp" });
        const fadeOut = interpolate(f, [durationInFrames - fps * 2, durationInFrames - 2], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        let d = 1;
        for (const k of duck) {
          const level = k.level ?? 0.35;
          const t = Math.min(
            interpolate(f, [k.from - 8, k.from], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
            interpolate(f, [k.to, k.to + 10], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          );
          d = Math.min(d, 1 - (1 - level) * t);
        }
        return volume * fadeIn * fadeOut * d;
      }}
    />
  );
};
