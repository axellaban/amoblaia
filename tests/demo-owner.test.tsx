import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DemoView } from "@/components/demo-view";
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

  it("follows the mockup: HABITA bar with «Demo para inmobiliaria», the pitch, the photo, the styles, then the listing", () => {
    for (const text of ["HABITA", "Demo para inmobiliaria", "Precios", "Guardar mi panel", "Ver como comprador", "Así podría verse esta propiedad con Habita", "Mejorá tus fotos, probá distintos estilos", "Departamento de prueba"])
      expect(html).toContain(text);
    expect(html).toContain('class="dv2-owner"');
    for (const old of ["Modo demostración", "dv2-owner-nav", "dv2-owner-strip", "dv2-banner"]) expect(html).not.toContain(old);
    // The pitch, the photo and the styles come first; the property's listing below.
    expect(html.indexOf('id="dv2-hero-title"')).toBeLessThan(html.indexOf("dv2-stage"));
    expect(html.indexOf("dv2-stage")).toBeLessThan(html.indexOf('id="dv2-estilos"'));
    expect(html.indexOf('id="dv2-estilos"')).toBeLessThan(html.indexOf('id="dv2-title"'));
    expect(html).toContain("Antes");
    expect(html).toContain("Después");
  });

  it("leads every saving action to the private invitation, never into the real panel", () => {
    const panel = hrefs.filter((h) => h.startsWith("/panel"));
    expect(panel.length).toBeGreaterThanOrEqual(1);
    expect(panel.every((h) => h === INVITE)).toBe(true);
    // The only other ways out are the buyers' view and the plans, both inside the agency's environment.
    expect(hrefs.filter((h) => !h.startsWith("/panel")).every((h) => h === owner.buyerHref || h === owner.pricesHref || h.startsWith("#") || h.startsWith("/demo/tok/imagen/"))).toBe(true);
    expect(hrefs).not.toContain("/precios");
  });

  it("has one «Estilos» section: prepared styles with «Editar» and «Crear video» (in the panel), then «Generar» for the rest", () => {
    const cards = [...html.matchAll(/<li class="dv2-style-card[^"]*">[\s\S]*?<span class="dv2-style-name">([^<]+)<\/span>/g)].map((m) => m[1]);
    expect(cards[0]).toBe("Moderno");
    expect(cards).toHaveLength(4);
    expect((html.match(/class="dv2-style-card is-missing"/g) ?? []).length).toBe(3);
    expect((html.match(/class="dv2-style-generate"/g) ?? []).length).toBe(3);
    expect(html).toContain('aria-label="Editar Moderno"');
    // The video action leads to the panel (where videos are made), never to a fake clip.
    expect(html).toMatch(/href="\/panel\/empezar\?codigo=[^"]+" aria-label="Crear un video con Moderno en tu panel"/);
    expect(html).toContain("Ver todos");
    expect(html).not.toContain("Imaginá este espacio a tu estilo");
    expect(html).not.toMatch(/Ver en movimiento/);
  });

  it("downloads every ready version from the public images, with the true count, and shares the buyers' page", () => {
    expect(html).toMatch(/href="\/demo\/tok\/imagen\/p1\?e=modern&amp;r=1&amp;w=2048" download="departamento-de-prueba-foto-1-moderno\.jpg"/);
    expect(html).toContain("1 lista para publicar, gratis");
    expect(html).toContain("Compartir ficha");
    expect(html).toContain("Generar un estilo nuevo usa 1 de tus 3 créditos de regalo.");
  });

  it("asks for another listing before the invitation's sign-up, without sending it anywhere else", () => {
    expect(html).toContain("¿Querés probarlo con otra propiedad?");
    expect(html).toMatch(/<form[^>]*>[\s\S]*?id="dv2-another-url"[\s\S]*?Crear propiedad<\/button><\/form>/);
  });
});

describe("«Ver como comprador» from the agency's demo", () => {
  const html = renderToStaticMarkup(
    <DemoView demo={demo} source={{ kind: "public", token: "tok" }} presentation invite={{ href: INVITE, freeCredits: 3 }} backToDemo="/demo/tok/presentacion/codigo" />,
  );
  it("is the buyers' page: no tools, no sign-up, no banner; only the way back to the demo", () => {
    expect(html).toContain("Volver al modo demo");
    expect(html).toContain('href="/demo/tok/presentacion/codigo"');
    for (const tool of ["Probar esta propiedad en mi panel", "Guardar mi panel", "dv2-banner", "dv2-style-generate", "Editar foto", "créditos de regalo", "/panel/"]) expect(html).not.toContain(tool);
    expect(html).toContain("Departamento de prueba");
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
    expect(html).toMatch(/<a href="\/demo\/tok\/presentacion\/codigo\/precios" class="dv2-owner-prices is-on" aria-current="page"/);
    expect(html.indexOf('class="dv2-owner"')).toBeLessThan(html.indexOf("Planes de habita"));
  });

  it("shows the property, not the plans, on the presentation itself", () => {
    const html = render(owner.demoHref);
    expect(html).not.toContain("Planes de habita");
    expect(html).not.toMatch(/dv2-main" hidden/);
  });
});
