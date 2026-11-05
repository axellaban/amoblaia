// The preview's snapshot only asks again for real changes: a reviewed field
// (title, price, operation, location, description) or all the chosen photos
// gone. Photo order, changing queries, spacing, new or unchosen photos and
// photos no longer on the page never do; otherwise confirming an import
// answers «la publicación cambió» forever on sites that change on every visit.
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ adminClient: () => ({}) }));
import { legacySnapshotOf, photoKey, snapshotChanges, snapshotOf } from "@/lib/agency/imports";
import type { ImportedDemo } from "@/lib/demos/import";

const A = "https://www.site.com.ar/fotos/1.jpg?v=111";
const B = "https://www.site.com.ar/fotos/2.jpg?v=111";
const C = "https://www.site.com.ar/fotos/3.jpg?v=111";
const base = {
  title: "Venta de Casa 3 ambientes en Miramar",
  location: "Miramar",
  operation: "Venta",
  price: "USD 95.000",
  priceConflict: null,
  description: "Casa luminosa.\nCon patio.",
  images: [A, B, C],
  map: null,
  mapStatus: "none",
} as unknown as ImportedDemo;
const read = (patch: Partial<ImportedDemo>) => ({ ...base, ...patch }) as ImportedDemo;

describe("snapshotChanges", () => {
  it("the same listing read again is no change, whatever the photo order, queries or spacing", () => {
    const again = read({
      description: "Casa luminosa.  Con patio. ",
      images: ["https://site.com.ar/fotos/3.jpg?v=222", "https://site.com.ar/fotos/2.jpg?v=222", "https://WWW.site.com.ar/fotos/1.jpg?v=222#x"],
    });
    expect(snapshotOf(again)).toBe(snapshotOf(base));
    expect(snapshotChanges(snapshotOf(base), again, [A, B])).toEqual({ fields: [], chosenGone: false, chosenMissing: 0 });
  });

  it("names the reviewed fields that changed", () => {
    const c = snapshotChanges(snapshotOf(base), read({ price: "USD 90.000", description: "Otra" }), null);
    expect(c.fields).toEqual(["precio", "descripción"]);
  });

  it("new photos, unchosen photos and some chosen photos gone are not a change", () => {
    const sent = snapshotOf(base);
    // A new photo and an unchosen one (C) gone.
    expect(snapshotChanges(sent, read({ images: [A, B, "https://www.site.com.ar/fotos/9.jpg"] }), [A, B]).fields).toEqual([]);
    expect(snapshotChanges(sent, read({ images: [A, B, "https://www.site.com.ar/fotos/9.jpg"] }), [A, B]).chosenGone).toBe(false);
    // One of the chosen gone: imported without it, not asked again.
    const some = snapshotChanges(sent, read({ images: [A] }), [A, B]);
    expect(some).toEqual({ fields: [], chosenGone: false, chosenMissing: 1 });
  });

  it("every chosen photo gone is a change", () => {
    expect(snapshotChanges(snapshotOf(base), read({ images: [C] }), [A, B]).chosenGone).toBe(true);
  });

  it("a tab opened before still sends the single hash: compared as before", () => {
    expect(snapshotChanges(legacySnapshotOf(base), base, null).fields).toEqual([]);
    expect(snapshotChanges(legacySnapshotOf(base), read({ price: "USD 1" }), null).fields).toEqual(["la publicación"]);
  });

  it("no snapshot or an unreadable one is no change", () => {
    expect(snapshotChanges(undefined, base, null).fields).toEqual([]);
    expect(snapshotChanges("v2.%%%", base, null).fields).toEqual([]);
  });
});

describe("photoKey", () => {
  it("keeps host and path only", () => {
    expect(photoKey("https://www.Site.com/a/b.jpg?t=1#z")).toBe("site.com/a/b.jpg");
    expect(photoKey("not a url?x=1")).toBe("not a url");
  });
});
