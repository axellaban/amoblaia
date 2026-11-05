// A listing read twice must give the same snapshot when only what some sites
// change on every visit differs (photo order, cache-busting queries, spacing);
// otherwise confirming an import answers «la publicación cambió» forever.
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ adminClient: () => ({}) }));
import { photoKey, snapshotOf } from "@/lib/agency/imports";
import type { ImportedDemo } from "@/lib/demos/import";

const base = {
  title: "Venta de Casa 3 ambientes en Miramar",
  location: "Miramar",
  operation: "Venta",
  price: "USD 95.000",
  priceConflict: null,
  description: "Casa luminosa.\nCon patio.",
  images: ["https://www.site.com.ar/fotos/1.jpg?v=111", "https://www.site.com.ar/fotos/2.jpg?v=111"],
  map: null,
  mapStatus: "none",
} as unknown as ImportedDemo;

describe("snapshotOf", () => {
  it("ignores photo order, changing queries and spacing", () => {
    const again = {
      ...base,
      description: "Casa luminosa.  Con patio. ",
      images: ["https://site.com.ar/fotos/2.jpg?v=222", "https://WWW.site.com.ar/fotos/1.jpg?v=222#x"],
    } as ImportedDemo;
    expect(snapshotOf(again)).toBe(snapshotOf(base));
  });

  it("still changes when the listing really changed", () => {
    expect(snapshotOf({ ...base, price: "USD 90.000" } as ImportedDemo)).not.toBe(snapshotOf(base));
    expect(snapshotOf({ ...base, images: [base.images[0]] } as ImportedDemo)).not.toBe(snapshotOf(base));
  });
});

describe("photoKey", () => {
  it("keeps host and path only", () => {
    expect(photoKey("https://www.Site.com/a/b.jpg?t=1#z")).toBe("site.com/a/b.jpg");
    expect(photoKey("not a url?x=1")).toBe("not a url");
  });
});
