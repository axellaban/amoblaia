import { describe, expect, it } from "vitest";
import { AUTO_ADJUST, NO_ADJUST, adjustFilter, parseAdjust, retouchOps, sameAdjust } from "../src/lib/demos/retouch";
import { RETOUCH_STYLE, publicImageUrl } from "../src/lib/demos/shared";

describe("Retouch adjustments", () => {
  it("accepts whole numbers within each slider's range and nothing else", () => {
    expect(parseAdjust({ exp: 3, con: -50, temp: 6, sha: 15 })).toEqual({ exp: 3, con: -50, temp: 6, sha: 15 });
    expect(parseAdjust({ exp: 11, con: 0, temp: 0, sha: 0 })).toBeNull();
    expect(parseAdjust({ exp: 1.5, con: 0, temp: 0, sha: 0 })).toBeNull();
    expect(parseAdjust({ exp: "3", con: 0, temp: 0, sha: 0 })).toBeNull();
    expect(parseAdjust({ exp: 0, con: 0, temp: 0 })).toBeNull();
    expect(parseAdjust(null)).toBeNull();
  });

  it("leaves a photo untouched when nothing is adjusted", () => {
    expect(adjustFilter(NO_ADJUST)).toBe("");
    expect(sameAdjust(NO_ADJUST, { exp: 0, con: 0, temp: 0, sha: 0 })).toBe(true);
    expect(retouchOps(NO_ADJUST)).toEqual({
      brightness: 1,
      linear: { a: 1, b: 0 },
      tint: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
    });
  });

  it("brightens and warms with the automatic fix", () => {
    expect(adjustFilter(AUTO_ADJUST)).toContain("brightness(1.200)");
    expect(adjustFilter(AUTO_ADJUST)).toContain("sepia(");
    const ops = retouchOps(AUTO_ADJUST);
    expect(ops.brightness).toBeCloseTo(1.2);
    expect(ops.tint[0][0]).toBeGreaterThan(1);
    expect(ops.tint[2][2]).toBeLessThan(1);
  });

  it("cools when the temperature goes down", () => {
    const cool = { ...NO_ADJUST, temp: -20 };
    expect(adjustFilter(cool)).toContain("hue-rotate(");
    expect(retouchOps(cool).tint[0][0]).toBeLessThan(1);
    expect(retouchOps(cool).tint[2][2]).toBeGreaterThan(1);
  });

  it("keeps contrast around mid grey", () => {
    const ops = retouchOps({ ...NO_ADJUST, con: 50 });
    // A pixel at mid grey stays put: 128 * a + b = 128.
    expect(128 * ops.linear.a + ops.linear.b).toBeCloseTo(128);
  });
});

describe("Retouch on the listing", () => {
  it("serves a shown retouch by its own parameter, never as a style", () => {
    expect(publicImageUrl("tok", "photo", { style: RETOUCH_STYLE, v: "abc" }, 800)).toBe("/demo/tok/imagen/photo?t=abc&w=800");
    expect(publicImageUrl("tok", "photo", { style: "modern", v: "x1" })).toBe("/demo/tok/imagen/photo?e=modern&r=x1");
  });
});
