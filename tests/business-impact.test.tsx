import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ImpactStats, impactOf } from "@/components/business-impact";

describe("business impact", () => {
  it("computes the extra sale value and the agency's commission on it", () => {
    expect(impactOf(150000, 5, 3)).toEqual({ value: 7500, commission: 225 });
    expect(impactOf(200000, 10, 2.5)).toEqual({ value: 20000, commission: 500 });
  });

  it("links every figure to its source and says they are not habita.'s results", () => {
    const html = renderToStaticMarkup(<ImpactStats variant="hero" where="home" />);
    expect(html.match(/target="_blank" rel="noopener noreferrer"/g)).toHaveLength(3);
    expect(html).toContain("Promedio de propiedades con staging.");
    expect(html).toContain("No son resultados medidos de habita.");
    expect(html).toContain('data-cta="impact_source_precio"');
  });
});
