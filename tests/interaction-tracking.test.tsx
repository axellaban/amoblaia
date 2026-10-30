import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const captured: { name: string; props: Record<string, unknown>; options?: unknown }[] = [];
vi.mock("posthog-js", () => ({
  default: {
    __loaded: true,
    capture: (name: string, props: Record<string, unknown>, options?: unknown) => captured.push({ name, props, options }),
    register: () => {},
    register_once: () => {},
    setPersonProperties: () => {},
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }), usePathname: () => "/demo/tok/presentacion/secreto" }));

import { cta, ctaProperties, SliderGesture, surfaceOf } from "@/lib/interaction-tracking";
import { trackMilestone } from "@/lib/analytics";
import { DemoView } from "@/components/demo-view";
import type { PublicDemo } from "@/lib/demos/shared";

const store: Record<string, string> = {};
beforeEach(() => {
  captured.length = 0;
  for (const k of Object.keys(store)) delete store[k];
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => void (store[k] = v),
    removeItem: (k: string) => void delete store[k],
  });
});

describe("the comparison slider", () => {
  it("summarizes a whole drag in one set of properties", () => {
    const g = new SliderGesture("touch", 50, 1000);
    for (const p of [55, 70, 90, 40, 62.4]) g.move(p);
    expect(g.end(4000)).toEqual({
      input: "touch",
      start_position: 50,
      end_position: 62,
      min_position: 40,
      max_position: 90,
      travel: 112,
      duration_ms: 3000,
    });
  });

  it("ignores a pointer that never moved the line (a vertical swipe the browser kept for scrolling)", () => {
    expect(new SliderGesture("touch", 50).end()).toBeNull();
  });

  it("reports keys even when the line was already at the end", () => {
    expect(new SliderGesture("keyboard", 100, 0).end(10)).toMatchObject({ input: "keyboard", start_position: 100, end_position: 100, travel: 0 });
  });
});

describe("calls to action", () => {
  it("are told apart by data attributes, never by their text", () => {
    const el = { dataset: {} as Record<string, string> };
    for (const [k, v] of Object.entries(cta("owner_crear", "owner_bar", "signup_invitation", "habita_b2b", { intent: "create_property", photo: "p1" })))
      el.dataset[k.replace(/^data-/, "").replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = v;
    expect(ctaProperties(el as unknown as HTMLElement, "/demo/tok")).toEqual({
      cta_id: "owner_crear",
      cta_location: "owner_bar",
      cta_destination: "signup_invitation",
      cta_kind: "habita_b2b",
      cta_intent: "create_property",
      photo_id: "p1",
      surface: "demo",
    });
  });

  it("name the area of the product they are in", () => {
    expect(["/demo/x", "/inmobiliaria/a/b", "/inmobiliaria/a", "/panel/empezar", "/panel/creditos", "/precios", "/acceso", "/"].map(surfaceOf)).toEqual([
      "demo",
      "agency_site_property",
      "agency_site",
      "signup",
      "panel",
      "pricing",
      "auth",
      "other",
    ]);
  });
});

describe("activation milestones", () => {
  it("count once per browser and keep the first date on the person", () => {
    trackMilestone("first_import_started", { mode: "single" });
    trackMilestone("first_import_started", { mode: "batch" });
    expect(captured).toHaveLength(1);
    expect(captured[0].name).toBe("first_import_started");
    expect(captured[0].props).toMatchObject({ mode: "single", $set_once: { first_import_started_at: expect.any(String) } });
  });
});

const v = (style: string) => ({ style, v: "1" });
const demo: PublicDemo = {
  id: "d1",
  agencyId: "ag1",
  agencyName: "Inmobiliaria de prueba",
  agency: { name: "Inmobiliaria de prueba", website: "https://ejemplo.com", logo: null, primary: "#1f3a5f", accent: "#6f8f5a", titleFont: "sans", contact: null, visitUrl: null },
  title: "Departamento de prueba",
  location: "Centro",
  description: null,
  listingUrl: "https://portal.example/aviso",
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
  contact: { whatsapp: "+54 9 11 5555-5555", phone: null, email: null, url: null },
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
const ids = (html: string) => [...html.matchAll(/data-cta="([^"]+)"/g)].map((m) => m[1]);

describe("the demo's tracked actions", () => {
  it("gives every button of the agency's bar its own id, all leading to the invitation", () => {
    const owner = {
      code: "TEST-CODIGO-0000000000000000000000000000",
      href: "/panel/empezar?codigo=secreto&demo=tok",
      freeCredits: 3,
      buyerHref: "/demo/tok/presentacion/secreto/ficha",
      demoHref: "/demo/tok/presentacion/secreto",
      pricesHref: "/demo/tok/presentacion/secreto/precios",
    };
    const html = renderToStaticMarkup(<DemoView demo={demo} source={{ kind: "public", token: "tok" }} presentation owner={owner} />);
    expect(ids(html)).toEqual(
      expect.arrayContaining([
        "owner_inicio",
        "owner_imagenes",
        "owner_crear",
        "owner_crear_movil",
        "owner_guardar",
        "owner_credits",
        "owner_generate_menu",
        "owner_pricing",
        "owner_nav_pricing",
        "owner_buyer_view",
        "owner_download",
        "owner_generate",
      ]),
    );
    // The invitation code never goes into the tracked attributes.
    for (const m of html.matchAll(/data-cta[a-z-]*="([^"]+)"/g)) expect(m[1]).not.toContain("secreto");
  });

  it("tells the buyer's contacts from habita's own calls to action", () => {
    const html = renderToStaticMarkup(<DemoView demo={demo} source={{ kind: "public", token: "tok" }} presentation />);
    expect(ids(html)).toEqual(expect.arrayContaining(["contact_whatsapp", "contact_listing", "banner_by_habita", "create_agency", "agency_website", "nav_contact"]));
    expect(html).toMatch(/data-cta="create_agency" data-cta-location="habita_section" data-cta-destination="agency_signup" data-cta-kind="habita_b2b"/);
    expect(html).toMatch(/data-cta="contact_whatsapp" data-cta-location="header" data-cta-destination="whatsapp" data-cta-kind="buyer_contact"/);
  });

  it("tracks nothing while rendering: events come only from what the visitor does", () => {
    renderToStaticMarkup(<DemoView demo={demo} source={{ kind: "public", token: "tok" }} presentation />);
    expect(captured).toHaveLength(0);
  });
});
