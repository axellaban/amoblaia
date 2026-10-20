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
