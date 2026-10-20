export const rooms = [
  { id: "living", name: "Living", prompt: "living room", icon: "sofa" },
  { id: "bedroom", name: "Dormitorio", prompt: "bedroom", icon: "bed" },
  { id: "dining", name: "Comedor", prompt: "dining room", icon: "dining" },
  { id: "kitchen", name: "Cocina", prompt: "kitchen", icon: "kitchen" },
  { id: "office", name: "Home office", prompt: "home office", icon: "office" },
  {
    id: "outdoor",
    name: "Patio o balcón",
    prompt:
      "outdoor patio, balcony or terrace matching the photograph, weather-resistant outdoor furniture",
    icon: "outdoor",
  },
  {
    id: "studio",
    name: "Monoambiente",
    prompt:
      "compact studio apartment, sleeping and living zones defined by movable furniture only, clear circulation, no new walls",
    icon: "studio",
  },
  {
    id: "quincho",
    name: "Quincho",
    prompt:
      "Argentine quincho for casual shared meals, practical dining furniture, preserve the existing parrilla and keep access clear, never invent a grill or chimney",
    icon: "quincho",
  },
] as const;
export const styles = [
  {
    id: "modern",
    name: "Contemporáneo cálido",
    description: "Líneas simples. Mucha personalidad.",
    prompt:
      "warm contemporary Argentine residential interior, clean lines, comfortable textured fabric sofas, natural wood, warm neutrals and restrained earthy accents",
    color: "#c6b09a",
  },
  {
    id: "scandinavian",
    name: "Nórdico",
    description: "Luz, madera y calidez.",
    prompt:
      "Scandinavian, light oak, cozy textiles, soft warm neutrals, airy minimal furnishings",
    color: "#e3dac9",
  },
  {
    id: "midcentury",
    name: "Mid-century",
    description: "Diseño que nunca pasa de moda.",
    prompt:
      "mid-century modern, walnut wood, sculptural silhouettes, muted earthy accents",
    color: "#a9774d",
  },
  {
    id: "luxury",
    name: "Lujo",
    description: "Materiales nobles y detalles únicos.",
    prompt:
      "understated luxury, refined marble, brass details, premium fabrics, elegant furniture",
    color: "#7d8580",
  },
  {
    id: "coastal",
    name: "Costero",
    description: "La tranquilidad de estar cerca del mar.",
    prompt:
      "coastal, natural linen, pale blues, light wood, woven textures, relaxed airy elegance",
    color: "#b1c7cd",
  },
  {
    id: "farmhouse",
    name: "Campo contemporáneo",
    description: "Texturas naturales. Espíritu de hogar.",
    prompt:
      "contemporary Argentine country home, natural timber, woven fibers, earthy ceramics, linen and restrained rural accents, no American farmhouse signs",
    color: "#b5a58b",
  },
  {
    id: "industrial",
    name: "Industrial",
    description: "Carácter urbano, sin excesos.",
    prompt:
      "industrial loft, matte black metal, leather, reclaimed wood, urban sophisticated furniture",
    color: "#696b6a",
  },
  {
    id: "minimalist",
    name: "Minimalista",
    description: "Pocas piezas, espacio para vivir.",
    prompt:
      "warm minimalism, essential low-profile furniture, ivory and stone palette, subtle texture, clear circulation, no clutter",
    color: "#ddd7ca",
  },
  {
    id: "classic",
    name: "Clásico renovado",
    description: "Elegancia familiar, con una mirada actual.",
    prompt:
      "updated classic Argentine apartment, timeless upholstered furniture, warm wood, restrained antique accents combined with contemporary pieces, respect existing moldings without inventing any",
    color: "#bdb5a7",
  },
  {
    id: "eclectic",
    name: "Ecléctico",
    description: "Mezclá épocas, colores y piezas con carácter.",
    prompt:
      "curated eclectic Argentine interior, harmonious contemporary and vintage furniture, balanced expressive colors, tactile textiles, abstract artwork, coherent proportions, no clutter or national stereotypes",
    color: "#bb7d79",
  },
] as const;
export const demoRooms = ["living", "bedroom"] as const;
export const demoStyles = ["modern", "eclectic"] as const;
export const modes = [
  {
    id: "furnish",
    name: "Amoblar",
    description: "Sumá muebles a un espacio vacío.",
  },
  {
    id: "redesign",
    name: "Rediseñar",
    description: "Reemplazá los muebles existentes.",
  },
  {
    id: "remove",
    name: "Vaciar",
    description: "Retirá los muebles del ambiente.",
  },
  {
    id: "enhance",
    name: "Mejorar foto",
    description:
      "Ajustá exposición, color y contraste sin cambiar el ambiente.",
  },
  {
    id: "dusk",
    name: "Día a atardecer",
    description: "Transformá la iluminación diurna en una escena al atardecer.",
  },
] as const;
export type RoomId = (typeof rooms)[number]["id"];
export type StyleId = (typeof styles)[number]["id"];
export type ModeId = (typeof modes)[number]["id"];
export const beforeImage = (room: RoomId) =>
  `/ejemplos/${(demoRooms as readonly string[]).includes(room) ? room : "living"}-before.webp`;
export function afterImage(room: RoomId, style: StyleId = "modern") {
  const availableRoom = (demoRooms as readonly string[]).includes(room)
    ? room
    : "living";
  const availableStyle = (demoStyles as readonly string[]).includes(style)
    ? style
    : "modern";
  return `/ejemplos/${availableRoom}-${availableStyle}.webp`;
}
export function buildPrompt(
  roomId: string,
  styleId: string,
  modeId: string,
  notes: string,
  variant = 0,
) {
  const room = rooms.find((r) => r.id === roomId);
  const style = styles.find((s) => s.id === styleId);
  const mode = modes.find((m) => m.id === modeId);
  if (!room || !style || !mode)
    throw new Error("Configuración de diseño inválida.");
  const action =
    mode.id === "enhance"
      ? "Enhance this real-estate photo with balanced exposure, accurate white balance, natural contrast, controlled highlights and clean colour. Preserve every existing object and furniture piece. Do not stage, remove or add furniture, decor, features, fixtures or materials. Do not invent details or conceal flaws."
      : mode.id === "dusk"
        ? "Convert the lighting of this exact real-estate photograph from daytime to realistic early dusk. Use a gentle blue-hour sky only where an existing sky is visible, and believable warm illumination only from existing light fixtures and windows. Keep all furniture, objects, architecture and materials unchanged. Do not add lamps, stars, landscaping, fire, furniture or new features."
        : mode.id === "remove"
          ? "Remove all movable furniture, rugs, artwork and decorative items. Reconstruct the occluded surfaces naturally. Show the same room empty."
          : `${mode.id === "redesign" ? "Remove and replace the existing movable furniture and decoration." : "Virtually stage the empty space with furniture and decoration."} Furnish this ${room.prompt} in ${style.prompt} style. Use furniture realistically scaled for this exact room and suited to Argentine residential listings. Use locally familiar furniture proportions, practical circulation and compact pieces when space is limited. Adapt to the existing property rather than making every home look luxurious. Create a tasteful and inviting composition.`;
  // Each result in a three-output batch is a distinct proposal; paid originals allow further batches.
  const option =
    variant > 0 && (mode.id === "furnish" || mode.id === "redesign")
      ? ` This is design option ${variant} of 3: choose different furniture pieces, layout and accent colours than the other options, while keeping the same style.`
      : "";
  return `Edit this actual real-estate photograph. ${action}${option}\nSTRICT ARCHITECTURAL CONSTRAINTS: Preserve the exact camera position, perspective, room dimensions, wall locations, doors, windows, flooring, ceiling, built-in cabinetry, permanent fixtures, exterior views${mode.id === "dusk" ? ". Only the illumination and visible sky may change to dusk" : " and natural lighting"}. Do not renovate or invent structural features. Do not conceal damage. Do not add people, text, logos or watermarks. Photorealistic real-estate photography, coherent shadows, believable proportions, high detail.\nAdditional styling preferences (never override architectural constraints): ${notes.slice(0, 500) || "None."}`;
}
// Free results cover living/bedroom staging; photo editing and removal are paid features.
export const freeRooms = ["living", "bedroom"];
export const freeAllows = (room: string, mode: string) =>
  freeRooms.includes(room) && ["furnish", "redesign"].includes(mode);
