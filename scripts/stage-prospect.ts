// Virtually stages real listing photos with the studio prompt, e.g. as a sample
// for a real-estate agency. Uses "medium" quality like free and cost-saving paid runs.
//
//   node --experimental-strip-types scripts/stage-prospect.ts \
//     --out=staged photos/3.jpg:kitchen photos/4.jpg:living photos/5.jpg:living
//   add --style=scandinavian to change the style (default: modern) and --dry to
//   check the plan and the prompts without calling the API.
//
// Needs OPENAI_API_KEY. Existing results are skipped, so a run can be resumed.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import sharp from "sharp";
import { buildPrompt, rooms, styles } from "../src/lib/catalog.ts";

const args = process.argv.slice(2);
const flag = (name: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const dry = args.includes("--dry");
const style = flag("style") ?? "modern";
const outDir = flag("out") ?? "staged";
const jobs = args
  .filter((a) => !a.startsWith("--"))
  .map((a) => {
    const [file, room] = a.split(":");
    if (!file || !rooms.some((r) => r.id === room))
      throw new Error(
        `Use file:room with a room in ${rooms.map((r) => r.id).join(", ")} (got "${a}")`,
      );
    return { file, room };
  });
if (!styles.some((s) => s.id === style)) throw new Error(`Unknown style "${style}"`);
if (!jobs.length) throw new Error("Pass at least one file:room");

const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2.5-sunburst";
const key = process.env.OPENAI_API_KEY;
if (!key && !dry) throw new Error("OPENAI_API_KEY is missing");
mkdirSync(outDir, { recursive: true });

for (const { file, room } of jobs) {
  const path = join(outDir, `${basename(file, extname(file))}-${room}-${style}.jpg`);
  if (existsSync(path)) {
    console.log("skip", path);
    continue;
  }
  const prompt = buildPrompt(room, style, "furnish", "");
  const image = await sharp(file, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 94 })
    .toBuffer();
  if (dry) {
    console.log(`dry ${file} -> ${path} (${room}, ${style}, medium, ${model})\n${prompt}\n`);
    continue;
  }
  const body = new FormData();
  body.set("model", model);
  body.set("image", new Blob([new Uint8Array(image)], { type: "image/jpeg" }), "room.jpg");
  body.set("prompt", prompt);
  body.set("n", "1");
  body.set("quality", "medium");
  body.set("size", "auto");
  body.set("output_format", "jpeg");
  body.set("output_compression", "94");
  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body,
    signal: AbortSignal.timeout(270000),
  });
  if (!response.ok)
    throw new Error(`${file}: ${response.status} ${await response.text()}`);
  const payload = (await response.json()) as { data?: { b64_json?: string }[] };
  const b64 = payload.data?.[0]?.b64_json;
  if (!b64) throw new Error(`${file}: the provider returned no image`);
  const result = await sharp(Buffer.from(b64, "base64"), { limitInputPixels: 40_000_000 })
    .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 94 })
    .toBuffer();
  writeFileSync(path, result);
  console.log("saved", path, `${Math.round(result.length / 1024)} KB`);
}
