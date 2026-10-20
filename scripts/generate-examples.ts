// Generates the home page example scenes in public/ejemplos with the same
// prompt the studio uses, so the examples show what the product delivers.
//
//   node --experimental-strip-types scripts/generate-examples.ts --room=living
//   node --experimental-strip-types scripts/generate-examples.ts            (all rooms)
//
// Needs OPENAI_API_KEY. Existing files are skipped, so a run can be resumed.
import { existsSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { buildPrompt } from "../src/lib/catalog.ts";
import { exampleRooms, exampleStyles } from "../src/lib/examples.ts";

const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2.5-sunburst";
const key = process.env.OPENAI_API_KEY;
if (!key) throw new Error("OPENAI_API_KEY is missing");

const emptyRooms: Record<string, string> = {
  living:
    "an empty living room of a Buenos Aires apartment with oak parquet floor, white walls and a large aluminium sliding door to a small balcony",
  bedroom:
    "an empty bedroom of a Buenos Aires apartment with oak parquet floor, a built-in white wardrobe and a window with roller blind box",
  kitchen:
    "an empty kitchen of an Argentine apartment with white lower and upper cabinets, a granite countertop, a built-in stove and a window, with no table, stools or decoration",
  office:
    "a small empty spare room of an Argentine apartment with parquet floor, white walls and a window with daylight, suitable for a home office",
  outdoor:
    "an empty covered terrace of an Argentine house with ceramic floor tiles, a white parapet and trees in the background",
  dining:
    "an empty dining area of an Argentine apartment with porcelain floor tiles, white walls, a window and a ceiling light point",
};

const only = process.argv.find((a) => a.startsWith("--room="))?.slice(7);
const out = (room: string, style: string) =>
  `public/ejemplos/${room}-${style}.webp`;

async function save(path: string, b64: string) {
  const webp = await sharp(Buffer.from(b64, "base64"))
    .resize({ width: 1440, withoutEnlargement: true })
    .webp({ quality: 88 })
    .toBuffer();
  writeFileSync(path, webp);
  console.log("saved", path, `${Math.round(webp.length / 1024)} KB`);
}

async function call(endpoint: string, body: FormData | string) {
  const response = await fetch(`https://api.openai.com/v1/images/${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      ...(typeof body === "string" ? { "Content-Type": "application/json" } : {}),
    },
    body,
    signal: AbortSignal.timeout(300000),
  });
  if (!response.ok)
    throw new Error(`${endpoint} ${response.status}: ${await response.text()}`);
  const payload = (await response.json()) as { data: { b64_json: string }[] };
  return payload.data[0].b64_json;
}

for (const room of exampleRooms.filter((r) => !only || r === only)) {
  const before = out(room, "before");
  if (!existsSync(before)) {
    const prompt = `Photorealistic real-estate photograph of ${emptyRooms[room]}. Completely unfurnished, no people, no text. Natural daylight, eye-level wide-angle shot with straight verticals, as taken by a professional listing photographer.`;
    await save(
      before,
      await call(
        "generations",
        JSON.stringify({ model, prompt, size: "1536x1024", quality: "high" }),
      ),
    );
  }
  const source = await sharp(before).jpeg({ quality: 94 }).toBuffer();
  for (const style of exampleStyles) {
    const path = out(room, style);
    if (existsSync(path)) continue;
    const body = new FormData();
    body.set("model", model);
    body.set("image", new Blob([new Uint8Array(source)], { type: "image/jpeg" }), "room.jpg");
    body.set("prompt", buildPrompt(room, style, "furnish", ""));
    body.set("quality", "high");
    body.set("size", "1536x1024");
    await save(path, await call("edits", body));
  }
}
