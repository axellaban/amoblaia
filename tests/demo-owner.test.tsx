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
  video: null,
};
const INVITE = "/panel/empezar?codigo=codigoSecretoDeVeinteMasCaracteres&demo=tok";
const VISIT = "/panel/visita?codigo=codigoSecretoDeVeinteMasCaracteres";


describe("the agency's own demo, under its panel header", () => {
  const owner = {
    href: INVITE,
    code: "TEST-CODIGO-0000000000000000000000000000", freeCredits: 3,
    buyerHref: "/demo/tok/presentacion/codigo/ficha",
    demoHref: "/demo/tok/presentacion/codigo",
    pricesHref: "/demo/tok/presentacion/codigo/precios",
    panelHref: VISIT,
  };
  const html = renderToStaticMarkup(<DemoView demo={demo} source={{ kind: "public", token: "tok" }} presentation owner={owner} />);
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));

  it("follows the mockup: HABITA bar with «Demo para inmobiliaria», straight to the photo and the styles, then the listing", () => {
    for (const text of ["HABITA", "Demo para inmobiliaria", "Precios", "Guardar mi panel", "Ver como comprador", "Departamento de prueba"])
      expect(html).toContain(text);
    // No pitch before the picture: the demo starts with the experience itself.
    for (const pitch of ["Así podría verse esta propiedad con Habita", "Mejorá tus fotos, probá distintos estilos"]) expect(html).not.toContain(pitch);
    expect(html).toContain('class="dv2-owner"');
    for (const old of ["Modo demostración", "dv2-owner-nav", "dv2-owner-strip", "dv2-banner"]) expect(html).not.toContain(old);
    // The pitch, the photo and the styles come first; the property's listing below.
    expect(html.indexOf('id="dv2-hero-title"')).toBeLessThan(html.indexOf("dv2-stage"));
    expect(html.indexOf("dv2-stage")).toBeLessThan(html.indexOf('id="dv2-estilos"'));
    expect(html.indexOf('id="dv2-estilos"')).toBeLessThan(html.indexOf('id="dv2-title"'));
    expect(html).toContain("Antes");
    expect(html).toContain("Después");
  });

  it("leads every saving action to the private invitation, and «Mi panel» to its visit (no account needed yet)", () => {
    const panel = hrefs.filter((h) => h.startsWith("/panel"));
    expect(panel.length).toBeGreaterThanOrEqual(1);
    // Generar and the photos still without a staging carry what was chosen (?accion=&foto=&estilo=) on the same invitation.
    expect(panel.every((h) => h === VISIT || h === INVITE || h.startsWith(`${INVITE}&accion=`))).toBe(true);
    expect(panel).toContain(VISIT);
    // The only other ways out are the buyers' view and the plans, both inside the agency's environment.
    expect(hrefs.filter((h) => !h.startsWith("/panel")).every((h) => h === owner.buyerHref || h === owner.pricesHref || h.startsWith("#") || h.startsWith("/demo/tok/imagen/"))).toBe(true);
    expect(hrefs).not.toContain("/precios");
  });

  it("has one «Estilos» section: prepared styles to choose (no pencil, no video), then «Generar» in the panel for the rest", () => {
    const cards = [...html.matchAll(/<li class="dv2-style-card[^"]*">[\s\S]*?<span class="dv2-style-name">([^<]+)<\/span>/g)].map((m) => m[1]);
    expect(cards[0]).toBe("Moderno");
    expect(cards).toHaveLength(4);
    expect((html.match(/class="dv2-style-card is-missing"/g) ?? []).length).toBe(3);
    expect((html.match(/class="dv2-style-generate"/g) ?? []).length).toBe(3);
    for (const tool of ['aria-label="Editar Moderno"', "Crear un video con", "dv2-style-tool"]) expect(html).not.toContain(tool);
    // «Generar» never generates from the demo: it is a link to the sign-up, with the photo and the style.
    expect(html).toMatch(/<a class="dv2-style-generate" aria-label="Generar Nórdico en tu panel" href="\/panel\/empezar\?codigo=[^"]+&amp;accion=generar&amp;foto=p1&amp;estilo=scandinavian"/);
    expect(html).toContain("Ver todos");
    expect(html).not.toContain("Imaginá este espacio a tu estilo");
    expect(html).not.toMatch(/Ver en movimiento/);
  });

  it("downloads every ready version from the public images, with the true count, and shares the buyers' page", () => {
    expect(html).toMatch(/href="\/demo\/tok\/imagen\/p1\?e=modern&amp;r=1&amp;w=2048" download="departamento-de-prueba-foto-1-moderno\.jpg"/);
    expect(html).toContain("1 lista para publicar, gratis");
    expect(html).toContain("Compartir ficha");
    expect(html).not.toContain("créditos de regalo.");
  });

  it("asks for another listing before the invitation's sign-up, without sending it anywhere else", () => {
    expect(html).toContain("¿Querés probarlo con otra propiedad?");
    expect(html).toMatch(/<form[^>]*>[\s\S]*?id="dv2-another-url"[\s\S]*?Crear propiedad<\/button><\/form>/);
  });
});

describe("«Ver como comprador» from the agency's demo", () => {
  const html = renderToStaticMarkup(
    <DemoView demo={demo} source={{ kind: "public", token: "tok" }} presentation invite={{ href: INVITE, panelHref: VISIT, freeCredits: 3 }} backToDemo="/demo/tok/presentacion/codigo" />,
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
    panelHref: VISIT,
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

describe("the property's video, where the agency placed it", () => {
  const owner = {
    href: INVITE,
    code: "TEST-CODIGO-0000000000000000000000000000",
    freeCredits: 3,
    buyerHref: "/demo/tok/presentacion/codigo/ficha",
    demoHref: "/demo/tok/presentacion/codigo",
    pricesHref: "/demo/tok/presentacion/codigo/precios",
    panelHref: VISIT,
  };
  const withVideo = (placement: "first" | "second" | "below") => ({ ...demo, video: { id: "vid1", format: "9:16" as const, durationMs: 20000, placement } });
  const entries = (html: string) => [...html.matchAll(/data-entry="\d+" aria-label="([^"]+)"/g)].map((m) => m[1]);

  it("goes first or second among the thumbnails, and the before/after still opens the demo", () => {
    pathname = owner.demoHref;
    const first = renderToStaticMarkup(<DemoView demo={withVideo("first")} source={{ kind: "public", token: "tok" }} presentation owner={owner} />);
    expect(entries(first)[0]).toBe("Ver el video");
    const second = renderToStaticMarkup(<DemoView demo={withVideo("second")} source={{ kind: "public", token: "tok" }} presentation owner={owner} />);
    expect(entries(second)[1]).toBe("Ver el video");
    for (const html of [first, second]) {
      expect(html).toContain('class="comparison');
      expect(html).not.toContain("<video");
      expect(html).not.toContain("Recorré la transformación");
    }
  });

  it("goes under the gallery as its own card, with «Ver video»", () => {
    const html = renderToStaticMarkup(<DemoView demo={withVideo("below")} source={{ kind: "public", token: "tok" }} presentation owner={owner} />);
    expect(entries(html)).not.toContain("Ver el video");
    expect(html).toContain("Recorré la transformación");
    expect(html).toContain("Ver video");
  });

  it("shows no player nor promise without a finished video", () => {
    const html = renderToStaticMarkup(<DemoView demo={demo} source={{ kind: "public", token: "tok" }} presentation owner={owner} />);
    for (const text of ["Ver el video", "Recorré la transformación", "<video"]) expect(html).not.toContain(text);
  });

  it("is on the buyers' page too, with its length", () => {
    const html = renderToStaticMarkup(<DemoView demo={withVideo("below")} source={{ kind: "public", token: "tok" }} />);
    expect(html).toContain("Ver video (0:20)");
  });
});

describe("a photo still without a staging, in the agency's demo", () => {
  const owner = {
    href: INVITE,
    code: "TEST-CODIGO-0000000000000000000000000000",
    freeCredits: 3,
    buyerHref: "/demo/tok/presentacion/codigo/ficha",
    demoHref: "/demo/tok/presentacion/codigo",
    pricesHref: "/demo/tok/presentacion/codigo/precios",
    panelHref: VISIT,
  };
  it("keeps its original free to see, dimmed in the strip with the way to stage it in the panel", () => {
    pathname = owner.demoHref;
    const html = renderToStaticMarkup(<DemoView demo={demo} source={{ kind: "public", token: "tok" }} presentation owner={owner} />);
    expect(html).toMatch(/aria-label="Ver foto 2 \(original, todavía sin ambientar\)"[^>]*class=" is-locked"/);
    expect(html).toContain("Creá tu panel y ambientá esta foto con IA");
  });
  it("is never offered to buyers", () => {
    const html = renderToStaticMarkup(<DemoView demo={demo} source={{ kind: "public", token: "tok" }} />);
    for (const text of ["is-locked", "Creá tu panel", "Generar", "Guardar mi panel", "Demo para inmobiliaria"]) expect(html).not.toContain(text);
  });
});

describe("the buyers' page", () => {
  const buyer: PublicDemo = {
    ...demo,
    prospect: false,
    banner: false,
    contact: { whatsapp: "+54 9 11 5555-5555", phone: null, email: "ventas@ejemplo.com", url: null },
  };
  const html = renderToStaticMarkup(<DemoView demo={buyer} source={{ kind: "public", token: "tok" }} />);
  it("leads with the agency's real channels: WhatsApp first, then the inquiry and the visit", () => {
    expect(html).toContain("Contactar por WhatsApp");
    expect(html).toContain("Enviar consulta");
    expect(html).toContain("Agendar visita");
    expect(html.indexOf("Contactar por WhatsApp")).toBeLessThan(html.indexOf("Enviar consulta"));
  });
  it("only shows the styles that exist, without tools of habita", () => {
    expect(html).toContain("Estilos");
    for (const text of ["dv2-style-generate", "is-missing", "créditos", "/panel/"]) expect(html).not.toContain(text);
    expect(html).toContain("Las ambientaciones con IA son ilustrativas");
  });
  it("offers no «Guardar» without favorites, and a real «Compartir»", () => {
    expect(html).toContain("Compartir");
    expect(html).not.toContain(">Guardar<");
  });
});

describe("buyers' «Estilos / Video» tabs on phones", () => {
  const withVideo = { ...demo, prospect: false, video: { id: "vid1", format: "9:16" as const, durationMs: 20000, placement: "first" as const } };
  it("appear only with a real video, next to the existing styles", () => {
    const html = renderToStaticMarkup(<DemoView demo={withVideo} source={{ kind: "public", token: "tok" }} />);
    expect(html).toContain('role="tablist" aria-label="Estilos y video"');
    expect(html).toContain('class="dv2-video-card is-tab-only"');
    const none = renderToStaticMarkup(<DemoView demo={{ ...demo, prospect: false }} source={{ kind: "public", token: "tok" }} />);
    expect(none).not.toContain('role="tablist"');
  });
});
