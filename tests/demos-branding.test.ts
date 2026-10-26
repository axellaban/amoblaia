import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  adminClient: () => {
    throw new Error("not used");
  },
  currentUser: async () => null,
}));
import { contactHref, readSettings, textOn, whatsappNumber } from "../src/lib/demos/branding";
import { brandingInput, settingsInput } from "../src/lib/demos/input";

const listing = { title: "Depto en La Perla", reference: "RAP12025427", url: "https://russillo.test/p/1" };

describe("Contact with the agency", () => {
  it("prepares a WhatsApp message with the property's reference; the buyer sends it", () => {
    const href = contactHref({ contactKind: "whatsapp", contactValue: "+54 9 223 555-1234" }, listing)!;
    const url = new URL(href);
    expect(url.origin + url.pathname).toBe("https://wa.me/5492235551234");
    expect(url.searchParams.get("text")).toBe(
      'Hola! Quiero consultar por "Depto en La Perla" (ref. RAP12025427): https://russillo.test/p/1',
    );
  });
  it("uses the agency's own channel: its form, phone or e-mail", () => {
    expect(contactHref({ contactKind: "url", contactValue: "russillo.test/contacto" }, listing)).toBe(
      "https://russillo.test/contacto",
    );
    expect(contactHref({ contactKind: "phone", contactValue: "+54 (223) 555-1234" }, listing)).toBe("tel:+542235551234");
    expect(contactHref({ contactKind: "email", contactValue: "info@russillo.test" }, listing)).toMatch(
      /^mailto:info@russillo\.test\?subject=Consulta/,
    );
  });
  it("shows no contact button without a configured channel (nothing invented)", () => {
    expect(contactHref({}, listing)).toBeNull();
    expect(contactHref({ contactKind: "whatsapp", contactValue: "123" }, listing)).toBeNull();
  });
});

describe("Branding and settings input", () => {
  it("validates colors, the contact channel and the visit link", () => {
    const out = brandingInput(
      { primary: "#1F3A5F", accent: "", contactKind: "whatsapp", contactValue: "+54 9 223 555-1234", visitUrl: "" },
      { accent: "#000000", logo: { type: "image/png", data: "x", v: "1" } },
    );
    expect(out).toEqual({
      primary: "#1f3a5f",
      contactKind: "whatsapp",
      contactValue: "+54 9 223 555-1234",
      logo: { type: "image/png", data: "x", v: "1" },
    });
    expect(() => brandingInput({ primary: "blue" }, {})).toThrow(/#RRGGBB/);
    expect(() => brandingInput({ contactKind: "whatsapp", contactValue: "12" }, {})).toThrow(/código de país/);
    expect(() => brandingInput({ contactKind: "email", contactValue: "nope" }, {})).toThrow(/email/);
    expect(brandingInput({ contactKind: "whatsapp", contactValue: "" }, { contactKind: "phone", contactValue: "1" })).toEqual({});
  });
  it("opens with the original photo and shows the strip unless configured otherwise", () => {
    expect(readSettings(undefined)).toMatchObject({ openMode: "original", openStyle: null, banner: true });
    const next = settingsInput({ openMode: "styled", openStyle: "modern", price: "  USD 265.000 " }, readSettings({}));
    expect(next).toMatchObject({ openMode: "styled", openStyle: "modern", price: "USD 265.000" });
    expect(() => settingsInput({ openMode: "zoom" }, readSettings({}))).toThrow();
    expect(() => settingsInput({ banner: "no" }, readSettings({}))).toThrow();
  });
  it("picks readable text for the agency's colors", () => {
    expect(textOn("#1f3a5f")).toBe("#ffffff");
    expect(textOn("#f4e9c8")).toBe("#161b26");
    expect(whatsappNumber("+54 9 223 555-1234")).toBe("5492235551234");
  });
});
