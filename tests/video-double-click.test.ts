// Regresión: doble clic en «Generar video» (estilo Clásico) creaba dos videos, porque `busy`
// cambia recién después de varios `await` y el segundo clic pasaba la guarda. La guarda tiene que
// ser síncrona (un ref) y soltarse al terminar. El estudio no se puede montar sin el navegador de
// video, así que se comprueba la estructura de la función.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("video-studio generate()", () => {
  const src = readFileSync("src/components/video-studio.tsx", "utf8");
  const body = /async function generate\(\) \{([\s\S]*?)\n {2}\}\n/.exec(src)?.[1] ?? "";

  it("refuses a second call while the first one is running, with a synchronous guard", () => {
    expect(src).toContain("const generating = useRef(false);");
    expect(body).toContain("generating.current");
    expect(body.indexOf("if (!plan || busy || !canEdit || generating.current) return;")).toBeGreaterThanOrEqual(0);
    expect(body.indexOf("generating.current = true")).toBeLessThan(body.indexOf("await generateClassic()"));
  });

  it("releases the guard even if the generation throws", () => {
    expect(body).toMatch(/finally \{\s*generating\.current = false;/);
  });
});
