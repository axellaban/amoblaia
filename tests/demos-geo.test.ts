import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  adminClient: () => {
    throw new Error("not used");
  },
  currentUser: async () => null,
}));
import { distance, extractLocation, parseMapLink, validPair } from "../src/lib/demos/geo";
import { extractDetails } from "../src/lib/demos/listing-details";
import { applyImport, IMPORT_FIELDS, planImport, toDemo, type CurrentDemo } from "../src/lib/demos/import";
import { DEFAULT_SETTINGS, readSettings } from "../src/lib/demos/branding";
import { importedMap, mapInput } from "../src/lib/demos/input";
import { publicMap } from "../src/lib/demos/server";

const PAGE = "https://inmo.test/p/123-depto";
const page = (body: string, head = "") => `<html><head>${head}</head><body><h1>Depto 3 ambientes</h1>${body}</body></html>`;
const at = (body: string, head = "") => extractLocation(page(body, head));
const near = (m: { lat: number; lng: number } | null | undefined, lat: number, lng: number) =>
  expect(m && distance(m, { lat, lng })).toBeLessThan(5);

describe("Reading the property's location", () => {
  it("reads Leaflet markers with any number of decimals", () => {
    near(at("<script>L.marker([-38.0055,-57.5426]).addTo(m)</script>").map, -38.0055, -57.5426);
    near(at("<script>L.marker([-38.01,-57.54]).addTo(m)</script>").map, -38.01, -57.54);
    near(at("<script>L.marker( [ -38 , -57.5 ] )</script>").map, -38, -57.5);
  });

  it("reads Leaflet circles with a radius or an options object, and keeps the radius", () => {
    const r = at("<script>L.circle([-38.0055,-57.5426], {color:'red', radius:400}).addTo(m)</script>");
    expect(r).toMatchObject({ status: "found", map: { radius: 400, precision: "approx", source: "leaflet-circle" } });
    expect(at("<script>L.circle([-38.0055,-57.5426], 900)</script>").map).toMatchObject({ radius: 900, precision: "zone" });
  });

  it("reads JSON-LD coordinates of the property, in arrays, @graph and nested location.geo", () => {
    const ld = (o: unknown) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
    near(at(ld({ "@type": "Apartment", geo: { "@type": "GeoCoordinates", latitude: -38.0055, longitude: -57.5426 } })).map, -38.0055, -57.5426);
    const graph = at(
      ld({
        "@graph": [
          { "@type": "RealEstateAgent", geo: { latitude: -37.99, longitude: -57.55 } },
          { "@type": "Offer", itemOffered: { "@type": "House", location: { geo: { latitude: "-38.1", longitude: "-57.6" } } } },
        ],
      }),
    );
    expect(graph.status).toBe("found");
    near(graph.map, -38.1, -57.6);
    expect(at(ld([{ "@type": "Organization", geo: { latitude: -37.99, longitude: -57.55 } }])).status).toBe("none");
  });

  it("reads map links and embeds, decoding entities and URL encoding", () => {
    near(at('<iframe src="https://maps.google.com/maps?q=-38.0055,-57.5426&amp;output=embed"></iframe>').map, -38.0055, -57.5426);
    near(at('<a href="https://www.google.com/maps/search/?api=1&amp;query=-38.0055%2C-57.5426">Ver</a>').map, -38.0055, -57.5426);
    near(at('<iframe src="https://www.openstreetmap.org/export/embed.html?bbox=-57.55,-38.01,-57.53,-38.00&amp;marker=-38.0055,-57.5426"></iframe>').map, -38.0055, -57.5426);
  });

  it("reads lat/lng objects, Google Maps LatLng and data attributes", () => {
    near(at('<script>var p = {"latitude": "-38.0055", "longitude": "-57.5426"};</script>').map, -38.0055, -57.5426);
    near(at("<script>new google.maps.Marker({position: {lng: -57.5426, lat: -38.0055}})</script>").map, -38.0055, -57.5426);
    near(at("<script>new google.maps.LatLng(-38.0055, -57.5426)</script>").map, -38.0055, -57.5426);
    near(at('<div id="mapa" data-lat="-38.0055" data-lng="-57.5426"></div>').map, -38.0055, -57.5426);
  });

  it("never takes the office's location: footer, office sections and agency JSON-LD", () => {
    const office = "<footer><h4>Nuestra oficina</h4><script>new google.maps.LatLng(-37.9990,-57.5500)</script></footer>";
    expect(at(office)).toMatchObject({ status: "none", map: null });
    // The office's map first in the HTML, then the property's.
    const r = at(
      '<section class="sucursal"><h3>Sucursal Centro</h3><div data-lat="-37.999" data-lng="-57.55"></div></section>' +
        "<h4>Ubicación</h4><script>L.marker([-38.0055,-57.5426])</script>",
    );
    near(r.map, -38.0055, -57.5426);
    // "Apto oficina" in a description does not make the property an office.
    near(at("<h4>Descripción</h4><p>Apto oficina.</p><h4>Ubicación</h4><script>L.marker([-38.0055,-57.5426])</script>").map, -38.0055, -57.5426);
  });

  it("leaves out other listings' locations", () => {
    const r = extractDetails(
      page(
        "<h4>Ubicación</h4><script>L.circle([-38.0055,-57.5426],{radius:300})</script>" +
          '<h4>Propiedades similares</h4><div data-lat="-38.02" data-lng="-57.56"></div><a href="https://maps.google.com/?q=-38.03,-57.57">otra</a>',
      ),
      PAGE,
    );
    near(r.map, -38.0055, -57.5426);
    expect(r.geo.status).toBe("found");
    // A script after the listing that places many points is a map of listings, not of this one.
    const listings = extractDetails(
      page("<h4>Propiedades similares</h4><script>L.marker([-38.01,-57.54]);L.marker([-38.03,-57.56]);L.marker([-38.05,-57.58])</script>"),
      PAGE,
    );
    expect(listings.geo.status).toBe("none");
  });

  it("asks for a review when two strong places disagree, or only the map's center is known", () => {
    const two = at("<script>L.marker([-38.0055,-57.5426])</script><div data-lat='-38.1' data-lng='-57.7'></div><script>L.marker([-38.1,-57.7])</script>");
    expect(two.status).toBe("review");
    expect(two.note).toMatch(/dos ubicaciones/);
    const view = at("<script>L.map('m').setView([-38.0055,-57.5426], 15)</script>");
    expect(view).toMatchObject({ status: "review", map: { precision: "zone", confidence: "low" } });
    // Agreeing sources are one place, with more confidence.
    expect(at("<script>L.circle([-38.0055,-57.5426],{radius:300});L.map('m').setView([-38.0056,-57.5427],15)</script>").map?.confidence).toBe("high");
  });

  it("rejects invalid pairs and the 0,0 placeholder, but not a single zero", () => {
    expect(at("<script>L.marker([0,0])</script>").status).toBe("none");
    expect(at("<script>L.marker([95.1,-57.5])</script>").status).toBe("none");
    expect(at("<script>L.marker([NaN,-57.5])</script>").status).toBe("none");
    near(at("<script>L.marker([0,-57.5])</script>").map, 0, -57.5);
    expect(validPair(-38, 0)).toBe(true);
    expect(validPair(0, 0)).toBe(false);
    expect(validPair("-38.1", "-57.2")).toBe(true);
    // Not swapped silently: a longitude where a latitude goes is out of range.
    expect(at("<script>L.marker([-157.5,-38.0])</script>").status).toBe("none");
    // Outside Argentina is fine.
    near(at("<script>L.marker([40.4168,-3.7038])</script>").map, 40.4168, -3.7038);
  });

  it("returns nothing when the page has no coordinates", () => {
    expect(at("<p>Sin mapa</p>")).toEqual({ status: "none", map: null, candidates: [], note: null });
  });
});

describe("Map links people paste", () => {
  it("understands the usual providers and tells a pin from a view", () => {
    expect(parseMapLink("https://www.google.com/maps/place/-38.0055,-57.5426")).toMatchObject({ lat: -38.0055, lng: -57.5426, kind: "pin" });
    expect(parseMapLink("https://www.google.com/maps/@-38.0055,-57.5426,17z")).toMatchObject({ kind: "view", zoom: 17 });
    expect(parseMapLink("https://www.google.com/maps/place/Alberti+4300/@-38.01,-57.55,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d-38.0055!4d-57.5426")).toMatchObject({ lat: -38.0055, lng: -57.5426, kind: "pin" });
    expect(parseMapLink("https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3143.2!2d-57.5426!3d-38.0055!2m3!1f0")).toMatchObject({ lat: -38.0055, lng: -57.5426, kind: "view" });
    expect(parseMapLink("https://www.openstreetmap.org/?mlat=-38.0055&mlon=-57.5426#map=17/-38.0055/-57.5426")).toMatchObject({ kind: "pin" });
    expect(parseMapLink("https://www.openstreetmap.org/#map=16/-38.0055/-57.5426")).toMatchObject({ kind: "view", zoom: 16 });
    expect(parseMapLink("https://waze.com/ul?ll=-38.0055%2C-57.5426&navigate=yes")).toMatchObject({ lat: -38.0055, kind: "pin" });
    expect(parseMapLink("https://maps.apple.com/?ll=-38.0055,-57.5426&q=Casa")).toMatchObject({ kind: "pin" });
    expect(parseMapLink("geo:-38.0055,-57.5426")).toMatchObject({ kind: "pin" });
  });

  it("rejects what cannot be read safely: short links, other sites, schemes and junk", () => {
    expect(parseMapLink("https://maps.app.goo.gl/AbCdEf")).toBeNull();
    expect(parseMapLink("https://evil.test/maps?q=-38.0,-57.5")).toBeNull();
    expect(parseMapLink("javascript:alert(1)")).toBeNull();
    expect(parseMapLink("https://www.google.com/maps/place/Alberti+4300")).toBeNull();
    expect(parseMapLink("https://maps.google.com/?q=0,0")).toBeNull();
  });
});

describe("From the listing to the public page", () => {
  const circle = page("<h4>Ubicación</h4><script>L.circle([-38.00551234,-57.54261234],{radius:400})</script>");
  const fallback = { title: "Depto", location: null, description: null, prices: [], images: [], agencyName: "Inmo", website: "https://inmo.test/" };
  const empty: CurrentDemo = { title: "", location: null, settings: DEFAULT_SETTINGS, generated: { title: null, location: null, description: null } };

  it("keeps source and radius through import, saving and reading, and rounds what the browser gets", () => {
    const imp = toDemo(extractDetails(circle, PAGE), fallback);
    expect(imp).toMatchObject({ mapStatus: "found", map: { radius: 400, source: "leaflet-circle", precision: "approx" } });
    expect(imp.report.find((r) => r.field === "Mapa")).toMatchObject({ status: "found" });
    const saved = applyImport(empty, imp, [...IMPORT_FIELDS]).settings;
    // Stored as JSON and read back.
    const read = readSettings(JSON.parse(JSON.stringify(saved)));
    expect(read.map).toMatchObject({ precision: "approx", radius: 400, source: "leaflet-circle" });
    expect(publicMap(read)).toEqual({ precision: "approx", lat: -38.006, lng: -57.543, radius: 400 });
    // A zone never sends the exact point, nor a tiny area.
    expect(publicMap({ map: { ...read.map, precision: "zone", radius: 100 } })).toEqual({ precision: "zone", lat: -38.01, lng: -57.54, radius: 700 });
    expect(publicMap({ map: { ...read.map, precision: "exact" } })).toEqual({ precision: "exact", lat: -38.00551, lng: -57.54261, radius: null });
    expect(publicMap({ map: { ...read.map, precision: "none" } })).toBeNull();
  });

  it("reads settings saved before maps had a radius or a source", () => {
    expect(readSettings({ map: { precision: "zone", lat: -38, lng: -57.5 } }).map).toEqual({
      precision: "zone",
      lat: -38,
      lng: -57.5,
      radius: null,
      source: null,
    });
  });

  it("does not save a map that needs a review unless a place is chosen", () => {
    const html = page("<script>L.marker([-38.0055,-57.5426])</script><script>L.marker([-38.1,-57.7])</script>");
    const imp = toDemo(extractDetails(html, PAGE), fallback);
    expect(imp.mapStatus).toBe("review");
    expect(imp.mapPlaces).toHaveLength(2);
    expect(applyImport(empty, imp, [...IMPORT_FIELDS]).settings.map.precision).toBe("none");
    const chosen = importedMap(imp, { precision: "approx", lat: imp.mapPlaces[1].lat, lng: imp.mapPlaces[1].lng }, DEFAULT_SETTINGS.map);
    expect(chosen).toMatchObject({ lat: -38.1, lng: -57.7, source: "leaflet-marker" });
  });

  it("accepts a pasted link or coordinates, validated, as a manual location", () => {
    expect(mapInput({ precision: "approx", link: "https://www.google.com/maps/place/-38.0055,-57.5426" })).toEqual({
      precision: "approx",
      lat: -38.0055,
      lng: -57.5426,
      radius: null,
      source: "manual",
    });
    expect(mapInput({ precision: "exact", lat: "-38,0055", lng: "-57.5426" })).toMatchObject({ lat: -38.0055, source: "manual" });
    expect(() => mapInput({ precision: "approx", link: "https://evil.test/x" })).toThrow(/No reconocemos/);
    expect(() => mapInput({ precision: "approx", lat: "0", lng: "0" })).toThrow(/latitud y longitud/);
    expect(mapInput({ precision: "none", lat: "-38", lng: "-57" })).toEqual(DEFAULT_SETTINGS.map);
    // Changing only what is shown keeps the origin and area of the same point.
    const current = { precision: "approx" as const, lat: -38.0055, lng: -57.5426, radius: 400, source: "leaflet-circle" as const };
    expect(mapInput({ precision: "zone", lat: -38.0055, lng: -57.5426 }, current)).toMatchObject({ precision: "zone", radius: 400, source: "leaflet-circle" });
  });

  it("completes a missing map on a new reading, never overwrites a manual one and never deletes one", () => {
    const imp = toDemo(extractDetails(circle, PAGE), fallback);
    const base = { title: "Depto", location: null, generated: { title: null, location: null, description: null } };
    const without = planImport({ ...base, settings: DEFAULT_SETTINGS }, imp);
    expect(without.fill.map((c) => c.field)).toContain("map");
    const manual = { ...DEFAULT_SETTINGS, map: { precision: "exact" as const, lat: -38.02, lng: -57.53, radius: null, source: "manual" as const } };
    const plan = planImport({ ...base, settings: manual }, imp);
    expect(plan.fill.map((c) => c.field)).not.toContain("map");
    expect(plan.conflicts.map((c) => c.field)).toContain("map");
    expect(applyImport({ ...base, settings: manual }, imp, plan.fill.map((c) => c.field)).settings.map).toEqual(manual.map);
    // A reading without a map leaves the saved one as it is.
    const noMap = toDemo(extractDetails(page("<p>sin mapa</p>"), PAGE), fallback);
    const kept = applyImport({ ...base, settings: manual }, noMap, [...IMPORT_FIELDS]).settings.map;
    expect(kept).toEqual(manual.map);
  });

  it("says when the location section exists but its map is drawn later by the browser", () => {
    const imp = toDemo(extractDetails(page('<h4>Ubicación</h4><div id="map"></div>'), PAGE), fallback);
    expect(imp.mapStatus).toBe("none");
    expect(imp.report.find((r) => r.field === "Mapa")).toMatchObject({ status: "error", note: expect.stringMatching(/se carga después/) });
  });
});
