import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACTIONS, DASHBOARDS, GLOBAL_FILTERS, eventsUsed, queryOf } from "@/lib/analytics-setup";
import { cleanLabel, linkTarget, routeOf, surfaceOf } from "@/lib/interaction-tracking";

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
const source = files("src")
  .filter((f) => !f.endsWith("analytics-setup.ts"))
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");

describe("the PostHog dashboards", () => {
  it("only read events the code sends (or PostHog's own)", () => {
    const missing = eventsUsed().filter((e) => !e.startsWith("$") && !source.includes(`"${e}"`));
    expect(missing).toEqual([]);
  });

  it("refer only to actions that are created", () => {
    const names = new Set(ACTIONS.map((a) => a.name));
    const ids = new Map(ACTIONS.map((a, i) => [a.name, i + 1]));
    for (const d of DASHBOARDS)
      for (const i of d.insights) {
        const steps = i.kind === "funnel" ? i.steps : i.kind === "trend" ? i.series : [];
        for (const s of steps) if ("action" in s) expect(names.has(s.action)).toBe(true);
        expect(() => queryOf(i, ids)).not.toThrow();
      }
  });

  it("build funnels of at least two steps, outside the team's traffic", () => {
    const ids = new Map(ACTIONS.map((a, i) => [a.name, i + 1]));
    const funnel = DASHBOARDS[0].insights.find((i) => i.kind === "funnel")!;
    const q = queryOf(funnel, ids) as { source: { kind: string; series: unknown[]; properties: { values: { values: unknown[] }[] } } };
    expect(q.source.kind).toBe("FunnelsQuery");
    expect(q.source.series.length).toBeGreaterThan(5);
    expect(q.source.properties.values[0].values).toHaveLength(GLOBAL_FILTERS.length);
    for (const d of DASHBOARDS) for (const i of d.insights) if (i.kind === "funnel") expect(i.steps.length).toBeGreaterThanOrEqual(2);
  });

  it("have unique names inside each dashboard (the script finds them by name)", () => {
    for (const d of DASHBOARDS) expect(new Set(d.insights.map((i) => i.name)).size).toBe(d.insights.length);
  });
});

describe("screens and clicks", () => {
  it("turn a page into a template without tokens, codes or ids", () => {
    expect(routeOf("/demo/Ab3dE9xYz12Q/presentacion/SECRETO-123/precios")).toBe("/demo/:token/presentacion/:code/precios");
    expect(routeOf("/panel/propiedades/8fac7831-e2be-4dbd-bfa3-c8e55a32fae3/vista-previa")).toBe("/panel/propiedades/:id/vista-previa");
    expect(routeOf("/inmobiliaria/lopez-propiedades/tok123")).toBe("/inmobiliaria/:slug/:token");
    expect(routeOf("/p/depto-palermo-k3m9x2pq7z")).toBe("/p/:token");
    expect(routeOf("/panel/imagenes/lote")).toBe("/panel/imagenes/lote");
    expect(routeOf("/")).toBe("/");
  });

  it("keep the admin apart", () => {
    expect(surfaceOf("/admin/inmobiliarias")).toBe("admin");
  });

  it("never send an e-mail, a phone or a link in a label", () => {
    expect(cleanLabel("  Escribir a  ana@inmo.com ")).toBe("Escribir a [email]");
    expect(cleanLabel("Llamar al +54 9 11 5555-5555")).toBe("Llamar al [número]");
    expect(cleanLabel("Abrir https://inmo.com/x?codigo=1")).toBe("Abrir [enlace]");
    expect(cleanLabel("   ")).toBeUndefined();
    expect(cleanLabel("x".repeat(100))).toHaveLength(60);
  });

  it("say where a link goes by kind, and as a template inside the app", () => {
    const base = "https://habita.ar/panel";
    expect(linkTarget("/panel/propiedades/8fac7831-e2be-4dbd-bfa3-c8e55a32fae3", base)).toEqual({ href_kind: "internal", ui_destination: "/panel/propiedades/:id" });
    expect(linkTarget("https://wa.me/5491155555555?text=hola", base)).toEqual({ href_kind: "whatsapp" });
    expect(linkTarget("https://www.zonaprop.com.ar/aviso", base)).toEqual({ href_kind: "external", ui_destination: "www.zonaprop.com.ar" });
    expect(linkTarget("mailto:a@b.c", base)).toEqual({ href_kind: "email" });
    expect(linkTarget("#contacto", base)).toEqual({ href_kind: "anchor", ui_destination: "#contacto" });
  });
});
