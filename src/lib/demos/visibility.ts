// What the public page shows of a property's data, after the agency's
// switches («Mostrar en demostración», «Mostrar datos de la propiedad»,
// «Incluir datos de contacto», «Mostrar selector de estilos»). Applied on the
// server, so a hidden value never reaches the page; the saved value is never
// touched. Pure: shared by the payload builder, the agency site and tests.
import { shows, type DemoSettings } from "./branding";
import type { PublicDemo } from "./shared";

type Hideable = Pick<
  PublicDemo,
  | "location"
  | "operation"
  | "price"
  | "expenses"
  | "availability"
  | "requirements"
  | "features"
  | "reference"
  | "description"
  | "facts"
  | "amenities"
  | "map"
  | "agent"
  | "contact"
  | "agency"
  | "listingUrl"
>;

export function applyVisibility<T extends Hideable>(page: T, settings: DemoSettings): T {
  const on = (f: Parameters<typeof shows>[1]) => shows(settings, f);
  const out: T = {
    ...page,
    location: on("location") ? page.location : null,
    operation: on("operation") ? page.operation : null,
    price: on("price") ? page.price : null,
    expenses: on("expenses") ? page.expenses : null,
    availability: on("availability") ? page.availability : null,
    requirements: on("requirements") ? page.requirements : null,
    features: on("features") ? page.features : null,
    reference: on("reference") ? page.reference : null,
    description: on("description") ? page.description : null,
    amenities: on("amenities") ? page.amenities : [],
    map: on("map") ? page.map : null,
    agent: on("agent") ? page.agent : null,
    listingUrl: on("listingUrl") ? page.listingUrl : null,
    facts: settings.showData ? page.facts.filter((f) => !f.hidden).map(({ hidden: _h, ...f }) => f) : [],
  };
  if (!settings.showContact)
    return {
      ...out,
      contact: { whatsapp: null, phone: null, email: null, url: null },
      agency: { ...out.agency, contact: null, visitUrl: null },
    };
  return out;
}

/** The catalog card of the agency's site: the same rules for its price, place and features. */
export function visibleCard(settings: DemoSettings, card: { location: string | null; operation: string | null; price: string | null; features: string | null }) {
  return {
    location: shows(settings, "location") ? card.location : null,
    operation: shows(settings, "operation") ? card.operation : null,
    price: shows(settings, "price") ? card.price : null,
    features: shows(settings, "features") ? card.features : null,
  };
}
