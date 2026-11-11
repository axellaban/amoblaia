// The typefaces an agency can choose for its site. Loaded from Google Fonts
// when the site is shown, and only the two it uses (titles and texts): the
// build does not depend on downloading them.
import type { FontId } from "./schema";

const FAMILIES: Record<FontId, { name: string; query: string; fallback: string } | null> = {
  // Manrope is the app's own font, already loaded by the root layout.
  manrope: null,
  inter: { name: "Inter", query: "Inter:wght@400;500;600;700", fallback: "system-ui, sans-serif" },
  montserrat: { name: "Montserrat", query: "Montserrat:wght@400;500;600;700", fallback: "system-ui, sans-serif" },
  poppins: { name: "Poppins", query: "Poppins:wght@400;500;600;700", fallback: "system-ui, sans-serif" },
  dmsans: { name: "DM Sans", query: "DM+Sans:wght@400;500;600;700", fallback: "system-ui, sans-serif" },
  playfair: { name: "Playfair Display", query: "Playfair+Display:wght@400;500;600;700", fallback: "Georgia, serif" },
  lora: { name: "Lora", query: "Lora:wght@400;500;600;700", fallback: "Georgia, serif" },
  cormorant: { name: "Cormorant Garamond", query: "Cormorant+Garamond:wght@400;500;600;700", fallback: "Georgia, serif" },
};

export function fontStack(id: FontId) {
  const f = FAMILIES[id];
  return f ? `"${f.name}", ${f.fallback}` : "var(--font-manrope), system-ui, sans-serif";
}

/** The Google Fonts stylesheet for the site's typefaces, or null when it only uses Manrope. */
export function fontsHref(ids: FontId[]) {
  const queries = [...new Set(ids)].map((id) => FAMILIES[id]?.query).filter(Boolean);
  return queries.length ? `https://fonts.googleapis.com/css2?${queries.map((q) => `family=${q}`).join("&")}&display=swap` : null;
}
