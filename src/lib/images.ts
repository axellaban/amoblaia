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
/** The design as a JPG, with its label or side by side with the original. */
async function renderDesign(
  result: string,
  name: string,
  original?: string,
  label = true,
) {
  const images = await Promise.all([
    loadImage(result),
    ...(original ? [loadImage(original)] : []),
  ]);
  const width = images[0].naturalWidth;
  const height = images[0].naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = original ? width * 2 : width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No pudimos preparar la descarga.");
  if (original) {
    ctx.drawImage(images[1], 0, 0, width, height);
    ctx.drawImage(images[0], width, 0, width, height);
  } else ctx.drawImage(images[0], 0, 0, width, height);
  if (label || original) {
    const size = Math.max(16, Math.round(width / 65));
    ctx.font = `500 ${size}px Arial`;
    ctx.fillStyle = "rgba(22,28,46,.82)";
    ctx.fillRect(0, height - size * 3, canvas.width, size * 3);
    ctx.fillStyle = "#fff";
    ctx.fillText(
      original ? "Original" : "Amoblamiento virtual · amoblaIA",
      size,
      height - size,
    );
    if (original)
      ctx.fillText(
        "Amoblamiento virtual · amoblaIA",
        width + size,
        height - size,
      );
  }
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.95),
  );
  if (!blob) throw new Error("No pudimos exportar la imagen.");
  return new File(
    [blob],
    `amoblaia-${name.replace(/[^a-z0-9áéíóúñ-]/gi, "-")}${original ? "-comparacion" : ""}.jpg`,
    { type: "image/jpeg" },
  );
}
function save(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function downloadDesign(
  result: string,
  name: string,
  original?: string,
  label = true,
) {
  save(await renderDesign(result, name, original, label));
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
export async function shareDesign(
  result: string,
  name: string,
  original?: string,
  label = true,
) {
  const file = await renderDesign(result, name, original, label);
  try {
    await navigator.share({ files: [file] });
  } catch (e) {
    // Closing the sheet is a choice, not an error.
    if (e instanceof Error && e.name === "AbortError") return;
    save(file);
  }
}
