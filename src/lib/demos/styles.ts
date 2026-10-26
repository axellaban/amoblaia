// Styles a demo can offer, by property type. Homes use the studio's
// catalog; offices get their own proposals (desks, work chairs, storage),
// never a living room renamed. Safe for the browser.
import { buildPrompt, styles as homeStyles } from "@/lib/catalog";

export const PROPERTY_TYPES = ["residential", "office"] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];
export const PROPERTY_TYPE_NAMES: Record<PropertyType, string> = {
  residential: "Vivienda",
  office: "Oficina",
};

type DemoStyle = { id: string; name: string; color: string; prompt?: string };
const officeStyles: DemoStyle[] = [
  {
    id: "office_executive",
    name: "Oficina ejecutiva",
    color: "#5a4636",
    prompt:
      "an executive private office: one solid wood desk with an ergonomic executive chair, two visitor chairs, a low credenza or closed storage cabinet, a bookcase with binders and a few books, a desk lamp and one or two plants; sober professional palette of warm wood, dark leather and neutral tones",
  },
  {
    id: "office_team",
    name: "Equipo de trabajo",
    color: "#3d5a73",
    prompt:
      "a small team workspace: shared or individual desks sized for the room with ergonomic task chairs, monitors and simple cable management, practical storage (filing cabinets or shelving), a whiteboard or pinboard on a free wall and a few plants; bright, functional, professional palette",
  },
];

export const DEMO_STYLES: Record<PropertyType, DemoStyle[]> = {
  residential: homeStyles.map((s) => ({ id: s.id, name: s.name, color: s.color })),
  office: officeStyles,
};
const ALL = [...DEMO_STYLES.residential, ...DEMO_STYLES.office];

export const isDemoStyle = (v: unknown): v is string => typeof v === "string" && ALL.some((s) => s.id === v);
export const styleFits = (style: string, type: PropertyType) => DEMO_STYLES[type].some((s) => s.id === style);
export const demoStyleName = (id: string) => ALL.find((s) => s.id === id)?.name ?? id;
/** Catalog order, used to list a demo's styles consistently. */
export const demoStyleOrder = ALL.map((s) => s.id);

/**
 * The generation prompt. Homes use the studio's prompt; offices keep the
 * same strict architectural constraints with work furniture.
 */
export function buildDemoPrompt(room: string, style: string, mode: string, notes: string) {
  const office = officeStyles.find((s) => s.id === style);
  if (!office) return buildPrompt(room, style, mode, notes);
  const action =
    mode === "redesign"
      ? "Remove and replace the existing movable furniture and decoration."
      : "Virtually stage the empty space with furniture and decoration.";
  return `Edit this actual real-estate photograph of a commercial office space. ${action} Furnish it as ${office.prompt}. This is a workplace, not a home: no sofas for lounging, beds, televisions, dining tables or kitchen furniture. Use office furniture realistically scaled for this exact room, keep clear circulation and access to doors and windows, and adapt to the existing materials rather than making it look luxurious.\nSTRICT ARCHITECTURAL CONSTRAINTS: Preserve the exact camera position, perspective, room dimensions, wall locations, doors, windows, window bars, flooring, ceiling, built-in cabinetry, permanent fixtures, exterior views and natural lighting. Do not renovate or invent structural features. Do not conceal damage. Do not add people, text, logos or watermarks. Photorealistic real-estate photography, coherent shadows, believable proportions, high detail.\nAdditional styling preferences (never override architectural constraints): ${notes.slice(0, 500) || "None."}`;
}
