// Draws the brand images from the mark in src/lib/brand.ts: favicon, Apple
// icon, public/brand files and the free-tier watermark.
//
//   node --experimental-strip-types scripts/generate-brand.ts
//
// The wordmark is set in Outfit, downloaded from Google Fonts like next/font.
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BRAND, markSvg } from "../src/lib/brand.ts";

// librsvg finds fonts through fontconfig, so Outfit goes in a config of its
// own, without system fonts to fall back on, before sharp loads.
const fonts = join(tmpdir(), "amoblaia-outfit");
mkdirSync(fonts, { recursive: true });
const css = await fetch(
  "https://fonts.googleapis.com/css2?family=Outfit:wght@500;600;800",
).then((r) => r.text());
const files = [...css.matchAll(/src: url\((.+?\.ttf)\)/g)].map((m) => m[1]);
if (files.length !== 3) throw new Error("Outfit is not available as TTF");
for (const [i, url] of files.entries())
  writeFileSync(
    join(fonts, `Outfit-${i}.ttf`),
    Buffer.from(await (await fetch(url)).arrayBuffer()),
  );
writeFileSync(
  join(fonts, "fonts.conf"),
  `<?xml version="1.0"?><fontconfig><dir>${fonts}</dir><cachedir>${fonts}/cache</cachedir></fontconfig>`,
);
process.env.FONTCONFIG_FILE = join(fonts, "fonts.conf");
const { default: sharp } = await import("sharp");

/** The mark at `size` px, placed inside a larger drawing. */
const place = (svg: string, x: number, y: number, size: number) =>
  svg.replace(
    "<svg ",
    `<svg x="${x}" y="${y}" width="${size}" height="${size}" `,
  );
const svg = (w: number, h: number, body: string) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`,
  );
/** Bounding box of what `body` paints, drawn with its origin at (0, 0). */
async function ink(body: string) {
  const pad = 2000;
  const { info } = await sharp(
    svg(
      2 * pad,
      2 * pad,
      `<g transform="translate(${pad} ${pad})">${body}</g>`,
    ),
  )
    .trim()
    .toBuffer({ resolveWithObject: true });
  const left = -(info.trimOffsetLeft ?? 0) - pad;
  const top = -(info.trimOffsetTop ?? 0) - pad;
  return { left, top, width: info.width, height: info.height };
}
/** "amoblaIA" with its baseline at y, set like the header's `.logo`. */
async function wordmark(
  x: number,
  y: number,
  size: number,
  color: string,
  ai: string,
) {
  const amobla = `<text font-family="Outfit" font-size="${size}" font-weight="600" letter-spacing="${-0.03 * size}" fill="${color}">amobla</text>`;
  const ia = `<text font-family="Outfit" font-size="${0.78 * size}" font-weight="800" letter-spacing="${0.0156 * size}" fill="${ai}">IA</text>`;
  const [a, i] = [await ink(amobla), await ink(ia)];
  // The header leaves 1/6 em between the last "a" and the "I".
  const dx = a.left + a.width + size / 6 - i.left;
  return `<g transform="translate(${x} ${y})">${amobla}<g transform="translate(${dx} 0)">${ia}</g></g>`;
}
/** Mark and wordmark side by side, with the header's proportions. */
async function lockup(
  size: number,
  color: string,
  ai: string,
  mark = markSvg(),
) {
  const icon = (size * 4) / 3;
  // Text centered on the mark: Outfit's ascenders reach 0.71em.
  return `${place(mark, 0, -icon / 2, icon)}${await wordmark(icon + 0.37 * size, 0.355 * size, size, color, ai)}`;
}
/** Scales and centers `body` in a w×h box, leaving `pad` around it. */
async function fit(body: string, w: number, h: number, pad: number) {
  const box = await ink(body);
  const k = Math.min((w - 2 * pad) / box.width, (h - 2 * pad) / box.height);
  const x = (w - box.width * k) / 2 - box.left * k;
  const y = (h - box.height * k) / 2 - box.top * k;
  return `<g transform="translate(${x} ${y}) scale(${k})">${body}</g>`;
}

const icon = markSvg();
writeFileSync("src/app/icon.svg", `${icon}\n`);
writeFileSync("public/brand/amoblaia-isotipo.svg", `${icon}\n`);
// iOS rounds the corners itself.
await sharp(Buffer.from(place(markSvg({ tile: "square" }), 0, 0, 180)))
  .png()
  .toFile("src/app/apple-icon.png");
await sharp(Buffer.from(place(icon, 0, 0, 512)))
  .png()
  .toFile("public/brand/amoblaia-isotipo-512.png");
for (const [file, background, color, ai] of [
  ["claro", BRAND.white, BRAND.ink, BRAND.blue],
  ["oscuro", BRAND.navy, BRAND.white, BRAND.lime],
]) {
  const body = await fit(await lockup(100, color, ai), 596, 200, 40);
  await sharp(
    svg(
      596,
      200,
      `<rect width="100%" height="100%" fill="${background}"/>${body}`,
    ),
  )
    .png()
    .toFile(`public/brand/amoblaia-logo-fondo-${file}.png`);
}

// Free-tier watermark: white outline mark, wordmark and notice at 55% with a
// soft shadow, so the room can still be judged. images.ts scales it to half
// of each result's width.
const white = markSvg({ tile: false, color: BRAND.white });
const notice = `<text x="0" y="0" font-family="Outfit" font-size="40" font-weight="500" fill="${BRAND.white}">Versión gratuita · amoblaia.vercel.app</text>`;
const brand = await lockup(100, BRAND.white, BRAND.white, white);
const top = await ink(brand);
const bottom = await ink(notice);
const lines = `<g transform="translate(${-top.left - top.width / 2} 0)">${brand}</g><g transform="translate(${-bottom.left - bottom.width / 2} ${top.top + top.height + 34 - bottom.top})">${notice}</g>`;
const mark = await sharp(
  svg(
    1000,
    314,
    `<filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="2" stdDeviation="5" flood-color="#000" flood-opacity="0.5"/></filter><g opacity="0.55" filter="url(#s)">${await fit(lines, 1000, 314, 24)}</g>`,
  ),
)
  .toColourspace("b-w")
  .png({ compressionLevel: 9 })
  .toBuffer();
writeFileSync(
  "src/lib/commerce/watermark.ts",
  `// Free-tier watermark: white amoblaIA mark, wordmark and notice at 55% opacity with a soft
// shadow, so the result can still be judged. Drawn by scripts/generate-brand.ts and embedded so
// the server never depends on fonts.
export const WATERMARK_PNG = Buffer.from(
  "${mark.toString("base64")}",
  "base64",
);
`,
);
console.log("saved favicon, Apple icon, public/brand and watermark");
