import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ImpactCalculator, ImpactStats, impactOf } from "@/components/business-impact";

describe("business impact", () => {
  it("computes the extra sale value and the agency's commission on it", () => {
    expect(impactOf(150000, 5, 3)).toEqual({ value: 7500, commission: 225 });
    expect(impactOf(200000, 10, 2.5)).toEqual({ value: 20000, commission: 500 });
  });

  it("grows the price improvement (10% of 0 to 20) by the volume improvement (20% of 0 to 100)", () => {
    expect(impactOf(150000, 10, 3, 20)).toEqual({ value: 18000, commission: 540 });
    const html = renderToStaticMarkup(<ImpactCalculator where="precios" unitCents={100} />);
    for (const text of ["+US$ 18.000", "Beneficio incremental", "+US$ 540", "Retorno sobre inversión"]) expect(html).toContain(text);
    expect(html).toMatch(/type="range" min="0" max="20" step="1" aria-valuetext="10%" value="10"/);
    expect(html).toMatch(/type="range" min="0" max="100" step="1" aria-valuetext="20%" value="20"/);
    const at = (t: string) => html.indexOf(t);
    expect(at("Precio promedio por propiedad")).toBeLessThan(at("Comisión inmobiliaria"));
    expect(at("Comisión inmobiliaria")).toBeLessThan(at("Mejora estimada en precio"));
    expect(at("Mejora estimada en precio")).toBeLessThan(at("Mejora estimada en volumen"));
  });

  it("links every figure to its source and says they are not habita.'s results", () => {
    const html = renderToStaticMarkup(<ImpactStats variant="hero" where="home" />);
    expect(html.match(/target="_blank" rel="noopener noreferrer"/g)).toHaveLength(3);
    expect(html).toContain("Promedio de propiedades con staging.");
    expect(html).toContain("No son resultados medidos de habita.");
    expect(html).toContain('data-cta="impact_source_precio"');
  });
});

describe("the /precios preview price", () => {
  it("is the lowest price per credit among the packs on sale", async () => {
    const { lowestUnitCents } = await import("@/lib/commerce/credit-packs");
    const pack = (sku: string, photos: number, cents: number, active = true) => ({ sku, kind: "pack", active, photos, price_cents: cents }) as never;
    expect(lowestUnitCents([pack("pack-10", 10, 990000), pack("pack-100", 100, 5990000)])).toBe(59900);
    expect(lowestUnitCents([pack("pack-100", 100, 5990000, false)])).toBeNull();
    expect(lowestUnitCents([])).toBeNull();
  });
});
