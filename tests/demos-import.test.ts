import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { importListing } from "../src/lib/demos/listing";
import { applyImport, planImport, IMPORT_FIELDS, type CurrentDemo } from "../src/lib/demos/import";
import { DEFAULT_SETTINGS, readSettings } from "../src/lib/demos/branding";

const URL_ = "https://www.inmo.test/p/12025427-Departamento-en-Venta-en-La-Perla";
const CDN = "https://static.tokkobroker.com/pictures";
// A synthetic page with the structure of a Tokko Broker listing.
const PAGE = `<html><head>
<title>Inmo Sur - Departamento en Venta en La Perla - VENTA | A ESTRENAR</title>
<meta property="og:title" content="Departamento en Venta en La Perla - VENTA | A ESTRENAR | 3 AMB">
<meta property="og:description" content="Departamento a estrenar...">
<meta property="og:image" content="${CDN}/12025427_1_og.jpg">
</head><body>
<nav><img class="nav_logo_img" src="https://static.tokkobroker.com/tfw_images/1_Inmo/Inmo_logo.png"></nav>
<h1>VENTA | A ESTRENAR | 3 AMB</h1>
<p>VENTA | A ESTRENAR | 3 AMB | La Perla | Mar Del Plata</p>
<span class="prop-ref-code"> RAP12025427 | Departamento </span>
<div class="prop-detail-price-list"><span class="prop-detail-op-tag">Venta</span><span class="price-number">USD 265.000</span></div>
<div id="gallery">
  <a href="${CDN}/12025427_a.jpg"><img src="${CDN}/12025427_a_thumb.jpg"></a>
  <a href="${CDN}/12025427_b.jpg"><img src="${CDN}/12025427_b_thumb.jpg"></a>
  <a href="${CDN}/12025427_a.jpg"></a>
</div>
<h4>Información general</h4>
<div><span>Condición:</span><span>Excelente</span></div>
<div><span>Antigüedad:</span><span>A Estrenar</span></div>
<div><span>Crédito:</span><span>No especificado</span></div>
<h4>Superficies y medidas</h4>
<div><span>Total construido:</span><span>101 m²</span></div>
<div><span>Cubierta:</span><span>95 m²</span></div>
<div><span>Semicubierta:</span><span>6 m²</span></div>
<h4>Detalles de propiedad</h4>
<div><span>Ambientes:</span><span>3</span></div>
<div><span>Dormitorios:</span><span>2</span></div>
<div><span>Baños:</span><span>1</span></div>
<div><span>Toilettes:</span><span>1</span></div>
<h4>Descripción</h4>
<div class="full-description">Departamento a estrenar con vista al mar.<br><br>Bauleras USD 6.000<br>Cochera cubierta USD 28.000</div>
<h4>Servicios</h4>
<ul class="order_list"><li><a><span class="flaticon-tick"></span></a>Agua corriente</li><li><a><span class="flaticon-tick"></span></a>Gas natural</li><li><a><span class="flaticon-tick"></span></a>Videos</li></ul>
<h4>Ubicación</h4>
<script>var map = L.map('map').setView([-37.99,-57.54],15); L.circle([-37.9938,-57.5451],400).addTo(map);</script>
<div class="media"><img class="round-pic" src="https://static.tokkobroker.com/agents/sh.jpg"><div class="media-body">
  <h5>Sebastian Heit</h5>
  <a href="mailto:sebastian@inmo.test">sebastian@inmo.test</a>
  <a href="tel:5492235555141">223 5555141</a>
  <a href="https://api.whatsapp.com/send?phone=5492235555141">WhatsApp</a>
</div></div>
<h4>Propiedades similares</h4>
<img src="${CDN}/7266235_x.jpg"><span class="price-number">USD 190.000</span>
<footer>
  <a href="mailto:administracion@inmo.test">administracion@inmo.test</a>
  <a href="tel:+5402234515033">4515033</a>
  <a href="https://api.whatsapp.com/send?phone=5492233010717">WhatsApp</a>
  <p>Viamonte 2379. Mar del plata. Buenos Aires</p>
</footer>
</body></html>`;

describe("Import from a listing", () => {
  const imp = importListing(PAGE, URL_);

  it("reads every field of the property itself", () => {
    expect(imp).toMatchObject({
      propertyId: "12025427",
      title: "Departamento en La Perla",
      reference: "RAP12025427",
      operation: "Venta",
      price: "USD 265.000",
      priceConflict: null,
      features: "3 ambientes · 101 m² · 2 dormitorios",
      map: { precision: "approx", lat: -37.9938, lng: -57.5451 },
      agent: {
        name: "Sebastian Heit",
        email: "sebastian@inmo.test",
        whatsapp: "+5492235555141",
        photoUrl: "https://static.tokkobroker.com/agents/sh.jpg",
      },
      agency: {
        name: "Inmo Sur",
        logoUrl: "https://static.tokkobroker.com/tfw_images/1_Inmo/Inmo_logo.png",
        whatsapp: "+5492233010717",
      },
    });
    expect(imp.facts.map((f) => `${f.value} ${f.label}`)).toEqual([
      "101 m² totales",
      "95 m² cubiertos",
      "6 m² semicubiertos",
      "3 ambientes",
      "2 dormitorios",
      "1 baño",
      "1 toilette",
      "A Estrenar antigüedad",
    ]);
    expect(imp.description).toContain("Cochera cubierta USD 28.000");
    expect(imp.amenities).toEqual([
      { title: "Información general", items: ["Condición: excelente"] },
      { title: "Servicios", items: ["Agua corriente", "Gas natural"] },
    ]);
  });

  it("keeps only this property's photos, in order and without repeats", () => {
    expect(imp.images).toEqual([`${CDN}/12025427_a.jpg`, `${CDN}/12025427_b.jpg`]);
  });

  it("asks for nothing when everything essential was found", () => {
    expect(imp.report.filter((r) => r.status === "conflict" || (r.required && r.status !== "found"))).toEqual([]);
    expect(imp.report.find((r) => r.field === "Agente")).toMatchObject({ status: "found", value: "Sebastian Heit" });
  });

  it("flags a real price contradiction of one listing, with both amounts", () => {
    const office = importListing(
      `<title>Oficina en Güemes</title><div class="price">$ 1.100.000</div>
       <div id="description"><p>Oficina con dos privados.</p><p>Valor $950.000 más expensas.</p></div>`,
      "https://inmo.test/p/1",
    );
    expect(office.priceConflict).toMatch(/\$ 1\.100\.000.*\$ 950\.000/);
    expect(office.priceOptions).toEqual(["$ 1.100.000", "$ 950.000"]);
    expect(office.report.find((r) => r.field === "Precio")).toMatchObject({ status: "conflict", required: true });
  });

  it("completes a demo without overwriting what was edited by hand", () => {
    const cur: CurrentDemo = {
      title: "Departamento en Venta en La Perla",
      location: null,
      settings: readSettings({
        priceConflict: "la publicación muestra USD 265.000, USD 6.000, USD 28.000",
        description: "Texto corregido a mano.",
        reference: "RAP12025427",
      }),
      generated: { title: "Departamento en Venta en La Perla", location: null, description: "Departamento a estrenar..." },
    };
    const plan = planImport(cur, imp);
    expect(plan.fill.map((c) => c.field)).toEqual(
      expect.arrayContaining(["title", "location", "price", "facts", "agent", "map", "amenities"]),
    );
    expect(plan.fill.map((c) => c.field)).not.toContain("reference");
    expect(plan.conflicts.map((c) => c.field)).toEqual(["description"]);
    const kept = applyImport(cur, imp, plan.fill.map((c) => c.field));
    expect(kept.settings).toMatchObject({ price: "USD 265.000", priceConflict: null, description: "Texto corregido a mano." });
    expect(kept.title).toBe("Departamento en La Perla");
    const replaced = applyImport(cur, imp, ["description"]);
    expect(replaced.settings.description).toContain("vista al mar");
  });

  it("fits a new demo's settings in the stored column", () => {
    const made = applyImport(
      { title: "", location: null, settings: DEFAULT_SETTINGS, generated: { title: null, location: null, description: null } },
      imp,
      [...IMPORT_FIELDS],
    );
    expect(readSettings(made.settings)).toMatchObject({ price: "USD 265.000", agent: { name: "Sebastian Heit" } });
    expect(Buffer.byteLength(JSON.stringify(made.settings))).toBeLessThan(19000);
  });
});
