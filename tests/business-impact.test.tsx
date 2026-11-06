import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ImpactCalculator, ImpactStats, impactOf, volumeLift } from "@/components/business-impact";

describe("business impact", () => {
  it("computes the extra sale value and the agency's commission on it", () => {
    expect(impactOf(150000, 5, 3)).toEqual({ value: 7500, commission: 225 });
    expect(impactOf(200000, 10, 2.5)).toEqual({ value: 20000, commission: 500 });
  });

  it("multiplies more interested buyers by a better conversion, and the benefit by that lift", () => {
    expect(volumeLift(20, 10)).toBeCloseTo(32);
    expect(volumeLift(0, 0)).toBe(0);
    const r = impactOf(150000, 10, 3, 32);
    expect(r.value).toBeCloseTo(19800);
    expect(r.commission).toBeCloseTo(594);
    const html = renderToStaticMarkup(<ImpactCalculator where="precios" unitCents={100} />);
    for (const text of ["Más interesados", "Mejor conversión de los interesados", "Aumento en volumen de ventas", "+30%", "Beneficio incremental", "+US$ 19.492", "+US$ 585"]) expect(html).toContain(text);
    expect(html).not.toContain("Tu comisión extra");
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
