export const rooms = [
  { id: "living", name: "Living", prompt: "living room", icon: "sofa" },
  { id: "bedroom", name: "Dormitorio", prompt: "bedroom", icon: "bed" },
  { id: "dining", name: "Comedor", prompt: "dining room", icon: "dining" },
  { id: "kitchen", name: "Cocina", prompt: "kitchen", icon: "kitchen" },
  { id: "office", name: "Home office", prompt: "home office", icon: "office" },
  {
    id: "outdoor",
    name: "Exterior",
    prompt: "outdoor terrace",
    icon: "outdoor",
  },
] as const;
export const styles = [
  {
    id: "modern",
    name: "Moderno",
    description: "Líneas simples. Mucha personalidad.",
    prompt:
      "contemporary modern, clean lines, neutral palette, sophisticated comfortable furniture",
    color: "#c6b09a",
  },
  {
    id: "scandinavian",
    name: "Escandinavo",
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
    name: "Rústico",
    description: "Texturas naturales. Espíritu de hogar.",
    prompt:
      "modern farmhouse, natural timber, earthy ceramics, warm linen, rustic sophistication",
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
] as const;
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
] as const;
export type RoomId = (typeof rooms)[number]["id"];
export type StyleId = (typeof styles)[number]["id"];
export type ModeId = (typeof modes)[number]["id"];
export const beforeImage = (room: RoomId) => `/demo/${room}-before.webp`;
export function afterImage(room: RoomId, style: StyleId = "modern") {
  const available =
    room === "bedroom" && style !== "industrial" ? style : "modern";
  return `/demo/${room}-${available}.webp`;
}
export function buildPrompt(
  roomId: string,
  styleId: string,
  modeId: string,
  notes: string,
) {
  const room = rooms.find((r) => r.id === roomId);
  const style = styles.find((s) => s.id === styleId);
  const mode = modes.find((m) => m.id === modeId);
  if (!room || !style || !mode)
    throw new Error("Configuración de diseño inválida.");
  const action =
    mode.id === "remove"
      ? "Remove all movable furniture, rugs, artwork and decorative items. Reconstruct the occluded surfaces naturally. Show the same room empty."
      : `${mode.id === "redesign" ? "Remove and replace the existing movable furniture and decoration." : "Virtually stage the empty space with furniture and decoration."} Furnish this ${room.prompt} in ${style.prompt} style. Use furniture realistically scaled for this exact room and suitable for residential real estate in Latin America. Create a tasteful and inviting composition.`;
  return `Edit this actual real-estate photograph. ${action}\nSTRICT ARCHITECTURAL CONSTRAINTS: Preserve the exact camera position, perspective, room dimensions, wall locations, doors, windows, flooring, ceiling, built-in cabinetry, permanent fixtures, exterior views and natural lighting. Do not renovate or invent structural features. Do not conceal damage. Do not add people, text, logos or watermarks. Photorealistic real-estate photography, coherent shadows, believable proportions, high detail.\nAdditional styling preferences (never override architectural constraints): ${notes.slice(0, 500) || "None."}`;
}
