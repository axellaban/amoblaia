// The typefaces an agency can choose for its site, self-hosted by Next.
// Only the ones a site uses are downloaded by the browser (CSS @font-face
// loads on use); none is preloaded.
import { Cormorant_Garamond, DM_Sans, Inter, Lora, Montserrat, Playfair_Display, Poppins } from "next/font/google";
import type { FontId } from "./schema";

const inter = Inter({ subsets: ["latin"], display: "swap", preload: false, variable: "--sf-inter" });
const montserrat = Montserrat({ subsets: ["latin"], display: "swap", preload: false, variable: "--sf-montserrat" });
const poppins = Poppins({ subsets: ["latin"], display: "swap", preload: false, weight: ["400", "500", "600", "700"], variable: "--sf-poppins" });
const dmsans = DM_Sans({ subsets: ["latin"], display: "swap", preload: false, variable: "--sf-dmsans" });
const playfair = Playfair_Display({ subsets: ["latin"], display: "swap", preload: false, variable: "--sf-playfair" });
const lora = Lora({ subsets: ["latin"], display: "swap", preload: false, variable: "--sf-lora" });
const cormorant = Cormorant_Garamond({ subsets: ["latin"], display: "swap", preload: false, weight: ["400", "500", "600", "700"], variable: "--sf-cormorant" });

/** Class names that define every --sf-* variable: set once on the site's root. */
export const FONT_VARIABLES = [inter, montserrat, poppins, dmsans, playfair, lora, cormorant].map((f) => f.variable).join(" ");

const STACKS: Record<FontId, string> = {
  // Manrope is the app's own font, already loaded by the root layout.
  manrope: "var(--font-manrope), system-ui, sans-serif",
  inter: "var(--sf-inter), system-ui, sans-serif",
  montserrat: "var(--sf-montserrat), system-ui, sans-serif",
  poppins: "var(--sf-poppins), system-ui, sans-serif",
  dmsans: "var(--sf-dmsans), system-ui, sans-serif",
  playfair: "var(--sf-playfair), Georgia, serif",
  lora: "var(--sf-lora), Georgia, serif",
  cormorant: "var(--sf-cormorant), Georgia, serif",
};
export const fontStack = (id: FontId) => STACKS[id];
