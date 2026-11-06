import { describe, expect, it } from "vitest";
import { creditPackages, recommendedPackage, safeReturnTo, validityLabel } from "@/lib/commerce/credit-packs";
import type { Product } from "@/lib/commerce/catalog";

const pack = (sku: string, photos: number, price: number, active = true): Product => ({
  sku,
  name: `${photos} créditos`,
  kind: "pack",
  photos,
  versions: 3,
  price_cents: price,
  active,
  valid_days: 365,
});

describe("credit packages", () => {
  it("lists the four packs on sale, smallest first, with unit price and volume discount", () => {
    const list = creditPackages([
      pack("pack-100", 100, 5990000),
      pack("pack-10", 10, 990000),
      pack("pack-50", 50, 3490000),
      pack("pack-25", 25, 1990000),
      pack("pack-500", 500, 1000000),
      { ...pack("basic-month", 6, 100000), kind: "month" },
    ]);
    expect(list.map((p) => [p.sku, p.unitCents, p.discount])).toEqual([
      ["pack-10", 99000, 0],
      ["pack-25", 79600, 0.2],
      ["pack-50", 69800, 0.29],
      ["pack-100", 59900, 0.39],
    ]);
  });
  it("leaves out inactive or unpriced packs", () => {
    expect(creditPackages([pack("pack-10", 10, 990000, false), { ...pack("pack-25", 25, 0) }])).toEqual([]);
  });
});

describe("the recommended pack", () => {
  const all = creditPackages([pack("pack-10", 10, 990000), pack("pack-25", 25, 1990000), pack("pack-50", 50, 3490000), pack("pack-100", 100, 5990000)]);
  it("is the 25-credit pack when it is on sale", () => {
    expect(recommendedPackage(all)?.sku).toBe("pack-25");
  });
  it("falls back to the second pack, or the only one, and to nothing without packs", () => {
    expect(recommendedPackage(all.filter((p) => p.sku !== "pack-25"))?.sku).toBe("pack-50");
    expect(recommendedPackage(all.slice(0, 1))?.sku).toBe("pack-10");
    expect(recommendedPackage([])).toBeUndefined();
  });
});

describe("how long bought credits last", () => {
  it("says it in months from the catalog's days, or in days when short", () => {
    expect(validityLabel(365)).toBe("12 meses");
    expect(validityLabel(180)).toBe("6 meses");
    expect(validityLabel(30)).toBe("30 días");
    expect(validityLabel(1)).toBe("1 día");
    expect(validityLabel(null)).toBeNull();
    expect(validityLabel(0)).toBeNull();
  });
});

describe("return after paying", () => {
  it("keeps our own working pages", () => {
    expect(safeReturnTo("/panel/propiedades/abc/editar?foto=1")).toBe("/panel/propiedades/abc/editar?foto=1");
    expect(safeReturnTo("/estudio")).toBe("/estudio");
  });
  it("refuses other sites and odd paths", () => {
    for (const bad of ["//evil.com", "https://evil.com", "/\\evil.com", "/admin", "/panel\\x", "javascript:alert(1)", 42, null])
      expect(safeReturnTo(bad)).toBeNull();
  });
});
