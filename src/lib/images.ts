import { comparisonLayout, type Orientation, type Rect } from "./comparison-layout";
import { ORIGINAL_TITLE, PROPOSAL_TITLE } from "./disclosure";
export function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("No pudimos leer la imagen."));
    reader.readAsDataURL(blob);
  });
}
export async function optimizePhoto(file: File) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error("Usá una foto JPG, PNG o WebP.");
  if (file.size > 10 * 1024 * 1024)
    throw new Error("La foto supera los 10 MB. Elegí una más liviana.");
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 40_000_000)
      throw new Error(
        "La resolución es demasiado grande. Usá una foto de hasta 40 megapíxeles.",
      );
    if (Math.min(bitmap.width, bitmap.height) < 256)
      throw new Error(
        "La foto es muy pequeña. Usá una imagen de al menos 256 píxeles por lado.",
      );
    const ratio = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * ratio);
    canvas.height = Math.round(bitmap.height * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Tu navegador no pudo procesar esta imagen.");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) =>
          b ? resolve(b) : reject(new Error("No pudimos optimizar la foto.")),
        "image/jpeg",
        0.9,
      ),
    );
    if (blob.size > 2.8 * 1024 * 1024)
      throw new Error(
        "La imagen sigue siendo demasiado pesada. Reducí su resolución y volvé a subirla.",
      );
    return {
      // Keeps the user's file name: the project is named after it.
      file: new File(
        [blob],
        `${file.name.replace(/\.[^.]+$/, "").slice(0, 100) || "room"}.jpg`,
        { type: "image/jpeg" },
      ),
      url: await blobToDataURL(blob),
    };
  } finally {
    bitmap.close();
  }
}
/** A small copy for previews: a 2048 px photo costs ~12 MB of memory to show. */
export async function thumbnail(file: Blob, width = 480) {
  const bitmap = await createImageBitmap(file);
  try {
    const ratio = Math.min(1, width / bitmap.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * ratio);
    canvas.height = Math.round(bitmap.height * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("NO_CANVAS");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("NO_THUMBNAIL"))),
        "image/jpeg",
        0.8,
      ),
    );
  } finally {
    bitmap.close();
  }
}
async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("No pudimos preparar la descarga."));
    img.src = src;
  });
}
const FONT = "Outfit, 'Helvetica Neue', Arial, sans-serif";
/**
 * The disclosure pill, drawn by code over the bottom-left corner of a staged
 * image. It shrinks to fit narrow photos instead of being cut.
 */
function drawLabel(ctx: CanvasRenderingContext2D, text: string, area: Rect) {
  const margin = Math.round(Math.max(10, area.width * 0.018));
  let size = Math.max(13, Math.round(area.width / 46));
  ctx.font = `600 ${size}px ${FONT}`;
  const room = area.width - margin * 2 - size * 1.6;
  const measured = ctx.measureText(text).width;
  if (measured > room) {
    size = Math.max(9, Math.floor((size * room) / measured));
    ctx.font = `600 ${size}px ${FONT}`;
  }
  const width = ctx.measureText(text).width + size * 1.6;
  const height = size * 2;
  const x = area.x + margin;
  const y = area.y + area.height - margin - height;
  ctx.fillStyle = "rgba(15,19,35,.8)";
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, width, height, height / 2);
  else ctx.rect(x, y, width, height);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + size * 0.8, y + height / 2 + 1);
}
async function toFile(canvas: HTMLCanvasElement, name: string) {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.93),
  );
  if (!blob) throw new Error("No pudimos exportar la imagen.");
  return new File([blob], name, { type: "image/jpeg" });
}
const safeName = (name: string) =>
  name.replace(/[^a-z0-9áéíóúñ-]/gi, "-").slice(0, 80) || "ambiente";
export type ExportKind = "original" | "proposal" | Orientation;
export type ExportInput = {
  kind: ExportKind;
  name: string;
  original?: string;
  proposal?: string;
  /** Disclosure drawn over the proposal; null only for optional retouches. */
  label: string | null;
};
/** Builds the JPG for a download or the share sheet. Nothing is cropped. */
export async function renderExport({
  kind,
  name,
  original,
  proposal,
  label,
}: ExportInput) {
  const base = `amoblaia-${safeName(name)}`;
  if (kind === "original") {
    if (!original) throw new Error("No encontramos la foto original.");
    const response = await fetch(original);
    if (!response.ok) throw new Error("No pudimos preparar la descarga.");
    return new File([await response.blob()], `${base}-estado-actual.jpg`, {
      type: "image/jpeg",
    });
  }
  if (!proposal) throw new Error("No encontramos la propuesta.");
  if (kind === "proposal") {
    const img = await loadImage(proposal);
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No pudimos preparar la descarga.");
    ctx.drawImage(img, 0, 0);
    if (label)
      drawLabel(ctx, label, { x: 0, y: 0, width: canvas.width, height: canvas.height });
    return toFile(canvas, `${base}-propuesta.jpg`);
  }
  if (!original) throw new Error("No encontramos la foto original.");
  const [before, after] = await Promise.all([
    loadImage(original),
    loadImage(proposal),
  ]);
  const layout = comparisonLayout(
    { width: before.naturalWidth, height: before.naturalHeight },
    { width: after.naturalWidth, height: after.naturalHeight },
    kind,
  );
  const canvas = document.createElement("canvas");
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No pudimos preparar la descarga.");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const titles = [ORIGINAL_TITLE, PROPOSAL_TITLE];
  const dots = ["#8a90a3", "#2e5fcb"];
  [before, after].forEach((img, i) => {
    const t = layout.titles[i];
    const dot = layout.fontSize * 0.32;
    ctx.fillStyle = dots[i];
    ctx.beginPath();
    ctx.arc(t.x + dot, t.y + t.height / 2, dot, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#161b26";
    ctx.font = `700 ${layout.fontSize}px ${FONT}`;
    ctx.textBaseline = "middle";
    ctx.fillText(titles[i], t.x + dot * 3, t.y + t.height / 2, t.width - dot * 3);
    const p = layout.photos[i];
    ctx.drawImage(img, p.x, p.y, p.width, p.height);
  });
  if (label) drawLabel(ctx, label, layout.photos[1]);
  const f = layout.footer;
  ctx.fillStyle = "#5c6170";
  ctx.font = `400 ${Math.round(layout.fontSize * 0.55)}px ${FONT}`;
  ctx.textBaseline = "middle";
  ctx.fillText(
    "El estado actual es la foto real. La propuesta es ilustrativa: los muebles y su tamaño son orientativos.",
    f.x,
    f.y + f.height / 2,
    f.width,
  );
  return toFile(canvas, `${base}-comparativa-${kind}.jpg`);
}
function save(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function downloadExport(input: ExportInput) {
  save(await renderExport(input));
}
/** A single labelled design (used by the batch list). */
export async function downloadDesign(
  result: string,
  name: string,
  label: string | null,
) {
  await downloadExport({ kind: "proposal", name, proposal: result, label });
}
/** Whether this browser can hand images to the system share sheet. */
export function canShareImages() {
  try {
    return Boolean(
      navigator.canShare?.({
        files: [new File([""], "amoblaia.jpg", { type: "image/jpeg" })],
      }),
    );
  } catch {
    return false;
  }
}
/**
 * Opens the share sheet (WhatsApp, "Guardar imagen"…). Where the browser
 * refuses, for instance once the tap that asked for it is too old, the
 * image is downloaded instead.
 */
export async function shareExport(input: ExportInput) {
  const file = await renderExport(input);
  try {
    await navigator.share({ files: [file] });
  } catch (e) {
    // Closing the sheet is a choice, not an error.
    if (e instanceof Error && e.name === "AbortError") return;
    save(file);
  }
}
