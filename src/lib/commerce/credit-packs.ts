// The simplified offer: «Gratis» and «Comprar créditos». Prices and amounts
// always come from the products table (the server validates them again when
// the order is created); this file only says which packs are on sale.
import type { Product } from "./catalog";

/** The packs of «Comprar créditos», smallest first. */
export const CREDIT_PACK_SKUS = ["pack-10", "pack-25", "pack-50", "pack-100"] as const;
/** The link to share the prices: the agency's own panel, or /precios without one. */
export const PRICES_PATH = "/panel/precios";
/** Credits per month of the «Gratis» plan (see 202611240002_free_monthly_credits.sql). */
export const FREE_MONTHLY_CREDITS = 10;

export type CreditPackage = {
  sku: string;
  credits: number;
  cents: number;
  unitCents: number;
  /** Saving per credit against the smallest pack, 0–1, rounded to whole percents. */
  discount: number;
  validDays: number | null;
};

/** The packs on sale, from the catalog rows that are active and priced. */
export function creditPackages(products: Product[]): CreditPackage[] {
  const packs = CREDIT_PACK_SKUS.map((sku) =>
    products.find((p) => p.sku === sku && p.kind === "pack" && p.active && p.price_cents && p.photos > 0),
  ).filter((p): p is Product => Boolean(p));
  const base = packs[0] ? packs[0].price_cents! / packs[0].photos : 0;
  return packs.map((p) => {
    const unitCents = p.price_cents! / p.photos;
    return {
      sku: p.sku,
      credits: p.photos,
      cents: p.price_cents!,
      unitCents,
      discount: base ? Math.max(0, Math.round((1 - unitCents / base) * 100) / 100) : 0,
      validDays: p.valid_days ?? null,
    };
  });
}

/** Where to come back after paying: only our own pages, never another site. */
export function safeReturnTo(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 300) return null;
  if (!/^\/(panel|estudio|precios|cuenta|proyectos)(\/|\?|#|$)/.test(value)) return null;
  if (value.startsWith("//") || value.includes("\\") || /[\s<>"']/.test(value)) return null;
  return value;
}

/**
 * The free credits an agency has before (or right when) creating its
 * account, said as the one offer: 10 free credits a month. Its welcome
 * credits are its first month's (202611240003); more than 10 means the team
 * added some on top.
 */
export function freeCreditsLine(n: number) {
  if (n > FREE_MONTHLY_CREDITS)
    return `Incluye ${n} créditos para ambientar fotos con IA: los ${FREE_MONTHLY_CREDITS} gratis de este mes y ${n - FREE_MONTHLY_CREDITS} de regalo.`;
  if (n === FREE_MONTHLY_CREDITS) return `Incluye ${FREE_MONTHLY_CREDITS} créditos gratis por mes para ambientar fotos con IA.`;
  if (n > 0) return `Te ${n === 1 ? "queda" : "quedan"} ${n} de tus ${FREE_MONTHLY_CREDITS} créditos gratis de este mes.`;
  return `Ya usaste los ${FREE_MONTHLY_CREDITS} créditos gratis de este mes: el mes que viene tenés ${FREE_MONTHLY_CREDITS} más, o podés comprar créditos.`;
}
