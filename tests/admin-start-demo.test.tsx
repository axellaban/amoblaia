import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { StartPicker, teamEditorPath, toolPath } from "@/components/start-picker";
import { firstDemoPath } from "@/components/admin-new-agency";

const track = vi.fn();
vi.mock("@/lib/analytics", () => ({ track: (...a: unknown[]) => track(...a), trackMilestone: () => {}, registerSuperProperties: () => {}, registerSuperPropertiesOnce: () => {} }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }), usePathname: () => "/admin", useSearchParams: () => new URLSearchParams() }));

const AG = "0b9f6a3e-5c1d-4e2a-9f7b-1a2b3c4d5e6f";
const team = { agencyId: AG, agencyName: "Inmobiliaria Costa", back: `/admin/inmobiliarias/${AG}/editar` };

describe("the team's «Crear demostración interactiva», on the panel's own flow", () => {
  it("goes from the new agency straight to its first demo", () => {
    expect(firstDemoPath(AG)).toBe(`/admin/inmobiliarias/${AG}/propiedades/nueva?creada=1&volver=%2Fadmin%2Finmobiliarias%2F${AG}%2Feditar`);
  });

  it("opens the chosen property in the team's editor (with the edit banner), never in the agency's panel", () => {
    const path = teamEditorPath(team, "d1");
    expect(path).toBe(`/admin/inmobiliarias/${AG}/propiedades/d1?seccion=fotos&volver=%2Fadmin%2Finmobiliarias%2F${AG}%2Feditar`);
    expect(path).not.toContain("/panel/");
    // The agency's own panel keeps its route.
    expect(toolPath("demo", "d1")).toBe("/panel/propiedades/d1?seccion=fotos&volver=%2Fpanel");
  });

  it("offers the same three ways in, worded for the agency the team is working on", () => {
    const html = renderToStaticMarkup(<StartPicker tool="demo" existingCount={0} team={team} onClose={() => {}} />);
    expect(html).toContain("Crear demostración interactiva");
    expect(html).toContain("¿Con qué querés empezar?");
    expect(html).toContain("Cargando sus propiedades…");
    expect(html).not.toContain("tus propiedades");
    // Rendering tracks nothing, and the team's steps are never the agency's.
    expect(track).not.toHaveBeenCalled();
  });
});
