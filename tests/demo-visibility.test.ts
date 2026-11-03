// «Mostrar en demostración» and the publication switches: hidden data never
// reaches the public page, and hiding never touches the saved value.
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { DEFAULT_SETTINGS, readSettings, shows } from "../src/lib/demos/branding";
import { settingsInput } from "../src/lib/demos/input";
import { applyVisibility, visibleCard } from "../src/lib/demos/visibility";


const page = {
  location: "Pompeya, Mar del Plata",
  operation: "Venta",
  price: "USD 120.000",
  expenses: "$ 20.000",
  availability: "Inmediata",
  requirements: null,
  features: "3 ambientes",
  reference: "R12",
  description: "Dúplex con patio",
  facts: [
    { icon: "rooms" as const, value: "3", label: "ambientes" },
    { icon: "area" as const, value: "160 m²", label: "totales", hidden: true },
  ],
  amenities: [{ title: "Características", items: ["Patio"] }],
  map: { precision: "zone" as const, lat: -38, lng: -57.5, radius: 700 },
  agent: { name: "Ana", role: null, photoUrl: null, initials: "A" },
  contact: { whatsapp: "+5492235555555", phone: null, email: null, url: null },
  agency: { name: "Del Rosso", website: null, logo: null, primary: "#000000", accent: "#ffffff", titleFont: "sans" as const, contact: { kind: "whatsapp" as const, value: "+5492235555555" }, visitUrl: "https://x.com" },
  listingUrl: "https://www.zonaprop.com.ar/x",
};

describe("demo visibility", () => {
  it("old settings show everything", () => {
    const s = readSettings({ price: "USD 1" });
    expect(s).toMatchObject({ hidden: [], showData: true, showStyles: true, showContact: true });
    expect(applyVisibility(page, s)).toEqual({ ...page, facts: [page.facts[0]] });
  });

  it("a hidden field leaves the page but stays saved", () => {
    const s = settingsInput({ hidden: ["price", "description"] }, { ...DEFAULT_SETTINGS, price: "USD 120.000", description: "Dúplex" });
    expect(s.price).toBe("USD 120.000");
    expect(s.description).toBe("Dúplex");
    const out = applyVisibility(page, s);
    expect(out.price).toBeNull();
    expect(out.description).toBeNull();
    expect(out.location).toBe(page.location);
  });

  it("«Mostrar datos de la propiedad» off hides every field and fact; the title is not touched", () => {
    const s = readSettings({ showData: false });
    const out = applyVisibility({ ...page, title: "Dúplex" }, s);
    expect(out.title).toBe("Dúplex");
    expect(out.facts).toEqual([]);
    expect(out.amenities).toEqual([]);
    expect([out.location, out.price, out.map, out.description, out.listingUrl]).toEqual([null, null, null, null, null]);
  });

  it("without contact data no channel nor agent reaches the page", () => {
    const out = applyVisibility(page, readSettings({ showContact: false }));
    expect(out.contact).toEqual({ whatsapp: null, phone: null, email: null, url: null });
    expect(out.agent).toBeNull();
    expect(out.agency.contact).toBeNull();
    expect(out.agency.visitUrl).toBeNull();
    expect(shows(readSettings({ showContact: false }), "agent")).toBe(false);
  });

  it("the agency's catalog follows the same switches", () => {
    expect(visibleCard(readSettings({ hidden: ["price"] }), { location: "A", operation: "Venta", price: "USD 1", features: "f" })).toEqual({
      location: "A",
      operation: "Venta",
      price: null,
      features: "f",
    });
  });

  it("rejects unknown fields and places", () => {
    expect(() => settingsInput({ hidden: ["title"] }, DEFAULT_SETTINGS)).toThrow();
    expect(() => settingsInput({ videoPlacement: "top" }, DEFAULT_SETTINGS)).toThrow();
    expect(() => settingsInput({ showData: "no" }, DEFAULT_SETTINGS)).toThrow();
    expect(settingsInput({ videoPlacement: "below", showStyles: false }, DEFAULT_SETTINGS)).toMatchObject({ videoPlacement: "below", showStyles: false });
    expect(settingsInput({ videoPlacement: "hidden" }, DEFAULT_SETTINGS).videoPlacement).toBe("hidden");
  });
});
