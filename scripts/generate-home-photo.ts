// Generates the photo of the home page's closing call to action.
//
//   node --experimental-strip-types scripts/generate-home-photo.ts
//
// Needs OPENAI_API_KEY. An existing file is kept.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const out = "public/home/cierre.webp";
const key = process.env.OPENAI_API_KEY;
if (!key) throw new Error("OPENAI_API_KEY is missing");
if (existsSync(out)) process.exit(0);
const response = await fetch("https://api.openai.com/v1/images/generations", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-2.5-sunburst",
    size: "1024x1024",
    quality: "high",
    prompt:
      "Photorealistic candid photograph: a smiling Argentine real estate agent in her fifties wearing a light pink suit shakes hands with a happy couple in their thirties inside a bright, recently renovated Buenos Aires apartment with white walls, oak parquet floor and a large window. Natural daylight, shallow depth of field, warm and trustworthy mood, professional lifestyle photography, no text, no logos.",
  }),
  signal: AbortSignal.timeout(300000),
});
if (!response.ok)
  throw new Error(`${response.status}: ${await response.text()}`);
const { data } = (await response.json()) as { data: { b64_json: string }[] };
mkdirSync("public/home", { recursive: true });
const webp = await sharp(Buffer.from(data[0].b64_json, "base64"))
  .resize({ width: 1120, withoutEnlargement: true })
  .webp({ quality: 86 })
  .toBuffer();
writeFileSync(out, webp);
console.log("saved", out, `${Math.round(webp.length / 1024)} KB`);
