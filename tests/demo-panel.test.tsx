import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DemoPanel } from "@/components/demo-panel";
import type { PublicDemo } from "@/lib/demos/shared";

vi.mock("@/lib/analytics", () => ({ track: () => {}, registerSuperProperties: () => {} }));

const v = (style: string) => ({ style, v: "1" });
const demo: PublicDemo = {
  id: "d1",
  agencyId: "ag1",
  agencyName: "Inmobiliaria de prueba",
  agency: { name: "Inmobiliaria de prueba", website: null, logo: null, primary: "#1f3a5f", accent: "#6f8f5a", titleFont: "sans", contact: null, visitUrl: null },
  title: "Departamento de prueba",
  location: "Centro",
  description: null,
  listingUrl: null,
  propertyType: "residential",
  operation: "Venta",
  price: null,
  expenses: null,
  availability: null,
  requirements: null,
  features: null,
  reference: null,
  facts: [],
  amenities: [],
  map: null,
  agent: null,
  contact: { whatsapp: null, phone: null, email: null, url: null },
  closingTitle: "",
  closingText: null,
  styles: [{ id: "modern", name: "Moderno" }],
  cover: { id: "p1", label: "Living", versions: [v("modern")] },
  photos: [
    { id: "p1", label: "Living", versions: [v("modern")] },
    { id: "p2", label: "Cocina", versions: [] },
  ],
  openStyle: null,
  banner: true,
  share: { title: null, description: null },
  prospect: true,
};
const INVITE = "/panel/empezar?codigo=codigoSecretoDeVeinteMasCaracteres&demo=tok";

describe("the demo inside the agency's panel", () => {
  const html = renderToStaticMarkup(<DemoPanel demo={demo} token="tok" invite={{ href: INVITE, freeCredits: 3 }} buyerHref="/demo/tok?vista=ficha" />);
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));

  it("shows the agency, its property and the panel's sections", () => {
    for (const text of ["Inmobiliaria de prueba", "Modo demostración", "Inicio", "Mi inmobiliaria", "Mis propiedades", "Departamento de prueba", "Crear propiedad", "Imágenes", "Créditos", "3 de regalo"])
      expect(html).toContain(text);
  });

  it("leads every saving action and every other section to the private invitation, never into the real panel", () => {
    const panel = hrefs.filter((h) => h.startsWith("/panel"));
    expect(panel.length).toBeGreaterThan(5);
    expect(panel.every((h) => h === INVITE)).toBe(true);
    // The rest: the buyers' view, this page and the demo's own public images.
    expect(hrefs.filter((h) => !h.startsWith("/panel")).every((h) => h === "/demo/tok?vista=ficha" || h === "#propiedad" || h.startsWith("/demo/tok/imagen/"))).toBe(true);
  });

  it("downloads the version on screen from the demo's public images, with no account", () => {
    expect(html).toMatch(/href="\/demo\/tok\/imagen\/p1\?e=modern&amp;r=1&amp;w=2048" download="departamento-de-prueba-living-moderno\.jpg"/);
  });
});
