// The website builder's model (Panel → Sitio web): every template is valid,
// anything that comes in is normalized to a safe site, and the site's search
// reads operation, type, rooms and price from the listing's texts.
import { describe, expect, it } from "vitest";
import { cleanImage, cleanLink, normalizeSite, PAGE_SLUG, SECTIONS, SECTION_TYPES, templateSite, TEMPLATES, videoEmbed, waNumber } from "@/lib/site/schema";
import { facetsOf, filterProperties, filtersFromQuery, NO_FILTERS, priceOf, queryOf } from "@/lib/site/listing";

const seed = { name: "Inmobiliaria Sur", primary: "#123456", whatsapp: "11 5555-1234" };
const prop = (over: Record<string, unknown>) => ({ token: "x".repeat(24), title: "Departamento", location: null, operation: null, price: null, features: null, cover: null, staged: false, ...over });

describe("site schema", () => {
  it("every template normalizes to itself", () => {
    for (const t of TEMPLATES) {
      const doc = templateSite(t.id, seed);
      expect(normalizeSite(JSON.parse(JSON.stringify(doc)), seed)).toEqual(doc);
      expect(doc.pages[0]!.slug).toBe("");
      expect(doc.pages.every((p) => p.slug === "" || PAGE_SLUG.test(p.slug))).toBe(true);
    }
  });
  it("uses the agency's color and WhatsApp", () => {
    const doc = templateSite("clasico", seed);
    expect(doc.theme.primary).toBe("#123456");
    expect(doc.settings.whatsapp).toBe("11 5555-1234");
    expect(doc.settings.whatsappButton).toBe(true);
  });
  it("every section's defaults survive normalization", () => {
    for (const type of SECTION_TYPES) {
      const doc = normalizeSite({ pages: [{ slug: "", title: "Inicio", sections: [{ id: "abcd1234", type, props: SECTIONS[type].defaults }] }] });
      expect(doc.pages[0]!.sections[0]!.type).toBe(type);
    }
  });
  it("drops unknown sections, bad colors, scripts and long text", () => {
    const doc = normalizeSite({
      theme: { primary: "red", headingFont: "comic" },
      settings: { ga4: "<script>", metaPixel: "12345678", instagram: "javascript:alert(1)" },
      pages: [
        {
          slug: "",
          title: "Inicio",
          sections: [
            { id: "1", type: "evil", props: {} },
            { id: "abcd1234", type: "text", props: { title: "x".repeat(500), buttonLink: "javascript:alert(1)", bg: "neon" } },
          ],
        },
      ],
    });
    expect(doc.theme.primary).toMatch(/^#[0-9a-f]{6}$/);
    expect(doc.theme.headingFont).not.toBe("comic");
    expect(doc.settings.ga4).toBe("");
    expect(doc.settings.metaPixel).toBe("12345678");
    expect(doc.settings.instagram).toBe("");
    const s = doc.pages[0]!.sections;
    expect(s).toHaveLength(1);
    expect(String(s[0]!.props.title)).toHaveLength(120);
    expect(s[0]!.props.buttonLink).toBe("");
    expect(s[0]!.props.bg).toBe("default");
  });
  it("gives every page a unique address that never looks like a property link", () => {
    const doc = normalizeSite({ pages: [{ slug: "nosotros", sections: [] }, { slug: "nosotros", sections: [] }, { slug: "Contacto Ya!", sections: [] }, { slug: "a".repeat(40), sections: [] }] });
    const slugs = doc.pages.map((p) => p.slug);
    expect(slugs[0]).toBe("");
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs.slice(1).every((x) => PAGE_SLUG.test(x) && x.length < 20)).toBe(true);
  });
  it("cleans links and images", () => {
    expect(cleanLink("/propiedades?op=venta")).toBe("/propiedades?op=venta");
    expect(cleanLink("#contacto")).toBe("#contacto");
    expect(cleanLink("wa:")).toBe("wa:");
    expect(cleanLink("inmobiliaria.com.ar")).toBe("https://inmobiliaria.com.ar");
    expect(cleanLink("//evil.com")).toBe("");
    expect(cleanLink("javascript:alert(1)")).toBe("");
    expect(cleanImage("/ejemplos/living-modern.webp")).toBe("/ejemplos/living-modern.webp");
    expect(cleanImage("http://insecure.com/a.jpg")).toBe("");
    expect(cleanImage("data:image/png;base64,AAA")).toBe("");
  });
  it("reads WhatsApp numbers and video links", () => {
    expect(waNumber("11 5555-1234")).toBe("5491155551234");
    expect(waNumber("+54 9 223 555-1234")).toBe("5492235551234");
    expect(waNumber("")).toBeNull();
    expect(videoEmbed("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(videoEmbed("https://vimeo.com/123456789")).toBe("https://player.vimeo.com/video/123456789");
    expect(videoEmbed("https://example.com")).toBeNull();
  });
});

describe("site search", () => {
  it("reads prices", () => {
    expect(priceOf("USD 120.000")).toEqual({ currency: "USD", amount: 120000 });
    expect(priceOf("U$S 95,000")).toEqual({ currency: "USD", amount: 95000 });
    expect(priceOf("$ 450.000")).toEqual({ currency: "ARS", amount: 450000 });
    expect(priceOf("Consultar")).toEqual({ currency: null, amount: null });
  });
  it("reads operation, type and rooms", () => {
    const f = facetsOf(prop({ title: "Casa 3 dormitorios en Bella Vista", operation: "Venta" }));
    expect(f).toMatchObject({ operation: "venta", kind: "casa", rooms: 4 });
    expect(facetsOf(prop({ title: "Monoambiente luminoso", operation: "Alquiler temporario" }))).toMatchObject({ operation: "temporario", kind: "departamento", rooms: 1 });
    expect(facetsOf(prop({ title: "PH 3 ambientes", operation: "Alquiler" }))).toMatchObject({ operation: "alquiler", kind: "ph", rooms: 3 });
  });
  it("filters and sorts", () => {
    const list = [
      prop({ token: "a".repeat(24), title: "Depto 2 ambientes Palermo", operation: "Venta", price: "USD 150.000" }),
      prop({ token: "b".repeat(24), title: "Casa 4 ambientes Pilar", operation: "Venta", price: "USD 90.000" }),
      prop({ token: "c".repeat(24), title: "Depto 3 ambientes Belgrano", operation: "Alquiler", price: "$ 600.000" }),
    ];
    expect(filterProperties(list, { ...NO_FILTERS, op: "venta", sort: "price-asc" }).map((p) => p.token[0])).toEqual(["b", "a"]);
    expect(filterProperties(list, { ...NO_FILTERS, q: "palermo" })).toHaveLength(1);
    expect(filterProperties(list, { ...NO_FILTERS, kind: "departamento", rooms: 3 }).map((p) => p.token[0])).toEqual(["c"]);
    expect(filterProperties(list, { ...NO_FILTERS, currency: "USD", max: 100000 }).map((p) => p.token[0])).toEqual(["b"]);
  });
  it("round-trips filters through the address", () => {
    const q = queryOf({ q: "palermo", op: "venta", kind: "casa", rooms: 2 });
    expect(filtersFromQuery(new URLSearchParams(q))).toMatchObject({ q: "palermo", op: "venta", kind: "casa", rooms: 2 });
  });
});
