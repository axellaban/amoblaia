import { localFont } from "../engine/fonts";
import type { Theme } from "../engine/types";

const outfit = localFont("Outfit", "outfit", [400, 500, 600, 700, 800]);
localFont("Inter", "inter", [400, 500]);
// Colores de src/app/globals.css de amoblaIA.
export const C = {
  navy: "#141a30",
  navy2: "#202740",
  lime: "#bcfd97",
  blue: "#2e5fcb",
  ink: "#161b26",
  ice: "#edf1f8",
};

export const theme: Theme = {
  bg: "#0f1426",
  bg2: C.navy2,
  accent: C.lime,
  ink: "#ffffff",
  muted: "rgba(255,255,255,.72)",
  pill: "#ffffff",
  pillInk: C.ink,
  step: C.blue,
  stepInk: "#ffffff",
  font: outfit,
  display: outfit,
  dark: true,
};
