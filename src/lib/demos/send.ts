// Sending a demo by WhatsApp: the agency's number, the message and the stage
// of the demo's follow-up. Pure and client-safe; the panel and the server share it.

/** Argentine mobile numbers in international form: 549 + area code + number. */
export function normalizeArNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, "");
  if (!d) return null;
  // 00 is the international prefix dialed from Argentina; a "+" must be Argentina's own code.
  if (raw.trim().startsWith("+") && !/^\+\s*54/.test(raw.trim())) return null;
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("549")) return d.length >= 12 && d.length <= 13 ? d : null;
  if (d.startsWith("54")) {
    const rest = d.slice(2);
    // 54 + area + number, with the mobile 9 added when missing.
    const local = rest.startsWith("9") ? rest.slice(1) : rest;
    return local.length >= 10 && local.length <= 11 ? `549${local}` : null;
  }
  // National forms: 0 + area + 15 + number, or area + number, or 15 + number (Buenos Aires without area code).
  const local = d.replace(/^0/, "");
  const area = local.match(/^(\d{2,4})15(\d{6,8})$/);
  if (area) return `549${area[1]}${area[2]}`;
  if (local.length >= 10 && local.length <= 11) return `549${local}`;
  return null;
}

/** Placeholders the message template understands. */
export const MESSAGE_VARIABLES = ["nombre", "inmobiliaria", "ubicacion", "link", "creditos"] as const;

export const DEFAULT_MESSAGE_TEMPLATE =
  "Te preparé esta demo con la propiedad de {ubicacion}: {link}\n\nLes cargué {creditos} créditos para que puedan probar con otros estilos, ambientes o incluso cargar otra propiedad desde la plataforma (con un clic, importando la URL).";

export type MessageValues = {
  /** The contact's name when known, else the agency's. */
  nombre: string | null;
  inmobiliaria: string;
  /** The property's location ("Playa Grande, Mar del Plata"); null falls back to its title. */
  ubicacion: string | null;
  /** The property's title, when it has no location. */
  propiedad: string;
  link: string;
  /** Credits reserved for the agency by this demo. */
  creditos: number | null;
};

/** Fills the template. Unknown placeholders stay as written so a typo is visible in the preview. */
export function renderMessage(template: string, v: MessageValues): string {
  const values: Record<(typeof MESSAGE_VARIABLES)[number], string> = {
    nombre: v.nombre?.trim() || v.inmobiliaria,
    inmobiliaria: v.inmobiliaria,
    // Only the neighborhood reads well in a sentence: "Playa Grande", not "Playa Grande, Mar del Plata".
    ubicacion: v.ubicacion?.split(",")[0].trim() || v.propiedad,
    link: v.link,
    creditos: v.creditos === null ? "" : String(v.creditos),
  };
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    (MESSAGE_VARIABLES as readonly string[]).includes(key) ? values[key as keyof typeof values] : whole,
  );
}

/** The wa.me-style URL the team opens in the same tab (WhatsApp Web chat with the text already written). */
export function whatsappWebUrl(phone: string, text: string) {
  return `https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(text)}`;
}

/** The follow-up stages: the sequence of the demo's bar. */
export const STAGES = ["Sin enviar", "Enviada", "Ingresó", "Interactuó", "Generó imagen", "Creó su panel", "Suscribió"] as const;

/**
 * The stage of a demo: 0 "Sin enviar", 1 "Enviada", then the activity level
 * (1 Ingresó … 5 Suscribió) shifted by one. A visit always means it was sent.
 */
export function stageOf(sentAt: string | null, activityLevel: number): number {
  const level = Math.min(5, Math.max(0, activityLevel));
  if (level >= 1) return level + 1;
  return sentAt ? 1 : 0;
}

/** Whether the bar's step is reached (the shaded steps: green from "Ingresó", brand green for "Enviada"). */
export const stageLabel = (stage: number) => STAGES[stage] ?? STAGES[0];

/** Filters for the list: "Sin enviar" is published demos not sent yet. */
export function notSent(stage: number, status: "draft" | "published") {
  return status === "published" && stage === 0;
}
