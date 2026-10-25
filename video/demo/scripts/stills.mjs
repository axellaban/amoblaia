// Renderiza cuadros sueltos para revisar: node scripts/stills.mjs <composición> <cuadro,cuadro,...> [carpeta]
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import path from "node:path";
import fs from "node:fs";

const [id, frames, outDir = "out/stills"] = process.argv.slice(2);
// Remotion baja su propio Chrome; en los entornos de Claude Code se usa el que ya está instalado.
const PREINSTALLED = "/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell";
const browserExecutable = process.env.REMOTION_CHROME || (fs.existsSync(PREINSTALLED) ? PREINSTALLED : null);
fs.mkdirSync(outDir, { recursive: true });
const serveUrl = await bundle({ entryPoint: path.resolve("src/index.ts") });
const comp = await selectComposition({ serveUrl, id, browserExecutable });
console.log(`${id}: ${comp.durationInFrames} cuadros`);
for (const fr of frames.split(",").map(Number)) {
  const output = path.join(outDir, `${id}-${String(fr).padStart(4, "0")}.jpg`);
  await renderStill({ serveUrl, composition: comp, frame: fr, output, imageFormat: "jpeg", jpegQuality: 85, browserExecutable });
  console.log("  " + output);
}
