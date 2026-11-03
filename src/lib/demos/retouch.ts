// The retouch of a photo: light and colour adjustments, previewed with CSS
// filters in the editor and applied on the server when it is saved as a
// version. Pure, so both sides read the same numbers. Free: it uses no credits
// and does not count toward a photo's versions.

export type Adjust = { exp: number; con: number; temp: number; sha: number };
export const NO_ADJUST: Adjust = { exp: 0, con: 0, temp: 0, sha: 0 };
export const AUTO_ADJUST: Adjust = { exp: 3, con: 10, temp: 6, sha: 15 };

const RANGE: Record<keyof Adjust, [number, number]> = { exp: [-10, 10], con: [-50, 50], temp: [-50, 50], sha: [-50, 50] };

export const sameAdjust = (a: Adjust, b: Adjust) => a.exp === b.exp && a.con === b.con && a.temp === b.temp && a.sha === b.sha;

/** Reads the adjustments from a request: whole numbers within each slider's range; anything else is refused. */
export function parseAdjust(value: unknown): Adjust | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const out = { ...NO_ADJUST };
  for (const key of Object.keys(RANGE) as (keyof Adjust)[]) {
    const n = v[key];
    const [min, max] = RANGE[key];
    if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) return null;
    out[key] = n;
  }
  return out;
}

/** The CSS filter of a retouch: the live preview. */
export function adjustFilter(a: Adjust) {
  const parts: string[] = [];
  const brightness = 1 + a.exp / 20 + a.sha / 300;
  if (brightness !== 1) parts.push(`brightness(${brightness.toFixed(3)})`);
  if (a.con) parts.push(`contrast(${(1 + a.con / 100).toFixed(3)})`);
  if (a.temp > 0) parts.push(`sepia(${(a.temp / 140).toFixed(3)})`);
  if (a.temp < 0) parts.push(`hue-rotate(${(a.temp * 0.35).toFixed(1)}deg) saturate(${(1 + a.temp / 250).toFixed(3)})`);
  return parts.join(" ");
}

/**
 * The same adjustments as image operations for sharp: brightness, contrast
 * around mid grey, and a warm or cool tint on the red and blue channels.
 * An approximation of the preview, not a copy of it.
 */
export function retouchOps(a: Adjust): { brightness: number; linear: { a: number; b: number }; tint: [[number, number, number], [number, number, number], [number, number, number]] } {
  const brightness = 1 + a.exp / 20 + a.sha / 300;
  const contrast = 1 + a.con / 100;
  const t = a.temp / 200;
  return {
    brightness,
    linear: { a: contrast, b: 128 * (1 - contrast) },
    // Row per output channel: red gains with warmth, blue loses it.
    tint: [
      [1 + t, 0, 0],
      [0, 1, 0],
      [0, 0, 1 - t],
    ],
  };
}
