// «Recorrido cinematográfico» is shown as available but answered with a
// «Próximamente» notice: only it, never the styles that really generate.
import { describe, expect, it } from "vitest";
import { COMING_SOON_MODES, isComingSoon, VIDEO_MODES } from "@/lib/video/plan";

describe("styles coming soon", () => {
  it("is only the cinematic tour", () => {
    expect(COMING_SOON_MODES).toEqual(["cinematic"]);
    expect(VIDEO_MODES.filter(isComingSoon)).toEqual(["cinematic"]);
  });
  it("keeps «Clásico» and «Foto en movimiento» available", () => {
    expect(isComingSoon("classic")).toBe(false);
    expect(isComingSoon("clip")).toBe(false);
  });
});
