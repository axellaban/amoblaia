import { useVideoConfig } from "remotion";
import type { Format } from "./types";

export function useFormat(): Format {
  const { width, height } = useVideoConfig();
  return height > width ? "portrait" : "landscape";
}

/** Dónde va la ventana del navegador en cada formato (px del video). */
export function windowRect(format: Format) {
  if (format === "landscape") {
    // 1504 px de ancho = la página de 1440 px CSS a escala 1,044.
    return { x: (1920 - 1504) / 2, y: 46, w: 1504, h: 980, bar: 40, baseScale: 1504 / 1440 };
  }
  // En vertical se ve un recorte de ~720 px CSS de ancho y la cámara sigue la acción.
  return { x: 48, y: 450, w: 984, h: 1150, bar: 44, baseScale: 984 / 720 };
}
