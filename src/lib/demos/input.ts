// Validation of admin form input. Pure functions, covered by tests.
import { HttpError } from "@/lib/commerce/http";
import { rooms } from "@/lib/catalog";
import { isDemoStyle } from "./styles";
import { cleanText, cleanUrl, DEMO_MODES, type DemoMode } from "./shared";
import {
  CONTACT_KINDS,
  FACT_ICONS,
  TITLE_FONTS,
  color,
  readSettings,
  whatsappNumber,
  type FactIcon,
  type AgencyBranding,
  type ContactKind,
  type DemoSettings,
  type TitleFont,
} from "./branding";

export async function readJson(request: Request, max = 16384) {
  if (Number(request.headers.get("content-length") || 0) > max)
    throw new HttpError(413, "Solicitud inválida.");
  try {
    const body = await request.json();
    if (!body || typeof body !== "object") throw new Error("NOT_OBJECT");
    return body as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "Solicitud inválida.");
  }
}

export function agencyInput(raw: unknown) {
  const v = (raw ?? {}) as Record<string, unknown>;
  const name = cleanText(v.name, 120);
  if (!name) throw new HttpError(400, "Ingresá el nombre de la inmobiliaria.");
  const website = cleanUrl(v.website);
  if (website === undefined)
    throw new HttpError(400, "Revisá el sitio web: usá una dirección como inmobiliaria.com.ar.");
  return {
    name,
    website,
    contact_name: cleanText(v.contact_name, 120),
    notes: cleanText(v.notes, 4000, true),
  };
}

export function propertyInput(raw: unknown) {
  const v = (raw ?? {}) as Record<string, unknown>;
  const title = cleanText(v.title, 160);
  if (!title) throw new HttpError(400, "Ingresá el título de la propiedad.");
  const listing = cleanUrl(v.listing_url);
  if (listing === undefined)
    throw new HttpError(400, "Revisá la URL de la publicación original.");
  return {
    title,
    location: cleanText(v.location, 160),
    listing_url: listing,
    description: cleanText(v.description, 1000, true),
  };
}

export const validRoom = (v: unknown): v is string =>
  typeof v === "string" && rooms.some((r) => r.id === v);
/** Any style a demo can offer (home or office); whether it fits the property is checked where it matters. */
export const validStyle = (v: unknown): v is string => isDemoStyle(v);
export const validMode = (v: unknown): v is DemoMode =>
  typeof v === "string" && (DEMO_MODES as readonly string[]).includes(v);

/** Fields an admin can change on a photo; unknown or invalid values are rejected, absent ones left alone. */
export function photoChanges(raw: unknown) {
  const v = (raw ?? {}) as Record<string, unknown>;
  const changes: Record<string, unknown> = {};
  if ("room" in v) {
    if (!validRoom(v.room)) throw new HttpError(400, "Elegí un ambiente válido.");
    changes.room = v.room;
  }
  if ("mode" in v) {
    if (!validMode(v.mode)) throw new HttpError(400, "Elegí Amoblar o Rediseñar.");
    changes.mode = v.mode;
  }
  if ("visible" in v) {
    if (typeof v.visible !== "boolean") throw new HttpError(400, "Visibilidad inválida.");
    changes.visible = v.visible;
  }
  if ("label" in v) changes.label = cleanText(v.label, 80);
  return changes;
}

/** A complete reordering: the same photo ids, each once. */
export function orderInput(raw: unknown, current: string[]) {
  if (
    !Array.isArray(raw) ||
    raw.length !== current.length ||
    new Set(raw).size !== raw.length ||
    !raw.every((id) => typeof id === "string" && current.includes(id))
  )
    throw new HttpError(409, "El orden cambió en otra pestaña. Recargá la página.");
  return raw as string[];
}

/** Branding fields from the panel. Unknown values are rejected; the logo is handled by its own route. */
export function brandingInput(raw: unknown, current: AgencyBranding): AgencyBranding {
  const v = (raw ?? {}) as Record<string, unknown>;
  const out: AgencyBranding = { ...current };
  for (const key of ["primary", "accent"] as const) {
    if (!(key in v)) continue;
    if (v[key] === null || v[key] === "") delete out[key];
    else if (color(v[key])) out[key] = color(v[key]);
    else throw new HttpError(400, "Usá un color en formato #RRGGBB.");
  }
  if ("titleFont" in v) {
    if (!TITLE_FONTS.includes(v.titleFont as TitleFont)) throw new HttpError(400, "Tipografía inválida.");
    out.titleFont = v.titleFont as TitleFont;
  }
  if ("contactKind" in v || "contactValue" in v) {
    const value = cleanText(v.contactValue, 300);
    if (!value) {
      delete out.contactKind;
      delete out.contactValue;
    } else {
      const kind = v.contactKind as ContactKind;
      if (!CONTACT_KINDS.includes(kind)) throw new HttpError(400, "Elegí cómo se contacta a la inmobiliaria.");
      if (kind === "whatsapp" && !whatsappNumber(value))
        throw new HttpError(400, "Ingresá el WhatsApp con código de país, por ejemplo +54 9 223 555-1234.");
      if (kind === "url" && !cleanUrl(value))
        throw new HttpError(400, "Revisá el enlace de contacto: usá una dirección como inmobiliaria.com/contacto.");
      if (kind === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
        throw new HttpError(400, "Revisá el email de contacto.");
      if (kind === "phone" && value.replace(/\D/g, "").length < 6) throw new HttpError(400, "Revisá el teléfono.");
      out.contactKind = kind;
      out.contactValue = kind === "url" ? cleanUrl(value)! : value;
    }
  }
  if ("visitUrl" in v) {
    const url = cleanUrl(v.visitUrl);
    if (url === undefined) throw new HttpError(400, "Revisá el enlace para coordinar visitas.");
    if (url) out.visitUrl = url;
    else delete out.visitUrl;
  }
  return out;
}

/**
 * Settings from the panel: only the keys sent change. Validated strictly
 * (a clear message), then normalized like the stored value.
 */
export function settingsInput(raw: unknown, current: DemoSettings): DemoSettings {
  const v = (raw ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = { ...current };
  if ("openMode" in v) {
    if (v.openMode !== "original" && v.openMode !== "styled") throw new HttpError(400, "Modo de apertura inválido.");
    out.openMode = v.openMode;
  }
  if ("openStyle" in v) out.openStyle = typeof v.openStyle === "string" && v.openStyle ? v.openStyle : null;
  if ("banner" in v) {
    if (typeof v.banner !== "boolean") throw new HttpError(400, "Valor inválido.");
    out.banner = v.banner;
  }
  if ("propertyType" in v) {
    if (v.propertyType !== "residential" && v.propertyType !== "office") throw new HttpError(400, "Tipo de inmueble inválido.");
    out.propertyType = v.propertyType;
  }
  for (const key of [
    "operation",
    "price",
    "priceConflict",
    "expenses",
    "availability",
    "requirements",
    "features",
    "reference",
    "description",
    "closingTitle",
    "closingText",
    "shareTitle",
    "shareDescription",
  ] as const)
    if (key in v) out[key] = v[key];
  if ("facts" in v) {
    if (!Array.isArray(v.facts)) throw new HttpError(400, "Datos inválidos.");
    for (const f of v.facts as Record<string, unknown>[])
      if (cleanText(f?.value, 30) && !FACT_ICONS.includes(f.icon as FactIcon))
        throw new HttpError(400, "Elegí un ícono válido para cada dato.");
    out.facts = v.facts;
  }
  if ("amenities" in v) out.amenities = v.amenities;
  if ("map" in v) {
    const m = (v.map ?? {}) as Record<string, unknown>;
    const precision = m.precision;
    if (!["none", "zone", "approx", "exact"].includes(String(precision))) throw new HttpError(400, "Precisión de mapa inválida.");
    const lat = m.lat === null || m.lat === "" ? null : Number(m.lat);
    const lng = m.lng === null || m.lng === "" ? null : Number(m.lng);
    if (precision !== "none" && (lat === null || lng === null || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180))
      throw new HttpError(400, "Para mostrar el mapa cargá latitud y longitud (por ejemplo -38.0055, -57.5426).");
    out.map = { precision, lat, lng };
  }
  if ("agent" in v) {
    const a = (v.agent ?? {}) as Record<string, unknown>;
    if (!cleanText(a.name, 80)) out.agent = null;
    else {
      if (cleanText(a.whatsapp, 30) && !whatsappNumber(String(a.whatsapp)))
        throw new HttpError(400, "Revisá el WhatsApp del agente: con código de país, por ejemplo +54 9 223 555-1234.");
      if (cleanText(a.email, 120) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(a.email).trim()))
        throw new HttpError(400, "Revisá el email del agente.");
      if (cleanText(a.photoUrl, 500) && !/^https:\/\//.test(String(a.photoUrl).trim()))
        throw new HttpError(400, "La foto del agente tiene que ser un enlace https (la de su publicación).");
      out.agent = { ...a, photoUrl: cleanText(a.photoUrl, 500) };
    }
  }
  if ("reviewedAt" in v) out.reviewedAt = v.reviewedAt === null ? null : new Date().toISOString();
  return readSettings(out);
}
