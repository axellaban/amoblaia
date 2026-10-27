import { afterEach, describe, expect, it, vi } from "vitest";

const events = vi.hoisted(() => [] as { name: string; props: Record<string, unknown> }[]);
vi.mock("@/lib/analytics", () => ({ track: (name: string, props: Record<string, unknown>) => events.push({ name, props }) }));

import { copyLink, shareLink, whatsappOpened } from "../src/lib/agency/share";
import { propertyLink } from "../src/lib/agency/shared";

const abort = () => Object.assign(new Error("cancelled"), { name: "AbortError" });
afterEach(() => {
  vi.unstubAllGlobals();
  events.length = 0;
});

describe("Link of a published property", () => {
  const p = { token: "tok_abc" };
  it("works while the catalog is private: the property's own page", () => {
    expect(propertyLink("https://habita.test", p, { slug: "sur", sitePublished: false })).toBe("https://habita.test/demo/tok_abc");
    expect(propertyLink("https://habita.test", p, { slug: null, sitePublished: true })).toBe("https://habita.test/demo/tok_abc");
  });
  it("is inside the catalog once it is public", () => {
    expect(propertyLink("https://habita.test", p, { slug: "sur", sitePublished: true })).toBe("https://habita.test/inmobiliaria/sur/tok_abc");
  });
});

describe("Sharing reports what really happened", () => {
  it("counts a cancelled native share as cancelled, not shared", async () => {
    vi.stubGlobal("navigator", { share: vi.fn().mockRejectedValue(abort()), clipboard: { writeText: vi.fn() } });
    expect(await shareLink("https://x", "Casa", "p1")).toBe("cancelled");
    expect(events.map((e) => e.name)).toEqual(["property_share_cancelled"]);
    expect((navigator as unknown as { clipboard: { writeText: ReturnType<typeof vi.fn> } }).clipboard.writeText).not.toHaveBeenCalled();
  });

  it("counts a native share only once it resolved", async () => {
    vi.stubGlobal("navigator", { share: vi.fn().mockResolvedValue(undefined) });
    expect(await shareLink("https://x", "Casa", "p1")).toBe("shared");
    expect(events).toEqual([{ name: "property_shared", props: { property_id: "p1", channel: "native" } }]);
  });

  it("falls back to copying when the native share is not allowed", async () => {
    vi.stubGlobal("navigator", { share: vi.fn().mockRejectedValue(new Error("NotAllowedError")), clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    expect(await shareLink("https://x", "Casa", "p1")).toBe("copied");
    expect(events.map((e) => e.name)).toEqual(["property_shared"]);
  });

  it("does not say “copied” when the clipboard refused it", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    expect(await copyLink("https://x", "p1")).toBe("failed");
    vi.stubGlobal("navigator", {});
    expect(await copyLink("https://x", "p1")).toBe("failed");
    expect(events.map((e) => e.name)).toEqual(["property_share_failed", "property_share_failed"]);
  });

  it("records opening WhatsApp as opened, never as sent", () => {
    whatsappOpened("p1");
    expect(events).toEqual([{ name: "property_share_opened", props: { property_id: "p1", channel: "whatsapp" } }]);
  });
});
