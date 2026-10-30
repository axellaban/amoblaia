// Compares image models / quality levels on the same photos: time, tokens, cost
// and a side-by-side HTML page to judge how faithful each result is.
//
//   OPENAI_API_KEY=... node --experimental-strip-types scripts/benchmark-models.ts \
//     --out=bench public/ejemplos/living-before.webp:living public/ejemplos/kitchen-before.webp:kitchen
//
// Options:
//   --configs=gpt-image-2.5-sunburst:high,gpt-image-2.5-sunburst:medium,gpt-image-2.5-flare:high
//   --style=modern   (any style id from src/lib/catalog.ts)
//   --dry            check the plan and prompts without calling the API
//
// Each photo runs every config in parallel (like a real batch); photos run one
// after another. Existing results are reused, so an interrupted run can resume.
// Writes the input and result images plus <out>/results.json and <out>/summary.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import sharp from "sharp";
import { buildPrompt, rooms, styles } from "../src/lib/catalog.ts";

// USD per 1M tokens, same for Sunburst and Flare (OpenAI model pages).
const RATES = { text: 5, image: 8, output: 30 };

const args = process.argv.slice(2);
const flag = (name: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const dry = args.includes("--dry");
const style = flag("style") ?? "modern";
const outDir = flag("out") ?? "bench";
const configs = (
  flag("configs") ??
  "gpt-image-2.5-sunburst:high,gpt-image-2.5-sunburst:medium,gpt-image-2.5-flare:high"
)
  .split(",")
  .map((c) => {
    const [model, quality] = c.split(":");
    if (!model || !quality) throw new Error(`Use model:quality (got "${c}")`);
    return { model, quality, id: `${model.replace("gpt-image-", "")}-${quality}` };
  });
const photos = args
  .filter((a) => !a.startsWith("--"))
  .map((a) => {
    const [file, room] = a.split(":");
    if (!file || !rooms.some((r) => r.id === room))
      throw new Error(
        `Use file:room with a room in ${rooms.map((r) => r.id).join(", ")} (got "${a}")`,
      );
    return { file, room, name: basename(file, extname(file)) };
  });
if (!styles.some((s) => s.id === style)) throw new Error(`Unknown style "${style}"`);
if (!photos.length) throw new Error("Pass at least one file:room");
const key = process.env.OPENAI_API_KEY;
if (!key && !dry) throw new Error("OPENAI_API_KEY is missing");
mkdirSync(outDir, { recursive: true });

type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { text_tokens?: number; image_tokens?: number };
};
type Row = {
  photo: string;
  room: string;
  config: string;
  model: string;
  quality: string;
  file?: string;
  seconds?: number;
  usage?: Usage | null;
  usd?: number | null;
  error?: string;
};

const resultsPath = join(outDir, "results.json");
const previous: Row[] = existsSync(resultsPath)
  ? JSON.parse(readFileSync(resultsPath, "utf8"))
  : [];
const rows: Row[] = [];

function cost(u?: Usage | null) {
  if (!u || typeof u.output_tokens !== "number") return null;
  const text = u.input_tokens_details?.text_tokens ?? 0;
  const image = u.input_tokens_details?.image_tokens ?? (u.input_tokens ?? 0) - text;
  return (text * RATES.text + image * RATES.image + u.output_tokens * RATES.output) / 1e6;
}

async function render(image: Buffer, prompt: string, model: string, quality: string) {
  // Same request the app sends in src/lib/commerce/images.ts.
  const body = new FormData();
  body.set("model", model);
  body.set("image", new Blob([new Uint8Array(image)], { type: "image/jpeg" }), "room.jpg");
  body.set("prompt", prompt);
  body.set("n", "1");
  body.set("quality", quality);
  body.set("size", "auto");
  body.set("output_format", "jpeg");
  body.set("output_compression", "94");
  if (["gpt-image-1", "gpt-image-1.5"].includes(model)) body.set("input_fidelity", "high");
  const started = performance.now();
  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body,
    signal: AbortSignal.timeout(300000),
  });
  if (!response.ok) throw new Error(`${response.status} ${(await response.text()).slice(0, 300)}`);
  const payload = (await response.json()) as { data?: { b64_json?: string }[]; usage?: Usage };
  const seconds = (performance.now() - started) / 1000;
  const b64 = payload.data?.[0]?.b64_json;
  if (!b64) throw new Error("the provider returned no image");
  return { image: Buffer.from(b64, "base64"), seconds, usage: payload.usage ?? null };
}

for (const photo of photos) {
  const prompt = buildPrompt(photo.room, style, "furnish", "");
  const input = await sharp(photo.file, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 94 })
    .toBuffer();
  writeFileSync(join(outDir, `${photo.name}.jpg`), input);
  await Promise.all(
    configs.map(async (c) => {
      const file = `${photo.name}--${c.id}.jpg`;
      const base: Row = { photo: photo.name, room: photo.room, config: c.id, model: c.model, quality: c.quality };
      const done = previous.find((r) => r.photo === photo.name && r.config === c.id && r.file);
      if (done && existsSync(join(outDir, file))) {
        rows.push(done);
        console.log("skip", file);
        return;
      }
      if (dry) {
        console.log(`dry ${photo.file} -> ${file} (${photo.room}, ${style}, ${c.model}, ${c.quality})`);
        return;
      }
      try {
        const r = await render(input, prompt, c.model, c.quality);
        writeFileSync(
          join(outDir, file),
          await sharp(r.image).resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 94 }).toBuffer(),
        );
        const row = { ...base, file, seconds: r.seconds, usage: r.usage, usd: cost(r.usage) };
        rows.push(row);
        console.log(`ok ${file} ${r.seconds.toFixed(1)}s ${row.usd != null ? "$" + row.usd.toFixed(3) : ""}`);
      } catch (e) {
        rows.push({ ...base, error: (e as Error).message });
        console.error(`fail ${file}: ${(e as Error).message}`);
      }
      writeFileSync(resultsPath, JSON.stringify(rows, null, 2));
    }),
  );
  if (dry) console.log(prompt, "\n");
}
if (dry) process.exit(0);
writeFileSync(resultsPath, JSON.stringify(rows, null, 2));

// Summary per config: median and max time, average cost, failures.
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
};
const summary = configs.map((c) => {
  const ok = rows.filter((r) => r.config === c.id && r.seconds != null);
  const usd = ok.map((r) => r.usd).filter((x): x is number => x != null);
  return {
    ...c,
    runs: ok.length,
    failures: rows.filter((r) => r.config === c.id && r.error).length,
    medianSeconds: median(ok.map((r) => r.seconds!)),
    maxSeconds: Math.max(...ok.map((r) => r.seconds!)),
    avgUsd: usd.length ? usd.reduce((a, b) => a + b, 0) / usd.length : null,
  };
});
console.table(summary.map((s) => ({
  config: s.id,
  runs: s.runs,
  fails: s.failures,
  "median s": s.medianSeconds.toFixed(1),
  "max s": s.maxSeconds.toFixed(1),
  "avg USD": s.avgUsd?.toFixed(3) ?? "-",
})));
writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
console.log(`\nResults in ${outDir}/results.json and ${outDir}/summary.json`);
