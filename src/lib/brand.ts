// amoblaIA mark: an arched doorway with a sofa inside, plus the spark of AI.
// The header draws it from these paths and scripts/generate-brand.ts turns
// them into the favicon, Apple icon, public/brand files and the watermark.
export const BRAND = {
  blue: "#3c59bf",
  lime: "#cbff9a",
  white: "#ffffff",
  navy: "#151a2d",
  ink: "#161b26",
};
/** 40×40 grid. The doorway is a 2.6 stroke; the sofa and the spark are fills. */
export const MARK = {
  doorway: "M10 31.5V20a10 10 0 0 1 20 0v11.5M6.5 31.5h27",
  sofa: "M15 23.4a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2V26H15zM12.6 25.7a1.9 1.9 0 0 1 3.8 0v1.1h7.2v-1.1a1.9 1.9 0 0 1 3.8 0v3.7H12.6zM13.7 29.4h1.4v1.2h-1.4zM24.9 29.4h1.4v1.2h-1.4z",
  spark: "M32 4Q32 8.4 36.4 8.4Q32 8.4 32 12.8Q32 8.4 27.6 8.4Q32 8.4 32 4z",
};
/**
 * The mark as standalone SVG. `tile: "square"` fills the whole canvas, for
 * platforms that round the corners themselves; `tile: false` draws only the
 * outline in `color`, as the watermark does.
 */
export function markSvg({
  tile = "rounded",
  color,
}: { tile?: "rounded" | "square" | false; color?: string } = {}) {
  const line = color ?? BRAND.white;
  const fill = color ?? BRAND.lime;
  const back = tile
    ? `<rect width="40" height="40"${tile === "rounded" ? ' rx="11"' : ""} fill="${BRAND.blue}"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">${back}<path d="${MARK.doorway}" fill="none" stroke="${line}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><path d="${MARK.sofa}" fill="${fill}"/><path d="${MARK.spark}" fill="${fill}"/></svg>`;
}
