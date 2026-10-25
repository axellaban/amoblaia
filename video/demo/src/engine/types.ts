export type Box = { x: number; y: number; w: number; h: number };
export type Point = { x: number; y: number };

/** Una captura de la interfaz real (src a 2x; medidas y cajas en px CSS). */
export type Shot = {
  src: string;
  w: number;
  h: number;
  boxes: Record<string, Box>;
};
export type ShotsFile = { shots: Record<string, Shot> };

export type Format = "landscape" | "portrait";

export type Theme = {
  /** Fondo del video (detrás de la ventana). */
  bg: string;
  /** Segundo color del degradé del fondo. */
  bg2: string;
  /** Color de acento (resaltados, clics, pasos). */
  accent: string;
  /** Texto sobre el fondo. */
  ink: string;
  /** Texto secundario sobre el fondo. */
  muted: string;
  /** Superficie de los subtítulos. */
  pill: string;
  pillInk: string;
  /** Círculo del número de paso. */
  step: string;
  stepInk: string;
  font: string;
  display: string;
  /** El fondo es oscuro: la barra del navegador y las sombras se adaptan. */
  dark: boolean;
};

export const center = (b: Box): Point => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
