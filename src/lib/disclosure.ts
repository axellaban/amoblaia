/**
 * Texts that tell a reader what is real and what was added digitally. They are
 * drawn by code on every staged image (screen, downloads and shared pages),
 * never requested from the image model.
 */
export const ORIGINAL_TITLE = "Estado actual";
export const PROPOSAL_TITLE = "Propuesta de ambientación virtual";
export const STAGING_LABEL =
  "Ambientación virtual · Mobiliario agregado digitalmente";
export const SCALE_NOTE =
  "Propuesta ilustrativa: los muebles se agregaron digitalmente y su tamaño es orientativo, no surge de medidas verificadas.";

/** Modes whose result can be reviewed and shared in a property showcase. */
export const SHOWCASE_MODES = ["furnish", "redesign"] as const;
export function isStagingMode(mode: string) {
  return (SHOWCASE_MODES as readonly string[]).includes(mode);
}

/** The label each result carries. Staging modes always carry one. */
export function disclosureFor(mode: string) {
  if (isStagingMode(mode)) return STAGING_LABEL;
  if (mode === "remove")
    return "Imagen editada digitalmente · Muebles retirados";
  if (mode === "dusk") return "Iluminación modificada digitalmente";
  return "Foto retocada digitalmente";
}

/** Retouching keeps the existing option to export without a label. */
export function labelRequired(mode: string) {
  return mode !== "enhance" && mode !== "dusk";
}
