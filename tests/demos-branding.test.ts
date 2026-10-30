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
    expect(readSettings(undefined)).toMatchObject({ openMode: "styled", openStyle: null, banner: true });
    expect(readSettings({ openMode: "original" })).toMatchObject({ openMode: "original" });
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
  it("reads a local Argentine WhatsApp as wa.me needs it", () => {
    expect(whatsappNumber("2235273341")).toBe("5492235273341");
    expect(whatsappNumber("0223 527-3341")).toBe("5492235273341");
    expect(whatsappNumber("0054 9 223 527 3341")).toBe("5492235273341");
    expect(whatsappNumber("5492235273341")).toBe("5492235273341");
    expect(whatsappNumber("0223 15 527-3341")).toBe("5492235273341");
    expect(whatsappNumber("54 223 527 3341")).toBe("5492235273341");
    expect(whatsappNumber("+1 415 555 0100")).toBe("14155550100");
    expect(whatsappNumber("+44 7911 123456")).toBe("447911123456");
    expect(whatsappNumber("123")).toBeNull();
  });
});

import { buildDemoPrompt, styleFits } from "../src/lib/demos/styles";
import { moneyMentions, parseListing } from "../src/lib/demos/listing";
import { reviewWarnings } from "../src/lib/demos/server";

describe("Property types", () => {
  it("stages offices as workplaces, keeping the architectural constraints", () => {
    const prompt = buildDemoPrompt("office", "office_executive", "furnish", "");
    expect(prompt).toContain("commercial office");
    expect(prompt).toContain("not a home");
    expect(prompt).toContain("STRICT ARCHITECTURAL CONSTRAINTS");
    expect(styleFits("modern", "office")).toBe(false);
    expect(styleFits("office_team", "office")).toBe(true);
    expect(buildDemoPrompt("living", "modern", "furnish", "")).toContain("living room");
  });
});

describe("Listing data", () => {
  it("reads the full description and every published amount", () => {
    const html = `<title>Oficina en Güemes</title>
      <div class="price">$ 1.100.000</div>
      <div id="description"><p>Oficina con dos privados.</p><ul><li>Baño con antebaño</li><li>Primer piso por escalera</li></ul>
      <p>Valor $950.000 más expensas.</p></div>`;
    const listing = parseListing(html, "https://inmo.test/p/1");
    expect(listing.fullDescription).toContain("Oficina con dos privados.");
    expect(listing.fullDescription).toContain("- Baño con antebaño");
    expect(listing.prices).toEqual(["$ 1.100.000", "$ 950.000"]);
    expect(moneyMentions("USD 95.000 y U$S 95.000")).toEqual(["USD 95.000"]);
  });
  it("validates the location and the agent before saving", () => {
    expect(() => settingsInput({ map: { precision: "approx", lat: "", lng: "" } }, readSettings({}))).toThrow(/latitud/);
    expect(settingsInput({ map: { precision: "zone", lat: "-38.0", lng: "-57.55" } }, readSettings({})).map).toEqual({
      precision: "zone",
      lat: -38,
      lng: -57.55,
      radius: null,
      source: "manual",
    });
    expect(() => settingsInput({ agent: { name: "Ana", whatsapp: "12" } }, readSettings({}))).toThrow(/WhatsApp/);
    expect(() => settingsInput({ agent: { name: "Ana", photoUrl: "http://x.test/a.jpg" } }, readSettings({}))).toThrow(/https/);
    expect(settingsInput({ agent: { name: "" } }, readSettings({})).agent).toBeNull();
  });
  it("warns privately about what is missing or contradictory", () => {
    const warnings = reviewWarnings({
      settings: readSettings({ priceConflict: "dos importes", propertyType: "office" }),
      branding: {},
      listingUrl: "https://inmo.test/p/1",
      photos: [
        { id: "p", spaceId: null, projectId: "x", position: 0, visible: true, room: "living", label: null, mode: "furnish", discarded: [], source: null, charged: false, shown: { modern: "g" }, generations: [], retouches: [] },
      ],
    });
    expect(warnings.join("\n")).toMatch(/Sin contacto válido/);
    expect(warnings.join("\n")).toMatch(/Precio en conflicto \(dos importes\)/);
    expect(warnings.join("\n")).toMatch(/otro tipo de inmueble \(Moderno\)/);
    expect(warnings.join("\n")).toMatch(/Sin ubicación verificada/);
    expect(warnings.join("\n")).toMatch(/revisada/);
  });
});
