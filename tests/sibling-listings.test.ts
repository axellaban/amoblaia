import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { siblingListings } from "../src/lib/demos/listing";

// Otros avisos del mismo sitio enlazados desde la ficha principal, para las precargas. HTML sintético.
describe("avisos hermanos de una ficha", () => {
  it("toma los del mismo sitio con la misma forma y descarta menús, fotos, otros sitios y repetidos", () => {
    const html = `
      <a href="/propiedad/depto-palermo-123">misma</a>
      <a href="/propiedad/casa-belgrano-456?utm_source=x">casa</a>
      <a href="https://www.ficticia.test/propiedad/ph-nunez-789">ph</a>
      <a href="/propiedad/casa-belgrano-456">repetida</a>
      <a href="/contacto">contacto</a>
      <a href="/propiedad/foto.jpg">foto</a>
      <a href="/venta/departamentos">listado</a>
      <a href="https://otra.test/propiedad/lote-1">otro sitio</a>
      <a href="/propiedad/a/b">más profundo</a>`;
    expect(siblingListings(html, "https://ficticia.test/propiedad/depto-palermo-123")).toEqual([
      "https://ficticia.test/propiedad/casa-belgrano-456",
      "https://www.ficticia.test/propiedad/ph-nunez-789",
    ]);
  });

  it("en sitios con la ficha por parámetro, pide los mismos parámetros en la misma página", () => {
    const html = `<a href="ficha.php?id=2">dos</a><a href="ficha.php?id=3&utm_medium=y">tres</a><a href="buscar.php?id=4">buscar</a><a href="ficha.php?op=venta">otra</a>`;
    expect(siblingListings(html, "https://ficticia.test/ficha.php?id=1")).toEqual(["https://ficticia.test/ficha.php?id=2", "https://ficticia.test/ficha.php?id=3"]);
  });
});
