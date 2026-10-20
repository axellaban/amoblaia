// Home page example scenes: an empty photo per room plus one per style,
// stored as public/ejemplos/{room}-{before|style}.webp.
export const exampleRooms = [
  "bedroom",
  "living",
  "kitchen",
  "office",
  "outdoor",
  "dining",
] as const;
export const exampleStyles = [
  "modern",
  "midcentury",
  "scandinavian",
  "luxury",
  "coastal",
  "farmhouse",
] as const;
export const examplePath = (room: string, style: string) =>
  `/ejemplos/${room}-${style === "original" ? "before" : style}.webp`;
