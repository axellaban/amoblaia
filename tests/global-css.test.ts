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
});
