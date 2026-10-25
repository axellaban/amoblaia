// Renderiza los videos: node scripts/render.mjs <proyecto> [horizontal|vertical]
// Antes: node scripts/fetch-music.mjs (baja la música, que no va en el repo).
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

const [project, only] = process.argv.slice(2);
// Remotion baja su propio Chrome; en los entornos de Claude Code se usa el que ya está instalado.
const PREINSTALLED = "/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell";
const browserExecutable = process.env.REMOTION_CHROME || (fs.existsSync(PREINSTALLED) ? PREINSTALLED : null);
const formats = only ? [only] : ["horizontal", "vertical"];
fs.mkdirSync("out", { recursive: true });
const serveUrl = await bundle({ entryPoint: path.resolve("src/index.ts") });
for (const fmt of formats) {
  const id = `${project}-${fmt}`;
  const composition = await selectComposition({ serveUrl, id, browserExecutable });
  const outputLocation = `out/${id}.mp4`;
  const raw = `out/${id}.raw.mp4`;
  const t0 = Date.now();
  let last = -1;
  await renderMedia({
    serveUrl,
    composition,
    codec: "h264",
    crf: 20,
    pixelFormat: "yuv420p",
    audioCodec: "aac",
    audioBitrate: "192k",
    outputLocation: raw,
    browserExecutable,
    timeoutInMilliseconds: 120000,
    concurrency: Number(process.env.CONCURRENCY || 4),
    onProgress: ({ progress }) => {
      const p = Math.floor(progress * 10);
      if (p !== last) {
        last = p;
        process.stdout.write(`${id} ${p * 10}%\n`);
      }
    },
  });
  // Volumen parejo entre videos: -14 LUFS, el estándar de las redes. El video no se recodifica.
  execFileSync("npx", ["remotion", "ffmpeg", "-y", "-v", "error", "-i", raw, "-c:v", "copy", "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-ar", "48000", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", outputLocation], { stdio: "inherit" });
  fs.rmSync(raw);
  console.log(`✓ ${outputLocation} en ${Math.round((Date.now() - t0) / 1000)} s`);
}
