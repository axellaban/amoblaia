import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DemoView } from "@/components/demo-view";
import { DEMO_STYLES } from "@/lib/demos/styles";
import type { PublicDemo } from "@/lib/demos/shared";

vi.mock("@/lib/analytics", () => ({ track: () => {}, trackMilestone: () => {}, registerSuperProperties: () => {}, registerSuperPropertiesOnce: () => {} }));
let pathname = "/demo/tok/presentacion/codigo";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }), usePathname: () => pathname }));

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


describe("the agency's own demo, under its panel header", () => {
  const owner = {
    href: INVITE,
    code: "TEST-CODIGO-0000000000000000000000000000", freeCredits: 3,
    buyerHref: "/demo/tok/presentacion/codigo/ficha",
    demoHref: "/demo/tok/presentacion/codigo",
    pricesHref: "/demo/tok/presentacion/codigo/precios",
  };
  const html = renderToStaticMarkup(<DemoView demo={demo} source={{ kind: "public", token: "tok" }} presentation owner={owner} />);
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));

  it("shows the agency, the panel's sections and the whole listing", () => {
    for (const text of ["Inmobiliaria de prueba", "Modo demostración", "Inicio", "Mis propiedades", "Imágenes", "Créditos", "Precios", "3 de regalo", "Crear propiedad", "Guardar mi panel", "Ver como comprador", "Departamento de prueba"])
      expect(html).toContain(text);
    expect(html).toContain('class="dv2-owner"');
    expect(html).not.toContain("dv2-banner");
  });

  it("leads every saving action and every other section to the private invitation, never into the real panel", () => {
    const panel = hrefs.filter((h) => h.startsWith("/panel"));
    expect(panel.length).toBeGreaterThan(3);
    expect(panel.every((h) => h === INVITE)).toBe(true);
    // The only other ways out are the buyers' view and the plans, both inside the agency's environment.
    expect(hrefs.filter((h) => !h.startsWith("/panel")).every((h) => h === owner.buyerHref || h === owner.pricesHref || h.startsWith("#") || h.startsWith("/demo/tok/imagen/"))).toBe(true);
    expect(hrefs).not.toContain("/precios");
  });

  it("lists the original first, then four styles and the rest behind «Más estilos»", () => {
    const rows = [...html.matchAll(/<li class="dv2-owner-row[^"]*">[\s\S]*?<strong>([^<]+)<\/strong>/g)].map((m) => m[1]);
    expect(rows[0]).toBe("Original");
    expect(rows.slice(1)).toHaveLength(4);
    expect(rows[1]).toBe("Moderno");
    expect(html).toContain(`Más estilos (${DEMO_STYLES.residential.length - 4})`);
  });

  it("downloads prepared versions from the public images and asks to generate the rest", () => {
    expect(html).toMatch(/href="\/demo\/tok\/imagen\/p1\?e=modern&amp;r=1&amp;w=2048" download="departamento-de-prueba-living-moderno\.jpg"/);
    expect(html).toMatch(/href="\/demo\/tok\/imagen\/p1\?r=o&amp;w=2048" download="departamento-de-prueba-living-original\.jpg"/);
    expect((html.match(/class="dv2-owner-row is-missing"/g) ?? []).length).toBe(3);
    expect((html.match(/<\/svg> Generar<\/button>/g) ?? []).length).toBe(3);
  });
});

describe("the agency's plans, from its link …/precios", () => {
  const owner = {
    href: INVITE,
    code: "TEST-CODIGO-0000000000000000000000000000", freeCredits: 3,
    buyerHref: "/demo/tok/presentacion/codigo/ficha",
    demoHref: "/demo/tok/presentacion/codigo",
    pricesHref: "/demo/tok/presentacion/codigo/precios",
  };
  const render = (path: string) => {
    pathname = path;
    return renderToStaticMarkup(
      <DemoView demo={demo} source={{ kind: "public", token: "tok" }} presentation owner={owner} plans={<p>Planes de habita</p>} />,
    );
  };

  it("keeps the agency's bar and shows the plans under it, with the property hidden until it goes back", () => {
    const html = render(owner.pricesHref);
    expect(html).toContain('class="dv2-owner"');
    expect(html).toContain("Planes de habita");
    expect(html).toContain("Volver a la propiedad");
    expect(html).toMatch(/class="container dv2-main" hidden=""/);
    expect(html).toMatch(/<a href="\/demo\/tok\/presentacion\/codigo\/precios" aria-current="page" class="is-on"/);
    expect(html.indexOf('class="dv2-owner"')).toBeLessThan(html.indexOf("Planes de habita"));
  });

  it("shows the property, not the plans, on the presentation itself", () => {
    const html = render(owner.demoHref);
    expect(html).not.toContain("Planes de habita");
    expect(html).not.toMatch(/dv2-main" hidden/);
  });
});
