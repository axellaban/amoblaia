import { describe, expect, it } from "vitest";
import { cleanClasses, pickForDemo, prepSteps, type PhotoClass } from "../src/lib/demos/auto-prep-logic";
import { listingLinks, listingScore } from "../src/lib/listings/discover";

// «Preparar demo completa» y las precargas automáticas: lógica pura. Datos sintéticos.
const c = (photoId: string, room: string, score: number, furnished = false): PhotoClass => ({ photoId, room, score, furnished });

describe("qué fotos se ambientan", () => {
  it("elige el mejor living, comedor y dormitorio, y la mejor de portada", () => {
    const { picks, cover } = pickForDemo([
      c("fachada", "exterior", 9),
      c("living-a", "living", 6),
      c("living-b", "living", 8, true),
      c("comedor", "dining", 7),
      c("dorm", "bedroom", 5),
      c("bano", "bathroom", 10),
    ]);
    expect(picks.map((p) => [p.photoId, p.room, p.mode])).toEqual([
      ["living-b", "living", "redesign"],
      ["comedor", "dining", "furnish"],
      ["dorm", "bedroom", "furnish"],
    ]);
    expect(cover).toBe("living-b");
  });

  it("un living comedor sirve para los dos; si falta un ambiente completa con otro de los que se ambientan", () => {
    const { picks } = pickForDemo([c("lc", "living_dining", 9), c("lc2", "living_dining", 7), c("d1", "bedroom", 6), c("d2", "bedroom", 5), c("cocina", "kitchen", 9)]);
    expect(picks.map((p) => [p.photoId, p.room])).toEqual([
      ["lc", "living"],
      ["lc2", "dining"],
      ["d1", "bedroom"],
    ]);
    const short = pickForDemo([c("d1", "bedroom", 6), c("d2", "bedroom", 8), c("plano", "plan", 10)]);
    expect(short.picks.map((p) => p.photoId)).toEqual(["d2", "d1"]);
    expect(short.cover).toBe("d2");
  });

  it("sin living, comedor ni dormitorio no elige nada", () => {
    expect(pickForDemo([c("b", "bathroom", 9), c("f", "exterior", 9)])).toEqual({ picks: [], cover: null });
  });

  it("la respuesta del clasificador se valida: lo desconocido queda como «other» con 0", () => {
    const out = cleanClasses({ photos: [{ index: 1, room: "bedroom", furnished: true, score: 14 }, { index: 0, room: "pileta", score: "alto" }] }, ["a", "b", "c"]);
    expect(out).toEqual([
      { photoId: "a", room: "other", furnished: false, score: 0 },
      { photoId: "b", room: "bedroom", furnished: true, score: 10 },
      { photoId: "c", room: "other", furnished: false, score: 0 },
    ]);
    expect(cleanClasses(null, ["a"])).toEqual([{ photoId: "a", room: "other", furnished: false, score: 0 }]);
  });
});

describe("el avance de «Crear demo»", () => {
  it("fotos importadas → versiones generadas → publicada → precargas, en ese orden", () => {
    const empty = prepSteps({ photos: 0, photosTotal: 8, stagedPhotos: 0, versions: 0, published: false, preloads: 0 });
    expect(empty.map((s) => [s.key, s.ok, s.note])).toEqual([
      ["fotos", false, "0 de 8 fotos"],
      ["versiones", false, "0 versiones en 0 fotos"],
      ["publicada", false, "Sin publicar"],
      ["precargas", false, "0 de 2"],
    ]);
    const done = prepSteps({ photos: 8, photosTotal: 8, stagedPhotos: 3, versions: 6, published: true, preloads: 2 });
    expect(done.every((s) => s.ok)).toBe(true);
    expect(prepSteps({ photos: 8, photosTotal: 8, stagedPhotos: 2, versions: 4, published: false, preloads: 1 })[1].ok).toBe(false);
    expect(prepSteps({ photos: 2, photosTotal: null, stagedPhotos: 2, versions: 4, published: false, preloads: 0, target: 4 })[1].ok).toBe(true);
  });
});

describe("publicaciones en el sitio de la inmobiliaria", () => {
  const html = `
    <nav><a href="/">Inicio</a><a href="/propiedades">Propiedades</a><a href="/contacto">Contacto</a></nav>
    <a href="https://www.ficticia.test/propiedad/4521-ph-3-ambientes-san-bernardo">PH</a>
    <a href="/propiedad/4521-ph-3-ambientes-san-bernardo?utm_source=home">PH otra vez</a>
    <a href="/propiedad/7788-departamento-2-ambientes">Depto</a>
    <a href="/ficha/9911">Casa</a>
    <a href="https://otra-inmobiliaria.test/propiedad/1234-casa">De otra web</a>
    <a href="/img/7788.jpg">Foto</a>
    <a href="/blog/como-vender-tu-casa-2026">Blog</a>`;

  it("se queda con las fichas del mismo sitio, sin repetidas ni excluidas, y anota los listados", () => {
    const r = listingLinks(html, "https://ficticia.test/", ["https://ficticia.test/ficha/9911"]);
    expect(r.listings).toEqual(["https://www.ficticia.test/propiedad/4521-ph-3-ambientes-san-bernardo", "https://ficticia.test/propiedad/7788-departamento-2-ambientes"]);
    expect(r.indexes).toEqual(["https://ficticia.test/propiedades"]);
  });

  it("no toma portada, listados, contacto ni archivos como fichas", () => {
    for (const p of ["/", "/propiedades", "/contacto", "/img/1234.jpg", "/blog/nota-1234"]) expect(listingScore(p)).toBe(0);
    expect(listingScore("/propiedad/4521-ph-3-ambientes")).toBeGreaterThan(0);
  });
});
