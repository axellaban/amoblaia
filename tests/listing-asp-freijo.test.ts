// A classic ASP listing site (ver-propiedad-venta.asp?…&codigo=N) read twice:
// the related listings, "Visto N veces", the form's security code and
// Cloudflare's tokens change on every visit (tests/fixtures/listings-asp).
// Both reads must give the property's own 13 photos, its data and the same
// snapshot, so confirming the import never answers «la publicación cambió».
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  adminClient: () => {
    throw new Error("not used");
  },
  currentUser: async () => null,
}));
import { importListing, parseListing } from "../src/lib/demos/listing";
import { snapshotChanges, snapshotOf } from "../src/lib/agency/imports";
import { isMapImage, keepOwnCode, listingCodes, withoutOtherBlocks } from "../src/lib/listings/photos";

const URL_7674 = "https://freijopropiedades.com.ar/ver-propiedad-venta.asp?id=Venta-de-Casa-3-ambientes-en-Miramar&codigo=7674";
const html = (n: 1 | 2) => readFileSync(`tests/fixtures/listings-asp/freijo-${n}.html`, "utf8");
const first = importListing(html(1), URL_7674, { strategy: "fixture" });
const second = importListing(html(2), URL_7674, { strategy: "fixture" });

describe("Freijo (.asp): two reads of the same listing", () => {
  it("the two pages really differ where the site changes on every visit", () => {
    expect(html(1)).toMatch(/Visto 579 veces/);
    expect(html(2)).toMatch(/Visto 580 veces/);
    expect(html(1)).toMatch(/fotos\/ventas\/5642_/);
    expect(html(2)).not.toMatch(/fotos\/ventas\/5642_/);
    expect(html(1)).toMatch(/<h2 class="mb-none">Casa en Venta en La Baliza, Miramar\. u\$s 65000<\/h2>/);
  });

  for (const [name, imp] of [["first", first], ["second", second]] as const)
    it(`${name} read: own photos and the published data`, () => {
      expect(imp.diagnostics?.platform).toBe("asp_ficha");
      expect(imp.images).toHaveLength(13);
      for (const src of imp.images) expect(src).toMatch(/^https:\/\/freijopropiedades\.com\.ar\/fotos\/ventas\/7674_\d+\.webp$/);
      expect(imp.images.join(" ")).not.toMatch(/openstreetmap|%7B|\{|logo/i);
      // "u$s 65000" on the page.
      expect(imp.price).toBe("USD 65.000");
      expect(imp.diagnostics?.priceStatus).toBe("published");
      expect(imp.operation).toBe("Venta");
      expect(imp.location).toBe("La Baliza, Miramar");
      expect(imp.title).toBe("Casa en Venta en La Baliza, Miramar");
      expect(imp.description).toMatch(/^Luminosa casa ubicada en B° La Baliza/);
      expect(imp.description).not.toMatch(/Visto|Notas Adicionales|Codigo de Seguridad/);
      expect(imp.facts.map((f) => `${f.value} ${f.label}`)).toEqual(expect.arrayContaining(["170 m2 totales", "80 m2 cubiertos", "3 ambientes", "2 dormitorios", "1 baño"]));
      expect(imp.map?.lat).toBeCloseTo(-38.28237, 4);
      expect(imp.diagnostics?.missing).toEqual([]);
    });

  it("gives the same snapshot both times: no «la publicación cambió»", () => {
    expect(snapshotOf(second)).toBe(snapshotOf(first));
    expect(snapshotChanges(snapshotOf(first), second, first.images)).toEqual({ fields: [], chosenGone: false, chosenMissing: 0 });
  });

  it("the generic reading alone also leaves out related listings and the map tile", () => {
    const { images } = parseListing(html(1), URL_7674);
    expect(images).toHaveLength(13);
    expect(images.every((u) => /\/7674_/.test(u))).toBe(true);
  });

  it("«Consultar» instead of an amount is a price on request, not an error", () => {
    const ask = importListing(html(1).replace("Miramar. u$s 65000</h2>", "Miramar. Consultar</h2>"), URL_7674, { strategy: "fixture" });
    expect(ask.price).toBeNull();
    expect(ask.diagnostics?.priceStatus).toBe("on_request");
    expect(ask.diagnostics?.missing).not.toContain("precio");
    const row = ask.report.find((r) => r.field === "Precio");
    expect(row?.status).toBe("found");
    expect(row?.value).toBe("Consultar precio");
  });
});

describe("photo rules", () => {
  it("map templates and tiles are never photos", () => {
    expect(isMapImage("https://{s}.tile.openstreetmap.se/hydda/full/%7Bz%7D/%7Bx%7D/%7By%7D.png")).toBe(true);
    expect(isMapImage("https://a.tile.openstreetmap.org/16/22000/40000.png")).toBe(true);
    expect(isMapImage("https://api.mapbox.com/styles/v1/x/y/static/-57.5,-38,14/600x400.png")).toBe(true);
    expect(isMapImage("https://maps.googleapis.com/maps/api/staticmap?center=-38,-57&size=600x300")).toBe(true);
    expect(isMapImage("https://freijopropiedades.com.ar/fotos/ventas/7674_1.webp")).toBe(false);
    expect(isMapImage("https://static.tokkobroker.com/pictures/8634397_1.jpg")).toBe(false);
  });

  it("photos named after another code are left out only when most are named after this one", () => {
    expect(listingCodes(URL_7674)).toContain("7674");
    const own = ["a", "b", "c"].map((x) => `https://s.com/fotos/7674_${x}.jpg`);
    const other = "https://s.com/fotos/5642_z.jpg";
    const plain = "https://s.com/fotos/frente.jpg";
    expect(keepOwnCode([...own, other, plain], URL_7674)).toEqual([...own, plain]);
    // Not named by code (UUIDs, WordPress uploads): nothing is decided.
    const uuids = ["https://s.com/u/64d3b4ae_wm.jpeg", "https://s.com/u/c2ab8ea9_wm.jpeg", other];
    expect(keepOwnCode(uuids, URL_7674)).toEqual(uuids);
    // A folder per listing (/gallery_full/920/…).
    const folder = ["1", "2", "3"].map((x) => `https://s.com/gallery_full/920/${x}.jpg`);
    expect(keepOwnCode([...folder, "https://s.com/gallery_full/921/9.jpg"], "https://s.com/ventas/propiedad/920/")).toEqual(folder);
  });

  it("blocks of other listings are removed by class or id, but a «featured» badge on the property is not", () => {
    const page = `<div class="gallery"><span class="label-featured label">Destacada</span><img src="a.jpg"></div>
      <div id="similar-listings-wrap"><div class="similar-property-wrap"><img src="b.jpg"></div></div><p>fin</p>`;
    const out = withoutOtherBlocks(page);
    expect(out).toMatch(/label-featured/);
    expect(out).toMatch(/a\.jpg/);
    expect(out).not.toMatch(/b\.jpg/);
    expect(out).toMatch(/fin/);
  });
});
