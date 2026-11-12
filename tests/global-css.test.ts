import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// A rule left open (for example after resolving a merge conflict) silently
// swallows every rule after it: the browser drops them and whole sections lose
// their styles. Comments are ignored; the stylesheet has no braces in strings.
describe("globals.css", () => {
  it("closes every block it opens, in order", () => {
    const css = readFileSync("src/app/globals.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    let depth = 0;
    let line = 1;
    for (const ch of css) {
      if (ch === "\n") line++;
      if (ch === "{") depth++;
      if (ch === "}") depth--;
      expect(depth, `cierre de más en la línea ${line}`).toBeGreaterThanOrEqual(0);
    }
    expect(depth, "bloques sin cerrar").toBe(0);
  });

  it("lets the «Ambientar con IA» / «Editar con IA» mode buttons wrap instead of clipping their label", () => {
    const css = readFileSync("src/app/globals.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const rule = /\.pw-modes button \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).not.toContain("nowrap");
  });

  it("keeps the failed imports' long links inside a phone's width", () => {
    const css = readFileSync("src/app/globals.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(/\.ap-failed \{([^}]*)\}/.exec(css)?.[1] ?? "").toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(/\.ap-failed strong \{([^}]*)\}/.exec(css)?.[1] ?? "").toMatch(/overflow-wrap:\s*anywhere/);
  });

  it("tightens the header between 800 and 860px so the signed-in actions fit an upright iPad", () => {
    const css = readFileSync("src/app/globals.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const block = /@media \(max-width: 860px\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    expect(block).toMatch(/\.nav \{\s*gap: 12px;/);
    expect(block).toMatch(/\.nav-links \{\s*gap: 12px;/);
    // It must come after the last base «.nav { gap }» rule, or that rule wins at any width.
    const lastBase = Math.max(...[...css.matchAll(/^\.nav \{[^}]*gap:/gm)].map((m) => m.index ?? 0));
    expect(css.indexOf("@media (max-width: 860px)")).toBeGreaterThan(lastBase);
  });

  // QA 2026-11-12 am: /admin/inmobiliarias scrolled sideways on an upright iPad.
  it("lets the admin funnel chart scroll inside its card instead of widening the page", () => {
    const css = readFileSync("src/app/globals.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const base = /^\.ah-dfunnel \{([^}]*)\}/m.exec(css)?.[1] ?? "";
    expect(base).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  });
});
