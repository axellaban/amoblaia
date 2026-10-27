import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { importListing } from "../src/lib/demos/listing";
import { applyImport, IMPORT_FIELDS } from "../src/lib/demos/import";
import { DEFAULT_SETTINGS } from "../src/lib/demos/branding";

// The structure of a Century 21 Argentina listing (Next.js): data in <dt>/<dd>
// pairs, the price only in the JSON-LD offer, the headline figures as a list
// under the title and the map's point in the page data as an escaped JSON
// string ({\"lat\":…,\"lon\":…}). Written for the test: not the real page.
const URL_ = "https://century21.com.ar/propiedades/argentina/provincia-de-buenos-aires/mar-del-plata/venta/departamento/venta-departamento-3-ambientes-delfi-503669";
const dl = (title: string, rows: [string, string][]) =>
  `<div><h3>${title}</h3><dl>${rows.map(([k, v]) => `<div><dt class="text-neutral-600">${k}</dt><dd class="text-right">${v}</dd></div>`).join("")}</dl></div>`;
const PAGE = `<!doctype html><html><head><title>VENTA DEPARTAMENTO 3 AMBIENTES DELFI XVI</title>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"VENTA DEPARTAMENTO 3 AMBIENTES DELFI XVI",
"description":"Departamento de 4 ambientes en Chauvin.","image":["https://img.c21.test/503669/a/original.JPG","https://img.c21.test/503669/b/original.JPG"],
"offers":{"@type":"Offer","priceCurrency":"USD","price":360000},"address":{"@type":"PostalAddress","addressLocality":"Mar del Plata","streetAddress":"La Rioja"}}</script>
</head><body>
<h1>VENTA DEPARTAMENTO 3 AMBIENTES DELFI XVI</h1>
<p class="text-3xl font-extrabold">US$ 360.000</p>
<ul><li>134 m²</li><li>119,9 m²</li><li>3</li><li>2</li><li>1</li></ul>
<h2>Descripción</h2><div class="description"><p>Departamento de 4 ambientes en Chauvin. Muy luminoso.</p></div>
${dl("Detalles de la Propiedad", [["Expensas", "350.000"], ["Disposición", "Frente"], ["Piso en que se encuentra", "2"]])}
${dl("Datos Principales", [["Dormitorios Totales", "3"], ["Baños Completos", "2"], ["Ambientes", "3"]])}
${dl("Medidas y Superficies", [["Superficie Construcción", "119,9"], ["Superficie Terreno/Total", "134"], ["Superficie Semicubierta", "14,2"]])}
<h3>Amenities</h3><ul><li>Gimnasio</li><li>Parrilla</li></ul>
<h2>Propiedades cercanas</h2>
<a><p class="text-xl">US$ 319.000</p><h3>Otro departamento</h3><p>87 m² · 3 amb. · 2 dorm.</p></a>
<h2>Ubicación</h2><p>La Rioja 3520, Mar del Plata</p><div class="leaflet-container"></div>
<script>self.__next_f.push([1,"[\\"$\\",\\"div\\",null,{\\"className\\":\\"w-full\\",\\"children\\":[\\"$\\",\\"$L38\\",\\"503669\\",{\\"lat\\":-38.012171,\\"lon\\":-57.562486}]}]"])</script>
</body></html>`;

describe("A Century 21 listing", () => {
  const imp = importListing(PAGE, URL_);

  it("takes the price from the page's offer and the operation from its title", () => {
    expect(imp.price).toBe("USD 360.000");
    expect(imp.priceConflict).toBeNull();
    expect(imp.operation).toBe("Venta");
  });

  it("reads definition lists as data with icons, areas in m², and the expenses", () => {
    expect(imp.facts).toEqual([
      { icon: "area", value: "134 m²", label: "totales" },
      { icon: "area", value: "119,9 m²", label: "cubiertos" },
      { icon: "area", value: "14,2 m²", label: "semicubiertos" },
      { icon: "rooms", value: "3", label: "ambientes" },
      { icon: "bedrooms", value: "3", label: "dormitorios" },
      { icon: "bathrooms", value: "2", label: "baños" },
      { icon: "floor", value: "2", label: "piso" },
    ]);
    expect(imp.expenses).toBe("$ 350.000");
    expect(imp.report.find((r) => r.field === "Expensas")?.note).toMatch(/moneda/);
  });

  it("finds the map's point in the page data, written as an escaped JSON string", () => {
    expect(imp.mapStatus).toBe("found");
    expect(imp.map).toMatchObject({ lat: -38.012171, lng: -57.562486, precision: "approx" });
  });

  it("does not take the headline's bare figures as features", () => {
    expect(imp.amenities.map((g) => g.title)).not.toContain("VENTA DEPARTAMENTO 3 AMBIENTES DELFI XVI");
    expect(imp.amenities.flatMap((g) => g.items)).not.toContain("134 m²");
    expect(imp.amenities.find((g) => g.title === "Amenities")?.items).toEqual(["Gimnasio", "Parrilla"]);
  });

  it("saves price, expenses, icons and map on the new property", () => {
    const made = applyImport(
      { title: imp.title, location: imp.location, settings: DEFAULT_SETTINGS, generated: { title: null, location: null, description: null } },
      imp,
      [...IMPORT_FIELDS],
    );
    expect(made.settings).toMatchObject({ price: "USD 360.000", priceConflict: null, expenses: "$ 350.000", operation: "Venta" });
    expect(made.settings.facts).toHaveLength(7);
    expect(made.settings.map).toMatchObject({ lat: -38.012171, lng: -57.562486 });
  });
});
