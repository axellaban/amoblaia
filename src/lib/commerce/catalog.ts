export const offers = [
  { id: "basic", name: "Inicial", photos: 6, description: "Para probarlo" },
  { id: "standard", name: "Agente", photos: 20, description: "Para agentes" },
  {
    id: "professional",
    name: "Profesional",
    photos: 60,
    description: "Para quienes más publican",
  },
  {
    id: "enterprise",
    name: "Inmobiliaria",
    photos: 150,
    description: "Para equipos, inmobiliarias y fotógrafos",
  },
];
export function formatARS(cents: number) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}
export function skuFor(id: string, annual = false) {
  return id.startsWith("pack-") ? id : `${id}-${annual ? "year" : "month"}`;
}
export type Product = {
  sku: string;
  name: string;
  kind: "pack" | "month" | "year";
  photos: number;
  versions: number;
  price_cents: number | null;
  active: boolean;
  /** Launch price of a monthly plan, charged for its first `promo_months`
   * payments when the order is created before `promo_ends_at`. */
  promo_price_cents?: number | null;
  promo_months?: number | null;
  promo_ends_at?: string | null;
  /** Paid orders allowed per account (the "Primera propiedad" pack). */
  per_account_limit?: number | null;
  /** Days a pack's photos last; packs without it never expire. */
  valid_days?: number | null;
};
/** The launch offer of a catalog product, only while its window is open. */
export function launchOffer(p: Product, now = Date.now()) {
  return p.kind === "month" &&
    p.promo_price_cents &&
    p.promo_months &&
    p.promo_ends_at &&
    Date.parse(p.promo_ends_at) > now
    ? {
        cents: p.promo_price_cents,
        months: p.promo_months,
        endsAt: p.promo_ends_at,
      }
    : null;
}
/** What Mercado Pago charges first for an order: an order created during the
 * launch window keeps its launch price in the snapshot. */
export function firstChargeCents(snapshot: Product) {
  return snapshot.promo_price_cents || snapshot.price_cents || 0;
}
/** Amounts a payment of this order may have: launch and list price. */
export function acceptedChargeCents(snapshot: Product) {
  return [snapshot.price_cents, snapshot.promo_price_cents].filter(
    (c): c is number => typeof c === "number" && c > 0,
  );
}
