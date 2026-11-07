// The importer cases of 07/11/2026 (tests/fixtures/listings-nov7, the real
// pages, read without network):
// - Argenprop answered our servers with AWS WAF's challenge, status 202 and
//   only "JavaScript is disabled" as text: it was read as the listing (title
//   «JavaScript is disabled», 0 photos) instead of being reported.
// - Zonaprop answers with Cloudflare's challenge (403, cf-mitigated): the
//   message suggested «el enlace de la misma propiedad en Zonaprop o
//   Argenprop», the same portal that had just refused, and the other one,
//   which refuses too.
// - When Argenprop does answer, it had no template: 1 photo (the gallery is
//   loaded apart), the feature list as description, the "similares" as
//   amenities and the coordinates with decimal comma lost.
import { readFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  adminClient: () => {
    throw new Error("not used");
  },
  currentUser: async () => null,
}));
const fetchMock = vi.hoisted(() => ({ impl: null as null | ((url: string) => Promise<unknown>) }));
vi.mock("@/lib/listings/fetch", async (orig) => {
  const real = await orig<typeof import("../src/lib/listings/fetch")>();
  return { ...real, safeFetch: (url: string, kind: "page" | "image", o?: never) => (fetchMock.impl ? fetchMock.impl(url) : real.safeFetch(url, kind, o)) };
});
import { importListing, readListing } from "../src/lib/demos/listing";
import { decodeHtml } from "../src/lib/listings/charset";
import { FetchFailure, looksLikeChallenge, safeFetch } from "../src/lib/listings/fetch";
import { ARGENPROP_GALLERY_MARK, argenpropGalleryUrl } from "../src/lib/listings/platforms";

const DIR = "tests/fixtures/listings-nov7";
const file = (name: string) => readFileSync(`${DIR}/${name}.html`, "utf8");
const AP_URL = "https://www.argenprop.com/departamento-en-venta-en-palermo-2-ambientes--20179647";
const ZP_URL = "https://www.zonaprop.com.ar/propiedades/clasificado/veclapin-departamento-en-venta-2-ambientes-full-amenities-60302623.html";
const page = (html: string) => async (url: string) => ({ url, status: 200, type: "text/html; charset=utf-8", body: Buffer.from(html), redirects: 0, durationMs: 5 });

describe("bot checks are never read as the listing", () => {
  it("AWS WAF's page (Argenprop to our servers) is a challenge, with or without its header, even with a 2xx", () => {
    const waf = file("aws-waf-challenge");
    expect(looksLikeChallenge(202, { "x-amzn-waf-action": "challenge" }, waf)).toBe(true);
    expect(looksLikeChallenge(202, {}, waf)).toBe(true);
    expect(looksLikeChallenge(200, {}, waf)).toBe(true);
    expect(looksLikeChallenge(405, { "x-amzn-waf-action": "captcha" }, "")).toBe(true);
  });

  it("the real Argenprop ficha loads AWS WAF's script too, and is not a challenge", () => {
    const real = file("argenprop-20179647");
    expect(real).toMatch(/awswaf\.com\/[^"]+\/challenge\.js/);
    expect(looksLikeChallenge(200, {}, real)).toBe(false);
  });

  it("Zonaprop's Cloudflare page is a challenge", () => {
    expect(looksLikeChallenge(403, { "cf-mitigated": "challenge" }, file("zonaprop-60302623-challenge"))).toBe(true);
    expect(looksLikeChallenge(403, {}, file("zonaprop-60302623-challenge"))).toBe(true);
  });

  describe("safeFetch", () => {
    let server: http.Server;
    let port = 0;
    beforeAll(async () => {
      server = http.createServer((req, res) => {
        if (req.url === "/waf") res.writeHead(202, { "Content-Type": "text/html", "x-amzn-waf-action": "challenge" }).end(file("aws-waf-challenge"));
        else res.writeHead(200, { "Content-Type": "text/html" }).end(file("argenprop-20179647"));
      });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
      port = (server.address() as AddressInfo).port;
    });
    afterAll(() => server.close());
    const policy = () => ({ allowAddress: () => true, resolver: async () => [{ address: "127.0.0.1", family: 4 }], ports: ["", String(port)] });

    it("a 202 challenge is a failure («challenge»), not a page", async () => {
      fetchMock.impl = null;
      const err = await safeFetch(`http://portal.test:${port}/waf`, "page", { policy: policy() }).catch((e) => e);
      expect(err).toBeInstanceOf(FetchFailure);
      expect([err.code, err.status]).toEqual(["challenge", 202]);
      const ok = await safeFetch(`http://portal.test:${port}/ficha`, "page", { policy: policy() });
      expect(ok.status).toBe(200);
    });
  });
});

describe("what the visitor reads when a site refuses us", () => {
  const refuse = (code: "challenge" | "blocked", status: number) => async () => {
    throw new FetchFailure(code, status);
  };

  it("Zonaprop: names it and never offers Zonaprop or Argenprop as the way out", async () => {
    fetchMock.impl = refuse("challenge", 403);
    const err = await readListing(ZP_URL).catch((e) => e);
    expect(err.message).toMatch(/^Zonaprop pide una verificación anti-robots/);
    expect(err.message).toMatch(/sitio de la inmobiliaria que la publica o cargá las fotos a mano/);
    expect(err.message).not.toMatch(/Argenprop|en Zonaprop/);
  });

  it("Argenprop (AWS WAF): names it and never offers the portals", async () => {
    fetchMock.impl = refuse("challenge", 202);
    const err = await readListing(AP_URL).catch((e) => e);
    expect(err.message).toMatch(/^Argenprop pide una verificación anti-robots/);
    expect(err.message).not.toMatch(/Zonaprop|en Argenprop/);
    fetchMock.impl = refuse("blocked", 403);
    expect((await readListing(AP_URL).catch((e) => e)).message).toMatch(/^Argenprop no deja leer la publicación/);
  });

  it("an agency's own site: no portal is offered (both refuse our servers)", async () => {
    for (const [code, status] of [["challenge", 403], ["blocked", 403]] as const) {
      fetchMock.impl = refuse(code, status);
      const err = await readListing("https://inmo.com.ar/ficha/1").catch((e) => e);
      expect(err.message).not.toMatch(/Zonaprop|Argenprop/);
      expect(err.message).toMatch(/cargá las fotos a mano/);
    }
  });
});

describe("Argenprop's ficha", () => {
  const html = decodeHtml(readFileSync(`${DIR}/argenprop-20179647.html`), "text/html; charset=utf-8").text;
  const gallery = file("argenprop-20179647-gallery");
  const FOLDER = /^https:\/\/www\.argenprop\.com\/static-content\/74697102\/[0-9a-f-]{36}_u_large\.jpg$/;

  it("finds the gallery's address, only on Argenprop's own host", () => {
    expect(argenpropGalleryUrl(html, AP_URL)).toBe("https://www.argenprop.com/aviso/gallerypartial?idAviso=20179647");
    expect(argenpropGalleryUrl(html.replace("/aviso/gallerypartial", "https://evil.example/aviso/gallerypartial"), AP_URL)).toBeNull();
  });

  it("with the gallery: the 20 photos (1920 px), title, place, price, expenses, description and advertiser", () => {
    const imp = importListing(`${html}\n${ARGENPROP_GALLERY_MARK}\n${gallery}`, AP_URL, { strategy: "fixture" });
    expect(imp.diagnostics?.platform).toBe("argenprop");
    expect(imp.images).toHaveLength(20);
    for (const src of imp.images) expect(src).toMatch(FOLDER);
    expect(imp.images[0]).toContain("a9294100-bc3b-4f04-aa94-0a05c85c201c");
    expect(imp.title).toBe("Departamento en venta i torre astor palermo");
    expect(imp.location).toBe("Beruti 3300, Palermo, CABA");
    expect(imp.operation).toBe("Venta");
    expect(imp.price).toBe("USD 300.000");
    expect(imp.expenses).toBe("$ 200.000");
    expect(imp.description).toMatch(/^Presentamos a la venta un espléndido departamento de 2 ambientes en la prestigiosa Torre Astor/);
    expect(imp.description).not.toMatch(/garantía de alquiler/);
    expect(imp.agency.name).toBe("Fauro Propiedades");
    // The "similares" are other listings: neither their features nor their photos.
    expect(JSON.stringify(imp.amenities)).not.toMatch(/Cerviño|Niceto Vega|Bonpland/);
    expect(imp.images.join(" ")).not.toMatch(/48998411|78669411|57054511|3629774|540342_a/);
    // The pin is in data-latitude="-34,5867" data-longitude="-58,40968".
    expect(imp.map).toMatchObject({ lat: -34.5867, lng: -58.40968 });
  });

  it("without the gallery: the header's 5 photos, enlarged", () => {
    const imp = importListing(html, AP_URL, { strategy: "fixture" });
    expect(imp.images).toHaveLength(5);
    for (const src of imp.images) expect(src).toMatch(FOLDER);
  });

  it("readListing asks for the gallery too and keeps going if it fails", async () => {
    const asked: string[] = [];
    fetchMock.impl = async (url: string) => {
      asked.push(url);
      return page(url.includes("gallerypartial") ? gallery : html)(url);
    };
    const r = await readListing(AP_URL);
    expect(asked).toEqual([AP_URL, "https://www.argenprop.com/aviso/gallerypartial?idAviso=20179647"]);
    expect(r.imported.images).toHaveLength(20);
    fetchMock.impl = async (url: string) => {
      if (url.includes("gallerypartial")) throw new FetchFailure("timeout");
      return page(html)(url);
    };
    expect((await readListing(AP_URL)).imported.images).toHaveLength(5);
  });

  it("the AWS WAF page as a 2xx answer never becomes a listing", async () => {
    fetchMock.impl = async () => {
      throw new FetchFailure("challenge", 202);
    };
    await expect(readListing(AP_URL)).rejects.toThrow(/Argenprop pide una verificación anti-robots/);
  });
});
