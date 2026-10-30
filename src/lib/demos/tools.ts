// The AI tools on a demo photo: a clear sky, dusk, and removing objects
// (painted on the photo). Each is one generation through the regular engine,
// saved as a version of the photo. Pure, so the editor and the server agree.

export const TOOLS = ["sky", "dusk", "remove"] as const;
export type Tool = (typeof TOOLS)[number];

export const TOOL_NAMES: Record<Tool, string> = {
  sky: "Cielo despejado",
  dusk: "Atardecer",
  remove: "Sin objetos",
};

export const validTool = (value: unknown): value is Tool => typeof value === "string" && (TOOLS as readonly string[]).includes(value);

/** The instruction for the image model. Architecture stays as it is in every tool. */
export function toolPrompt(tool: Tool) {
  const keep = "Keep every building, window, balcony, wall, floor, furniture and object, and the exact camera perspective, unchanged. Do not add people, text, logos or watermarks. Photorealistic real-estate photography.";
  switch (tool) {
    case "sky":
      return `Edit this exact real-estate photograph: replace only the visible sky with a clear, natural blue sky with soft, realistic light. ${keep}`;
    case "dusk":
      return `Convert the lighting of this exact real-estate photograph from daytime to realistic early dusk. Use a gentle blue-hour sky only where an existing sky is visible, and believable warm illumination only from existing light fixtures and windows. ${keep} Do not add lamps, stars or new features.`;
    case "remove":
      return `Remove the objects inside the masked area of this exact real-estate photograph and reconstruct the surfaces behind them naturally, matching the surrounding materials, light and perspective. Change nothing outside the mask. ${keep}`;
  }
}

/** A mask sent by the editor: a data URL of a PNG, at most 6 MB. */
export function parseMaskUrl(value: unknown): Buffer | null {
  if (typeof value !== "string") return null;
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match || match[1].length > 8_000_000) return null;
  return Buffer.from(match[1], "base64");
}
