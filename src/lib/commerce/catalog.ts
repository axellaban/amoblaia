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
};
/**
 * An authorized subscription whose first charge has not arrived after an
 * hour: Mercado Pago could not charge the card. It is not anybody's plan
 * yet, and the buyer may retry it with another card.
 */
export function firstChargeOverdue(
  s: { status: string; paid_until: string | null; created_at?: string },
  now = Date.now(),
) {
  return (
    s.status === "authorized" &&
    !s.paid_until &&
    Boolean(s.created_at) &&
    now - Date.parse(s.created_at!) > 60 * 60 * 1000
  );
}
