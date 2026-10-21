import { rooms, styles } from "./catalog";

// Home page example scenes: an empty photo per room plus one per style,
// stored as public/ejemplos/{room}-{before|style}.webp.
export const exampleRooms = rooms.map((r) => r.id);
export const exampleStyles = styles.map((s) => s.id);
export const examplePath = (room: string, style: string) =>
  `/ejemplos/${room}-${style === "original" ? "before" : style}.webp`;
