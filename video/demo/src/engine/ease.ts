import { Easing, interpolate } from "remotion";

export const inOut = Easing.bezier(0.65, 0, 0.35, 1);
export const out = Easing.bezier(0.16, 1, 0.3, 1);
export const inn = Easing.bezier(0.7, 0, 0.84, 0);

/** 0→1 entre a y b, con easing y recorte. */
export function prog(f: number, a: number, b: number, easing = inOut) {
  if (b <= a) return f >= a ? 1 : 0;
  return interpolate(f, [a, b], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing });
}

/** Entra en [a, a+d] y sale en [b-d, b]. */
export function inOutWindow(f: number, a: number, b: number, d = 10) {
  return Math.min(prog(f, a, a + d, out), 1 - prog(f, b - d, b, inn));
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
