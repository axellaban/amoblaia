import { createHash } from "node:crypto";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { normalizePhoto, compactStaging } = await import("@/lib/commerce/images");

// A noisy photo-like image: flat colors would compress to nothing and prove little.
async function photo(width: number, height: number) {
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 37 + ((i / 3) % width) * 3 + Math.floor(i / (width * 3))) % 256;
  return sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
}

describe("compresión de las fotos", () => {
  it("la foto sin staging queda en 1600 px y pesa menos, con la misma huella de antes", async () => {
    const source = await photo(3000, 2000);
    const { image, hash } = await normalizePhoto(source);
    const meta = await sharp(image).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(1600);
    const legacy = await sharp(source).rotate().resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 94 }).toBuffer();
    expect(hash).toBe(createHash("sha256").update(legacy).digest("hex"));
    expect(image.length).toBeLessThan(legacy.length / 2);
  });
  it("el staging conserva su tamaño", async () => {
    const staging = await sharp(await photo(1536, 1024)).jpeg({ quality: 94 }).toBuffer();
    const out = await compactStaging(staging);
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height]).toEqual([1536, 1024]);
    expect(out.length).toBeLessThan(staging.length);
  });
});
