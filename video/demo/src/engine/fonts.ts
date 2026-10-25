import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

/** Carga una familia desde public/fonts (archivos de @fontsource, licencia OFL). */
export function localFont(family: string, file: string, weights: number[]) {
  for (const w of weights) {
    loadFont({ family, url: staticFile(`fonts/${file}-latin-${w}-normal.woff2`), weight: String(w) }).catch(() => {});
  }
  return `"${family}", system-ui, sans-serif`;
}
