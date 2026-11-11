import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { propertyStage, type PanelProperty, type PanelSummary } from "@/lib/agency/shared";

vi.mock("@/lib/analytics", () => ({ track: () => {}, trackMilestone: () => {}, registerSuperProperties: () => {}, registerSuperPropertiesOnce: () => {} }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }), usePathname: () => "/panel", useSearchParams: () => new URLSearchParams() }));

const { PropertyTile, byStage } = await import("@/components/agency-panel");
const { PanelNav } = await import("@/components/panel-shell");

const base: PanelProperty = {
  id: "d1",
  title: "Depto 3 amb. con balcón",
  location: "Palermo, CABA",
  reference: null,
  origin: "agency",
  price: "USD 168.000",
  operation: "Venta",
  photos: 0,
  staged: 0,
  versions: { ready: 0, active: 0, issues: 0 },
  spaces: null,
  status: "draft",
  token: "t",
  coverPhotoId: null,
  listingUrl: "https://www.zonaprop.com.ar/propiedades/depto-3-amb-palermo.html",
  createdAt: "2026-11-07T12:00:00Z",
  pending: null,
  videos: 0,
};
const agency = { id: "a1", name: "Inmo Sur", slug: "inmo-sur" } as PanelSummary["agency"];
const tile = (p: PanelProperty, canWork = true) =>
  renderToStaticMarkup(<PropertyTile p={p} agency={agency} reload={async () => null} canWork={canWork} />);

describe("where a property stands in «Mis propiedades»", () => {
  it("saved from its listing with its photos still to import is «Lista para importar»", () => {
    expect(propertyStage({ ...base, pending: { importId: "i1", images: ["https://x/1.jpg"] } })).toBe("pending");
    // Once it has photos (imported, or uploaded by hand) it is not waiting anymore.
    expect(propertyStage({ ...base, photos: 3, pending: { importId: "i1", images: ["https://x/1.jpg"] } })).toBe("imported");
  });
  it("with staged photos or published it has its demo; with photos only it is imported", () => {
    expect(propertyStage({ ...base, photos: 12, staged: 3 })).toBe("demo");
    expect(propertyStage({ ...base, photos: 12, status: "published" })).toBe("demo");
    expect(propertyStage({ ...base, photos: 12 })).toBe("imported");
    expect(propertyStage(base)).toBe("empty");
  });
});

describe("the property cards", () => {
  it("a saved listing shows its data, the listing's photo dimmed and one click to import (no credits)", () => {
    const html = tile({ ...base, pending: { importId: "i1", images: ["https://img.zonaprop.com/1.jpg", "https://img.zonaprop.com/2.jpg"] } });
    expect(html).toContain("Lista para importar");
    expect(html).toContain("2 fotos en la publicación");
    expect(html).toContain("Palermo, CABA · USD 168.000");
    expect(html).toContain("zonaprop.com.ar");
    expect(html).toContain("Importar fotos con un clic");
    expect(html).toContain("No usa créditos");
    expect(html).toContain("is-pending");
    // A viewer sees it, but cannot import.
    expect(tile({ ...base, pending: { importId: "i1", images: ["https://x/1.jpg"] } }, false)).not.toContain("Importar fotos con un clic");
  });
  it("a property with its demo has one row per tool: share and edit the demo, edit images, create or edit the video", () => {
    const html = tile({ ...base, photos: 12, staged: 3, status: "published", coverPhotoId: "p1", videos: 0 });
    expect(html).toContain("Demo creada");
    expect(html).toContain("Demostración");
    expect(html).toContain("Compartir");
    expect(html).toContain("3 ambientadas de 12");
    if (html.includes("<strong>Video</strong>")) {
      expect(html).toContain("Crear video");
      expect(tile({ ...base, photos: 12, staged: 3, status: "published", videos: 1 })).toMatch(/1 video<[\s\S]*>Editar</);
    }
  });
  it("an imported property without its demo leads to staging", () => {
    const html = tile({ ...base, photos: 14 });
    expect(html).toContain("Importada · 14 fotos");
    expect(html).toContain("Ambientar y crear demostración");
  });
});

describe("support view and order", () => {
  it("the team's read-only support view does not offer the import (each photo would be refused)", () => {
    const html = renderToStaticMarkup(
      <PropertyTile p={{ ...base, pending: { importId: "i1", images: ["https://x/1.jpg"] } }} agency={agency} reload={async () => null} canWork readOnly />,
    );
    expect(html).not.toContain("Importar fotos con un clic");
    expect(html).toContain("solo lectura");
  });
  it("the property with its demo goes first, the ones waiting for their photos last", () => {
    const pending = { ...base, id: "p", pending: { importId: "i", images: ["https://x/1.jpg"] } };
    const demo = { ...base, id: "d", photos: 5, staged: 2 };
    const imported = { ...base, id: "m", photos: 5 };
    expect(byStage([pending, imported, demo]).map((p) => p.id)).toEqual(["d", "m", "p"]);
  });
});

describe("the panel's menu and home", () => {
  it("«Mis propiedades» comes right after «Inicio», before demos, images and video", () => {
    const html = renderToStaticMarkup(<PanelNav section="inicio" agencyName="Inmo Sur" role="owner" credits={3} />);
    expect(html).toContain('href="/panel/mis-propiedades"');
    const at = (label: string) => html.indexOf(`<span>${label}</span>`);
    expect(at("Inicio")).toBeLessThan(at("Mis propiedades"));
    expect(at("Mis propiedades")).toBeLessThan(at("Mis demostraciones"));
    expect(at("Mis demostraciones")).toBeLessThan(at("Estudio de imágenes"));
  });
  it("the home's section is «Mis propiedades», with the demo first and step 1 saved when the listing is read", () => {
    const source = readFileSync("src/components/agency-panel.tsx", "utf8");
    expect(source).toContain('<h2 id="ap-props-title">Mis propiedades</h2>');
    expect(source).not.toContain("Mis demostraciones recientes");
    expect(source).toContain("Lo hago después");
    expect(source).toMatch(/autoSave && !resume && !data\.duplicateOf && !isVisiting\(\)/);
    // The import comes below «Mis propiedades», and only the latest failed imports are listed.
    const home = source.slice(source.indexOf("function PanelHome"), source.indexOf('/** "Ver mi sitio"'));
    expect(home.indexOf('id="ap-props-title"')).toBeLessThan(home.indexOf('id="crear"'));
    expect(source).toContain("const ISSUES_SHOWN = 3;");
    // «Mis demostraciones» lists only what has its demo, never the ones waiting for their photos.
    expect(source).toContain('etapa: "importadas"');
  });
});
