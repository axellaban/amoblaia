// The importer cases of 05/11/2026: the preview read the listing and offered
// «Importar con N fotos», but 0 photos came in (tests/fixtures/listings-nov5,
// the real pages, read without network).
//
// Causes, each covered here:
// - Paradiso (and Gordin, same .asp platform) serve WebP as "application/webp":
//   the download step only accepted "image/*" and called them «No es una foto».
// - Gordin's www host answers 406 to the server's request (any Accept): the
//   panel now says so per photo instead of only listing file names.
// - Daneff (Mardel Inmueble) only publishes a 400 px thumbnail in the HTML:
//   below the 600 px minimum. Its original (810 px) is the same file without "thumbnails/".
// - Bistolfi declares <base href="https://www.bistolfi.com.ar/">: its relative photo
//   paths were resolved against the listing's folder (404), and its gallery
//   is a list in an inline script, so only the og:image was found.
// - The other .asp variant (Gordin) has no portfolio-title: the title was the
//   site's <title> and the QR code and the header graphic were taken as photos.
import { readFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  adminClient: () => {
    throw new Error("not used");
  },
  currentUser: async () => null,
}));
import { imageError, importListing } from "../src/lib/demos/listing";
import { decodeHtml } from "../src/lib/listings/charset";
import { FetchFailure, safeFetch } from "../src/lib/listings/fetch";
import { checkPhoto } from "../src/lib/listings/photo-check";
import { baseOf, fullSizePhoto, isSiteGraphic, ownPhotos } from "../src/lib/listings/photos";
import { emptyAttempt, photosError } from "../src/lib/agency/imports";
import { snapshotChanges, snapshotOf } from "../src/lib/agency/imports";

const DIR = "tests/fixtures/listings-nov5";
const manifest = JSON.parse(readFileSync(`${DIR}/manifest.json`, "utf8")) as Record<string, { url: string; contentType: string }>;
const read = (name: string) => {
  const { text } = decodeHtml(readFileSync(`${DIR}/${name}.html`), manifest[name].contentType);
  return { html: text, imp: importListing(text, manifest[name].url, { strategy: "fixture" }) };
};
const GRAPHICS = /chart\.apis\.google|cht=qr|head-top|logo|img_th-|img_t-|\/thumbnails\//i;

describe("05/11 listings: what the preview reads", () => {
  it("Gordin (.asp, Swiper variant): the 14 photos of 7904, its title and place, no QR nor header graphic", () => {
    const { html, imp } = read("gordin-7904");
    // What the page had that was taken before.
    expect(html).toMatch(/<title>Venta de Propiedades - Inmobiliaria Gordin<\/title>/);
    expect(html).toMatch(/chart\.apis\.google\.com\/chart\?chs=250x250&cht=qr/);
    expect(html).toMatch(/images\/head-top\.png/);
    expect(imp.diagnostics?.platform).toBe("asp_ficha");
    expect(imp.title).toBe("Casa en Venta en Zona I, Miramar");
    expect(imp.location).toBe("Zona I, Miramar");
    expect(imp.operation).toBe("Venta");
    expect(imp.price).toBe("USD 92.000");
    expect(imp.images).toHaveLength(14);
    for (const src of imp.images) expect(src).toMatch(/^https:\/\/www\.inmobiliariagordin\.com\.ar\/fotos\/ventas\/7904_\d+\.webp$/);
    expect(imp.images.join(" ")).not.toMatch(GRAPHICS);
    // Other listings of the site linked on the page are not this one's photos.
    expect(imp.images.join(" ")).not.toMatch(/\/(3249|5894|6893|7726)_/);
  });

  it("Paradiso (.asp, mfp-gallery variant): 9 photos, the same file with and without www once, no QR", () => {
    const { html, imp } = read("paradiso-7557");
    expect(html).toMatch(/content="https:\/\/paradisobienesraices\.com\.ar\/fotos\/ventas\/7557_20260429182059597\.webp"/);
    expect(imp.title).toBe("Departamento en Venta en Zona IV, Miramar");
    expect(imp.location).toBe("Zona IV, Miramar");
    expect(imp.images).toHaveLength(9);
    for (const src of imp.images) expect(src).toMatch(/^https:\/\/www\.paradisobienesraices\.com\.ar\/fotos\/ventas\/7557_\d+\.webp$/);
    expect(imp.images.join(" ")).not.toMatch(GRAPHICS);
    // «Ventas Destacadas» further down are other listings.
    expect(imp.images.join(" ")).not.toMatch(/\/(7897|5742|7887|7503|8009)_/);
  });

  it("Bistolfi: <base href> resolves the photos at the site's root, and the gallery script gives all 11 at full size", () => {
    const { html, imp } = read("bistolfi-305");
    expect(html).toMatch(/<base href="https:\/\/www\.bistolfi\.com\.ar\/">/);
    expect(imp.images).toHaveLength(11);
    for (const src of imp.images) expect(src).toMatch(/^https:\/\/www\.bistolfi\.com\.ar\/img\/propiedades\/img-\d+\.jpg$/);
    expect(imp.images[0]).toBe("https://www.bistolfi.com.ar/img/propiedades/img-6685.jpg");
    expect(imp.images.join(" ")).not.toMatch(/\/ventas\/1-departamento\/.*\/img\//);
    expect(imp.images.join(" ")).not.toMatch(GRAPHICS);
    expect(imp.title).toBe("Dpto 2 Amb Céntrico con Gran Balcón");
    expect(imp.price).toBe("USD 49.500");
  });

  it("Daneff (Mardel Inmueble, drawn by JavaScript): the one photo in the HTML, at full size", () => {
    const { html, imp } = read("mardelinmueble-daneff");
    expect(html).toMatch(/<app-root><\/app-root>/);
    expect(imp.images).toEqual(["https://api.mardelinmueble.com/uploads/inmuebles/2026-10-21-10-18-37-996-56386.jpg"]);
    expect(imp.title).toBe("2 Ambientes externo reciclado");
  });

  it("a second read gives the same snapshot (confirming never answers «la publicación cambió»)", () => {
    for (const name of Object.keys(manifest).filter((k) => !k.startsWith("_"))) {
      const a = read(name).imp;
      const b = read(name).imp;
      expect(snapshotChanges(snapshotOf(a), b, a.images)).toEqual({ fields: [], chosenGone: false, chosenMissing: 0 });
    }
  });
});

describe("photo rules", () => {
  it("<base href> only when it is an http(s) address", () => {
    expect(baseOf('<base href="https://x.com/">', "https://x.com/a/b/")).toBe("https://x.com/");
    expect(baseOf('<base href="/raiz/">', "https://x.com/a/b/")).toBe("https://x.com/raiz/");
    expect(baseOf('<base href="javascript:alert(1)">', "https://x.com/a/")).toBe("https://x.com/a/");
    expect(baseOf("<p>sin base</p>", "https://x.com/a/")).toBe("https://x.com/a/");
  });

  it("QR codes and charts are site graphics", () => {
    expect(isSiteGraphic("https://chart.apis.google.com/chart?chs=250x250&cht=qr&chl=x")).toBe(true);
    expect(isSiteGraphic("https://api.qrserver.com/v1/create-qr-code/?data=x")).toBe(true);
    expect(isSiteGraphic("https://www.x.com/fotos/ventas/7904_1.webp")).toBe(false);
  });

  it("Mardel Inmueble thumbnails become the original; other hosts are left alone", () => {
    expect(fullSizePhoto("https://api.mardelinmueble.com/uploads/inmuebles/thumbnails/a.jpg")).toBe("https://api.mardelinmueble.com/uploads/inmuebles/a.jpg");
    expect(fullSizePhoto("https://otro.com/uploads/inmuebles/thumbnails/a.jpg")).toBe("https://otro.com/uploads/inmuebles/thumbnails/a.jpg");
  });

  it("the same file with and without www is one photo", () => {
    expect(ownPhotos(["https://www.a.com/f/1.jpg", "https://a.com/f/1.jpg", "https://a.com/f/2.jpg"], "https://www.a.com/p")).toEqual([
      "https://www.a.com/f/1.jpg",
      "https://a.com/f/2.jpg",
    ]);
  });
});

describe("the download step: what is a photo, and why one fails", () => {
  const webp = () => sharp({ create: { width: 800, height: 600, channels: 3, background: "#888" } }).webp().toBuffer();

  it("a WebP served as application/webp is a photo (Paradiso, Gordin without www)", async () => {
    await expect(checkPhoto(await webp(), "application/webp")).resolves.toMatchObject({ format: "webp", width: 800 });
    await expect(checkPhoto(await webp(), "")).resolves.toMatchObject({ format: "webp" });
  });

  it("says why it is not: a page instead of a photo, a thumbnail with its size", async () => {
    await expect(checkPhoto(Buffer.from("<html>error</html>"), "text/html")).rejects.toThrow("El sitio devolvió una página en lugar de la foto.");
    const small = await sharp({ create: { width: 400, height: 533, channels: 3, background: "#888" } }).jpeg().toBuffer();
    await expect(checkPhoto(small, "image/jpeg")).rejects.toThrow("La foto es demasiado chica (400×533 px; mínimo 600 px de lado).");
  });

  it("each download failure has its own message, with the site's answer", () => {
    expect(imageError("http_error", 406)[1]).toBe("El sitio rechazó la descarga desde nuestro servidor (error 406): subí la foto a mano.");
    expect(imageError("http_error", 404)[1]).toBe("La foto ya no está en el sitio (error 404).");
    expect(imageError("blocked", 403)[1]).toMatch(/no deja bajar la foto desde nuestro servidor \(error 403\)/);
    expect(imageError("timeout", null)[1]).toBe("El sitio tardó demasiado en enviar la foto.");
    expect(imageError("challenge", 403)[1]).toMatch(/anti-robots que no salteamos/);
  });

  describe("against a local server standing in for the sites", () => {
    let server: http.Server;
    let port = 0;
    let body: Buffer;
    beforeAll(async () => {
      body = await webp();
      server = http.createServer((req, res) => {
        if (req.url === "/fotos/ventas/7557_1.webp") res.writeHead(200, { "Content-Type": "application/webp" }).end(body);
        else if (req.url === "/fotos/ventas/7904_1.webp")
          res.writeHead(406, { "Content-Type": "text/html" }).end("<title>406: el explorador del cliente no acepta el tipo MIME</title>");
        else res.writeHead(404).end();
      });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      port = (server.address() as AddressInfo).port;
    });
    afterAll(() => new Promise<void>((r) => server.close(() => r())));
    const policy = { allowAddress: () => true, resolver: async () => [{ address: "127.0.0.1", family: 4 }], ports: ["", "80", "443", String(port)] };
    const at = (path: string) => `http://fotos.test:${port}${path}`;

    it("downloads and accepts the application/webp photo", async () => {
      const res = await safeFetch(at("/fotos/ventas/7557_1.webp"), "image", { policy: { ...policy, ports: ["", String(port)] } });
      expect(res.type).toBe("application/webp");
      await expect(checkPhoto(res.body, res.type)).resolves.toMatchObject({ format: "webp" });
    });

    it("a 406 is reported as the site refusing, never retried with another identity", async () => {
      const err = await safeFetch(at("/fotos/ventas/7904_1.webp"), "image", { policy: { ...policy, ports: ["", String(port)] } }).catch((e) => e);
      expect(err).toBeInstanceOf(FetchFailure);
      expect([err.code, err.status]).toEqual(["http_error", 406]);
      expect(imageError(err.code, err.status)[1]).toMatch(/rechazó la descarga.*406/);
    });
  });
});

describe("the import's record when photos fail", () => {
  it("keeps the causes, the most common first, within 300 characters", () => {
    const urls = ["https://a/1.webp", "https://a/2.webp", "https://a/3.webp"];
    const why = "El sitio rechazó la descarga desde nuestro servidor (error 406): subí la foto a mano.";
    expect(photosError(urls, { [urls[0]]: why, [urls[1]]: why, [urls[2]]: "La foto ya no está en el sitio (error 404)." })).toBe(
      `3 fotos no se pudieron descargar: ${why} (2) · La foto ya no está en el sitio (error 404). (1)`,
    );
    expect(photosError(urls.slice(0, 1), {})).toBe("1 foto no se pudo descargar.");
    expect(photosError([], {})).toBeNull();
    const many = Array.from({ length: 30 }, (_, i) => `https://a/${i}.webp`);
    expect(photosError(many, Object.fromEntries(many.map((u, i) => [u, `Causa distinta número ${i} con bastante texto`])))!.length).toBeLessThanOrEqual(300);
  });

  it("an attempt that brought no photo leaves a draft the next import completes (no duplicate)", () => {
    expect(emptyAttempt({ status: "failed", photos_done: null })).toBe(true);
    expect(emptyAttempt({ status: "partial", photos_done: 0 })).toBe(true);
    expect(emptyAttempt({ status: "partial", photos_done: 3 })).toBe(false);
    expect(emptyAttempt({ status: "completed", photos_done: 0 })).toBe(false);
  });
});
