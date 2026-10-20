export const offers = [
  {
    id: "pack-10",
    name: "Pack 10",
    photos: 10,
    kind: "pack" as const,
    description: "Para una propiedad.",
  },
  {
    id: "pack-25",
    name: "Pack 25",
    photos: 25,
    kind: "pack" as const,
    description: "Para varias publicaciones.",
  },
  {
    id: "basic",
    name: "Inicial",
    photos: 6,
    kind: "subscription" as const,
    description: "Para empezar a publicar mejor.",
  },
  {
    id: "standard",
    name: "Agente",
    photos: 20,
    kind: "subscription" as const,
    description: "Para tu cartera de propiedades.",
  },
  {
    id: "professional",
    name: "Profesional",
    photos: 60,
    kind: "subscription" as const,
    description: "Para un flujo constante de publicaciones.",
  },
  {
    id: "enterprise",
    name: "Inmobiliaria",
    photos: 150,
    kind: "subscription" as const,
    description: "Para un volumen mayor de propiedades.",
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
