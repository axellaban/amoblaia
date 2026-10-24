/**
 * Geometry of the downloadable comparison. Each photo keeps its own
 * proportions: it is scaled, never cropped or stretched, so the space looks
 * the way it was photographed. Pure math, shared by the canvas export and tests.
 */
export type Size = { width: number; height: number };
export type Rect = { x: number; y: number; width: number; height: number };
export type Orientation = "horizontal" | "vertical";
export type ComparisonLayout = {
  width: number;
  height: number;
  /** Title band above each photo. */
  titles: [Rect, Rect];
  photos: [Rect, Rect];
  footer: Rect;
  fontSize: number;
};

/**
 * Horizontal: both photos at the same height, side by side (posts, screens).
 * Vertical: both at the same width, one above the other (phones, WhatsApp).
 */
export function comparisonLayout(
  original: Size,
  proposal: Size,
  orientation: Orientation,
  target = orientation === "vertical" ? 1280 : 1100,
): ComparisonLayout {
  if (
    [original, proposal].some(
      (s) => !(s.width > 0 && s.height > 0 && isFinite(s.width / s.height)),
    )
  )
    throw new Error("INVALID_IMAGE_SIZE");
  const unit = orientation === "vertical" ? target : target * 1.2;
  const pad = Math.round(unit * 0.03);
  const fontSize = Math.round(unit * (orientation === "vertical" ? 0.042 : 0.03));
  const band = Math.round(fontSize * 2.1);
  const footerHeight = Math.round(fontSize * 1.9);
  const sizes = [original, proposal].map((s) =>
    orientation === "vertical"
      ? { width: target, height: Math.round((target * s.height) / s.width) }
      : { width: Math.round((target * s.width) / s.height), height: target },
  );
  const photos: Rect[] = [];
  const titles: Rect[] = [];
  let width: number, height: number;
  if (orientation === "vertical") {
    let y = pad;
    for (const s of sizes) {
      titles.push({ x: pad, y, width: s.width, height: band });
      y += band;
      photos.push({ x: pad, y, ...s });
      y += s.height + pad;
    }
    width = target + pad * 2;
    height = y + footerHeight;
  } else {
    let x = pad;
    for (const s of sizes) {
      titles.push({ x, y: pad, width: s.width, height: band });
      photos.push({ x, y: pad + band, ...s });
      x += s.width + pad;
    }
    width = x;
    height = pad + band + target + pad + footerHeight;
  }
  return {
    width,
    height,
    titles: titles as [Rect, Rect],
    photos: photos as [Rect, Rect],
    footer: { x: pad, y: height - footerHeight, width: width - pad * 2, height: footerHeight },
    fontSize,
  };
}
