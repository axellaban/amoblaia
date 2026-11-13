import { describe, expect, it } from "vitest";
import { ledgerLabel, visibleMovement } from "@/lib/credits-ledger";

// QA 2026-11-13 am: «Últimos movimientos» de /panel/creditos mostraba
// «video_reserved: -3» y «free_results_enabled: 0», los códigos internos.
describe("credit movements in the panel", () => {
  it("names the video charge and its refund", () => {
    expect(ledgerLabel("video_reserved")).toBe("Video");
    expect(ledgerLabel("video_refund")).toBe("Devolución de video");
    expect(ledgerLabel("photo_reserved")).toBe("Foto ambientada");
  });

  it("never shows an internal code, even for a reason it does not know", () => {
    expect(ledgerLabel("some_new_reason")).toBe("Movimiento de créditos");
  });

  it("hides the 0 markers", () => {
    expect(visibleMovement({ delta: 0 })).toBe(false);
    expect(visibleMovement({ delta: -3 })).toBe(true);
    expect(visibleMovement({ delta: 10 })).toBe(true);
  });
});
