// Validation of admin form input. Pure functions, covered by tests.
import { HttpError } from "@/lib/commerce/http";
import { rooms, styles } from "@/lib/catalog";
import { cleanText, cleanUrl, DEMO_MODES, type DemoMode } from "./shared";

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
export const validStyle = (v: unknown): v is string =>
  typeof v === "string" && styles.some((s) => s.id === v);
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
  if ("style" in v) {
    if (!validStyle(v.style)) throw new HttpError(400, "Elegí un estilo válido.");
    changes.style = v.style;
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
