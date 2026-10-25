import { afterEach, describe, expect, it, vi } from "vitest";
import { trackPhotoDownload, withClickIds } from "../src/lib/ads";

describe("Google Ads", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("reports a photo download as a conversion", () => {
    const gtag = vi.fn();
    vi.stubGlobal("window", { gtag });
    trackPhotoDownload();
    expect(gtag).toHaveBeenCalledWith("event", "conversion", {
      send_to: "AW-18500028132/jPd2CKfU1KkdEOSNwPVE",
    });
  });
  it("does nothing when the tag is blocked or throws", () => {
    vi.stubGlobal("window", {});
    expect(() => trackPhotoDownload()).not.toThrow();
    vi.stubGlobal("window", {
      gtag: () => {
        throw new Error("blocked");
      },
    });
    expect(() => trackPhotoDownload()).not.toThrow();
  });
  it("keeps the ad click across redirects", () => {
    expect(
      withClickIds("/acceso?next=%2Fproyectos", "?gclid=abc&utm_source=x"),
    ).toBe("/acceso?next=%2Fproyectos&gclid=abc");
    expect(withClickIds("/proyectos", "?wbraid=w&gbraid=g")).toBe(
      "/proyectos?gbraid=g&wbraid=w",
    );
    expect(withClickIds("/precios#planes", "")).toBe("/precios#planes");
    expect(withClickIds("/cuenta?gclid=old", "?gclid=new")).toBe(
      "/cuenta?gclid=old",
    );
  });
});
