import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/supabase/server", () => ({ adminClient: () => ({}) }));
vi.mock("@/lib/supabase/config", () => ({ cloudConfigured: () => false }));
vi.mock("@/lib/agency/visit", () => ({ liveVisit: async () => null }));
vi.mock("@/lib/demos/server", () => ({ publishedDemo: async () => null }));

const preview = await import("@/lib/agency/panel-preview");

describe("the preview of a shared panel link", () => {
  it("is only for link-preview bots, never for people", () => {
    for (const ua of ["WhatsApp/2.23.20.0 A", "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)", "Twitterbot/1.0", "TelegramBot (like TwitterBot)", "LinkedInBot/1.0"])
      expect(preview.isPreviewBot(ua)).toBe(true);
    for (const ua of ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0", null, ""])
      expect(preview.isPreviewBot(ua)).toBe(false);
  });

  it("names the agency and its free credits, and says no account is needed while it has none", () => {
    const text = preview.panelPreviewText({ agencyName: "Inmobiliaria Sur", freeCredits: 3, claimed: false, cover: null });
    expect(text.title).toBe("Tu panel de Inmobiliaria Sur · habita.");
    expect(text.description).toContain("con 3 créditos gratis");
    expect(text.description).toContain("sin crear cuenta");
    expect(preview.panelPreviewText({ agencyName: "Inmobiliaria Sur", freeCredits: 0, claimed: true, cover: null }).description).not.toContain("sin crear cuenta");
    expect(preview.creditsLine({ freeCredits: 1 })).toBe("Tenés 1 crédito gratis");
    expect(preview.creditsLine({ freeCredits: 0 })).toBe("10 créditos gratis por mes");
  });

  it("falls back to a generic preview when the link no longer opens a panel", async () => {
    expect(await preview.panelPreview("abcdefghjk")).toEqual({ agencyName: null, freeCredits: 0, claimed: false, cover: null });
    expect(preview.panelPreviewText({ agencyName: null, freeCredits: 0, claimed: false, cover: null }).title).toBe("Tu panel de habita.");
    expect(preview.panelPreviewImagePath("abc")).toBe("/api/vista-panel?codigo=abc");
  });

  it("gives bots only the preview's tags, with the image of that code", async () => {
    const res = await preview.panelPreviewResponse("abcdefghjk", new Request("https://www.habitaia.app/i/sur-abcdefghjk"));
    const html = await res.text();
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(html).toContain('<meta property="og:image" content="https://www.habitaia.app/api/vista-panel?codigo=abcdefghjk">');
    expect(html).toContain('<meta property="og:title" content="Tu panel de habita.">');
  });
});
