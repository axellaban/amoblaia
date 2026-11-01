// The importer against real listing pages saved on 01/11/2026 (see
// tests/fixtures/listings/manifest.json): one per platform from the Habita V2
// QA list. Offline: the HTML is read from disk.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  adminClient: () => {
    throw new Error("not used");
  },
  currentUser: async () => null,
}));
import { importListing } from "../src/lib/demos/listing";
import { detectPlatform, extractPlatform } from "../src/lib/listings/platforms";
import { analyzeListing, cleanTitle, sentenceCase } from "../src/lib/listings/analyze";
import { extractStructured } from "../src/lib/listings/structured";

const DIR = "tests/fixtures/listings";
const manifest = JSON.parse(readFileSync(`${DIR}/manifest.json`, "utf8")) as Record<string, { url: string }>;
const read = (name: string) => {
  const html = readFileSync(`${DIR}/${name}.html`, "utf8");
  return { html, url: manifest[name].url, imp: importListing(html, manifest[name].url, { strategy: "fixture" }) };
};
const facts = (imp: ReturnType<typeof read>["imp"]) => imp.facts.map((f) => `${f.value} ${f.label}`);

type Expected = {
  platform: string;
  title: string;
  location: RegExp;
  price: string;
  operation: string | null;
  facts: string[];
  photos: number;
  photoHost: RegExp;
  agency: string | null;
};
const CASES: Record<string, Expected> = {
  "tokko-tormes": { platform: "tokko", title: "Departamento en Plaza Mitre", location: /^Bolivar al 2600, Plaza Mitre/, price: "USD 47.000", operation: "Venta", facts: ["2 ambientes", "1 dormitorio"], photos: 37, photoHost: /^https:\/\/static\.tokkobroker\.com\/pictures\/8634397_\d+\.jpg$/, agency: "Tormes Propiedades" },
  "tokko-mendiondo": { platform: "tokko", title: "Semipiso 4 ambientes en dúplex con terraza. Con cochera en Chauvín.", location: /^Córdoba al 3200, Chauvin$/, price: "USD 189.000", operation: "Venta", facts: ["134 m² totales", "119 m² cubiertos", "4 ambientes", "3 dormitorios"], photos: 60, photoHost: /^https:\/\/static\.tokkobroker\.com\/pictures\/12446118_\d+\.jpg$/, agency: "Claudia Mendiondo Propiedades" },
  "tokko-galan": { platform: "tokko", title: "Casa en Los Troncos", location: /^Saavedra al 1800, Los Troncos, Mar Del Plata$/, price: "USD 720.000", operation: "Venta", facts: ["8 ambientes", "4 dormitorios"], photos: 62, photoHost: /^https:\/\/static\.tokkobroker\.com\/pictures\/7795735_\d+\.jpg$/, agency: "Galan Broker Inmobiliario" },
  "tokko-bibbo": { platform: "tokko", title: "Departamento en Sarmiento", location: /^Mexico al 1400, Sarmiento, Mar Del Plata$/, price: "USD 49.900", operation: "Venta", facts: ["3 ambientes", "2 dormitorios"], photos: 34, photoHost: /^https:\/\/static\.tokkobroker\.com\/pictures\/8059687_\d+\.jpg$/, agency: "Negocios Inmobiliarios Lidia Bibbó" },
  "inmobiliatica-acampora": { platform: "inmobiliatica", title: "Departamento en La Perla", location: /^Av\. Libertad 3301, La Perla, Mar del Plata$/, price: "USD 143.640", operation: "Venta", facts: ["68 m² cubiertos", "2 ambientes"], photos: 14, photoHost: /^https:\/\/imagenes\.inmobiliaticaweb\.com\/imagenes-propiedades\/Files\/250097\/372287_/, agency: "Acampora y Asociados" },
  "inmobiliatica-damianfernandez": { platform: "inmobiliatica", title: "Departamento en Plaza Mitre", location: /^Moreno 2855, Plaza Mitre, Mar del Plata$/, price: "USD 72.000", operation: "Venta", facts: ["2 ambientes"], photos: 22, photoHost: /^https:\/\/imagenes\.inmobiliaticaweb\.com\//, agency: "Damián Fernández Inmobiliaria" },
  "inmobiliatica-businessmanager": { platform: "inmobiliatica", title: "Casa - Chalet en Las Avenidas", location: /Las Avenidas, Mar del Plata$/, price: "USD 55.000", operation: "Venta", facts: ["4 ambientes", "3 dormitorios"], photos: 29, photoHost: /^https:\/\/imagenes\.inmobiliaticaweb\.com\//, agency: "Business Manager Propiedades" },
  "inmobiliatica-homesland": { platform: "inmobiliatica", title: "Departamento en Centro", location: /Centro, Mar del Plata$/, price: "$ 210.000", operation: "Alquiler por Día", facts: ["3 ambientes"], photos: 12, photoHost: /^https:\/\/imagenes\.inmobiliaticaweb\.com\//, agency: "Homes - Land Propiedades" },
  "tokkoapi-sanzyordoqui": { platform: "tokko_api", title: "Departamento cuatro ambientes con dependencia", location: /^Santiago del estero 2329, Mar del Plata$/, price: "USD 119.900", operation: "Venta", facts: ["82 m² totales", "4 ambientes", "3 dormitorios"], photos: 27, photoHost: /^https:\/\/static\.tokkobroker\.com\/original_pictures\/13217780_/, agency: "Sanz y Ordoqui Propiedades" },
  "nextsanity-goicoechea": { platform: "next_tokko", title: "Departamento en Chauvin", location: /^Corrientes 3130, Chauvin$/, price: "USD 155.000", operation: "Venta", facts: ["2 ambientes", "1 dormitorio"], photos: 15, photoHost: /^https:\/\/static\.tokkobroker\.com\/pictures\/\d+\.jpg$/, agency: "Goicoechea Propiedades" },
  "nextrsc-dar": { platform: "next_rsc", title: "Departamento 2 ambientes, lateral muy luminoso.", location: /^Santa Fe 1800$/, price: "USD 55.000", operation: null, facts: ["45 m² totales", "1 dormitorio", "1 baño"], photos: 9, photoHost: /^https:\/\/www\.argenprop\.com\/static-content\/38411402\//, agency: "DAR Propiedades" },
  "wasi-piglia": { platform: "wasi", title: "Local en Mar del Plata", location: /^Mar del Plata, Buenos Aires$/, price: "USD 500.000", operation: "Venta", facts: ["140 m² cubiertos", "1 baño"], photos: 4, photoHost: /^https:\/\/images\.wasi\.co\/inmuebles\/g\d+\.jpg$/, agency: null },
  "tecnogestion-ordonez": { platform: "tecnogestion", title: "Departamento Semipiso en Mar Del Plata", location: /^Colon 900, Mar Del Plata$/, price: "USD 399.000", operation: "Venta", facts: ["4 ambientes", "3 dormitorios", "2 baños"], photos: 28, photoHost: /^https:\/\/cdn\.tecnogestion\.com\.ar\/multimedia\/AOP\//, agency: "Alejandra Ordoñez" },
  "houzez-grande": { platform: "houzez", title: "Casa de 4 ambientes con escritorio, garaje y patio", location: /^General Roca 2619, San José, Mar del Plata$/, price: "USD 200.000", operation: "Venta", facts: ["145 m² totales", "3 dormitorios", "2 baños", "1 cochera"], photos: 12, photoHost: /^https:\/\/grandepropiedades\.com\/wp-content\/uploads\//, agency: "Grande Propiedades" },
  "elementor-scagliola": { platform: "elementor", title: "Departamento en Centro", location: /^Santa Fe 1624, Centro$/, price: "USD 57.900", operation: "Venta", facts: ["2 ambientes", "1 baño"], photos: 15, photoHost: /^https:\/\/www\.emmanuelscagliola\.com\/wp-content\/uploads\//, agency: "Emmanuel Scagliola" },
  "php-berasueta": { platform: "generic", title: "Departamento en Venta de 1 ambiente en Mar del Plata", location: /^Av\. Colon 2351, Mar del Plata/, price: "USD 58.000", operation: "Venta", facts: ["28m2 totales"], photos: 6, photoHost: /^https:\/\/www\.inmobiliariaberasueta\.com\/cache\/thumbs\/gallery_full\/920\//, agency: "Inmobiliaria Berasueta" },
};

describe("Listing importer against saved pages of each platform", () => {
  it("covers every page of the QA list", () => {
    expect(Object.keys(CASES).sort()).toEqual(Object.keys(manifest).sort());
  });

  for (const [name, want] of Object.entries(CASES))
    it(`${name}: ${want.platform}`, () => {
      const { imp } = read(name);
      expect(imp.diagnostics?.platform).toBe(want.platform);
      expect(imp.title).toBe(want.title);
      expect(imp.location).toMatch(want.location);
      expect(imp.price).toBe(want.price);
      expect(imp.diagnostics?.priceStatus).toBe("published");
      expect(imp.operation).toBe(want.operation);
      for (const f of want.facts) expect(facts(imp)).toContain(f);
      expect(imp.description?.length ?? 0).toBeGreaterThan(100);
      expect(imp.images).toHaveLength(want.photos);
      for (const src of imp.images) expect(src).toMatch(want.photoHost);
      // No photo twice, no thumbnails, no site graphics.
      expect(new Set(imp.images).size).toBe(imp.images.length);
      expect(imp.images.join(" ")).not.toMatch(/_thumb\.|\/w_pics\/|\/medium\/|-\d{2,4}x\d{2,4}\.|logo|icon/i);
      expect(imp.agency.name).toBe(want.agency);
      // The figures are figures.
      for (const f of imp.facts) expect(f.value).toMatch(/^[1-9]\d*([.,]\d+)?/);
    });

  it("Inmobiliatica: the price of the listing, not of a similar listing further down", () => {
    const { imp } = read("inmobiliatica-acampora");
    expect(imp.price).toBe("USD 143.640");
    expect(imp.diagnostics?.conflicts.join(" ")).toMatch(/USD 84\.900 en lectura genérica/);
  });

  it("Tokko: watermarked web copies become the originals and the brand prefix leaves the title", () => {
    const bibbo = read("tokko-bibbo");
    expect(bibbo.html).toMatch(/\/w_pics\/8059687_/);
    expect(bibbo.imp.images.every((u) => u.includes("/pictures/"))).toBe(true);
    const mendiondo = read("tokko-mendiondo");
    expect(mendiondo.html).toMatch(/Claudia Mendiondo Propiedades :: /);
    expect(mendiondo.imp.title).not.toMatch(/::|Mendiondo/);
  });

  it("Houzez: a price shown with «$» and declared in USD in JSON-LD is in dollars", () => {
    const { html, imp } = read("houzez-grande");
    expect(html).toMatch(/<span> \$200,000<\/span>/);
    expect(imp.price).toBe("USD 200.000");
  });

  it("Wasi: photos come from the encoded addresses, at their original size", () => {
    const { imp } = read("wasi-piglia");
    expect(imp.images[0]).toBe("https://images.wasi.co/inmuebles/g109003120240924100658.jpg");
  });

  it("detects platforms from page signals, not from the agency's hostname", () => {
    const tokko = readFileSync(`${DIR}/tokko-tormes.html`, "utf8");
    expect(detectPlatform(tokko, "https://otro-dominio.com.ar/p/8634397-Departamento").platform).toBe("tokko");
    expect(detectPlatform("<html><body><h1>Casa</h1></body></html>", "https://www.tormespropiedades.com/p/8634397-x").platform).toBe("generic");
    expect(detectPlatform("<html></html>", "https://www.argenprop.com/departamento-en-venta--123").platform).toBe("argenprop");
  });

  it("reads Next.js payloads as data: a script inside the payload is text, never run", () => {
    const html = `<h1>Casa en Punta Mogotes</h1><span>Calle 1 123</span><p>U$S 90.000</p>
      <script>self.__next_f.push([1,"4:[\\"$\\",\\"$L13\\",null,{\\"images\\":[\\"https://cdn.example.com/a.jpg\\",\\"https://cdn.example.com/b.jpg\\"],\\"x\\":\\"<script>globalThis.pwned=1</script>\\"}]"])</script>`;
    const p = extractPlatform("next_rsc", html, "https://example.com/propiedad/1");
    expect(p.images).toEqual(["https://cdn.example.com/a.jpg", "https://cdn.example.com/b.jpg"]);
    expect(p.price?.text).toBe("USD 90.000");
    expect(p.location).toBe("Calle 1 123");
    expect((globalThis as { pwned?: number }).pwned).toBeUndefined();
  });

  it("tells «Consultar precio» from a price that could not be read", () => {
    const html = `<html><head><meta property="og:title" content="Casa en Venta en Chauvin - Alem al 3000"></head><body>
      <img src="https://static.tokkobroker.com/pictures/5550001_123.jpg"><div id="ask_for_price">Consultar precio</div></body></html>`;
    const imp = importListing(html, "https://inmo.com.ar/p/5550001-Casa", { strategy: "fixture" });
    expect(imp.price).toBeNull();
    expect(imp.diagnostics?.priceStatus).toBe("on_request");
    expect(imp.report.find((r) => r.field === "Precio")?.note).toMatch(/Consultar precio/);
    const silent = importListing(html.replace(/<div id="ask_for_price">Consultar precio<\/div>/, ""), "https://inmo.com.ar/p/5550001-Casa", { strategy: "fixture" });
    expect(silent.diagnostics?.priceStatus).toBe("not_found");
    expect(silent.diagnostics?.missing).toContain("precio");
  });

  it("only fills what the more specific sources did not find, and notes disagreements", () => {
    const html = `<html><head><script type="application/ld+json">{"@type":"RealEstateListing","name":"Casa en Los Pinares","address":{"streetAddress":"Rawson 100","addressLocality":"Mar del Plata"},"offers":{"@type":"Offer","price":150000,"priceCurrency":"USD"}}</script></head>
      <body><h1>Casa en Los Pinares</h1><div class="price">USD 140.000</div></body></html>`;
    const { details, diagnostics } = analyzeListing(html, "https://inmo.com/ficha/1", { strategy: "fixture" }, { title: "x", images: [], agencyName: "Inmo" });
    expect(details.price?.text).toBe("USD 150.000");
    expect(details.location).toBe("Rawson 100, Mar del Plata");
    expect(diagnostics.sources).toMatchObject({ price: "structured", location: "structured" });
    expect(diagnostics.conflicts[0]).toMatch(/USD 140\.000 en lectura genérica/);
  });

  it("cleans titles without destroying legitimate ones", () => {
    expect(cleanTitle("Claudia Mendiondo Propiedades :: Semipiso en Chauvín", "Claudia Mendiondo Propiedades")).toBe("Semipiso en Chauvín");
    expect(cleanTitle("Departamento 3 amb. - Güemes | Inmo Sur", "Inmo Sur")).toBe("Departamento 3 amb. - Güemes");
    expect(cleanTitle("Casa - Chalet en Las Avenidas", null)).toBe("Casa - Chalet en Las Avenidas");
    expect(sentenceCase("CASA DE 4 AMBIENTES CON PATIO")).toBe("Casa de 4 ambientes con patio");
    expect(sentenceCase("PH en Güemes")).toBe("PH en Güemes");
  });

  it("reads schema.org listings: rooms, area, offer and seller", () => {
    const s = extractStructured(readFileSync(`${DIR}/nextsanity-goicoechea.html`, "utf8"));
    expect(s.price?.text).toBe("USD 155.000");
    expect(s.pairs?.map((p) => `${p.label}=${p.value}`)).toEqual(expect.arrayContaining(["Ambientes=2", "Dormitorios=1", "Superficie total=65 m²"]));
    expect(s.agencyName).toBe("Goicoechea Propiedades");
  });
});
