// «Preparar demo completa»: qué fotos se ambientan, cuál va de portada y en qué paso está la demo.
// Lógica pura (sin red ni base), compartida por el servidor, el editor y sus pruebas.

/** Los dos estilos de la tanda automática: Nórdico (el principal: portada y vista previa) y Minimalista. */
export const AUTO_STYLES = ["scandinavian", "minimalist"] as const;
/** Los ambientes que se ambientan, en el orden en que se eligen. */
export const AUTO_ROOMS = ["living", "dining", "bedroom"] as const;
export const AUTO_PICKS = AUTO_ROOMS.length;

/** Lo que el clasificador dice de cada foto, mirando la imagen. */
export type PhotoClass = {
  photoId: string;
  /** living, dining, living_dining, bedroom, kitchen, bathroom, office, outdoor, exterior, plan, other. */
  room: string;
  /** Tiene muebles (se rediseña) o está vacía (se amobla). */
  furnished: boolean;
  /** De 0 a 10: qué tan buena es para mostrar una ambientación (amplia, luminosa, sin cortes, interior). */
  score: number;
};
export type AutoPick = { photoId: string; room: (typeof AUTO_ROOMS)[number]; mode: "furnish" | "redesign"; score: number };

export const CLASS_ROOMS = ["living", "dining", "living_dining", "bedroom", "kitchen", "bathroom", "office", "outdoor", "exterior", "plan", "other"] as const;
const fits = (c: PhotoClass, room: (typeof AUTO_ROOMS)[number]) =>
  c.room === room || (c.room === "living_dining" && (room === "living" || room === "dining"));

/**
 * La mejor foto de living, de comedor y de dormitorio (un living comedor sirve para cualquiera de los
 * dos). Si falta un ambiente, se completa con la mejor foto que quede de los otros dos, para que la
 * demo tenga siempre 3 ambientaciones si hay de dónde. Nunca baños, cocinas, fachadas ni planos.
 * La portada es la mejor de las elegidas, con el living primero en caso de empate.
 */
export function pickForDemo(classes: PhotoClass[]): { picks: AutoPick[]; cover: string | null } {
  const pool = [...classes].filter((c) => Number.isFinite(c.score)).sort((a, b) => b.score - a.score || a.photoId.localeCompare(b.photoId));
  const used = new Set<string>();
  const picks: AutoPick[] = [];
  const take = (c: PhotoClass, room: (typeof AUTO_ROOMS)[number]) => {
    used.add(c.photoId);
    picks.push({ photoId: c.photoId, room, mode: c.furnished ? "redesign" : "furnish", score: c.score });
  };
  for (const room of AUTO_ROOMS) {
    const best = pool.find((c) => !used.has(c.photoId) && fits(c, room));
    if (best) take(best, room);
  }
  // Short of one room: the next best of the rooms we do stage (a second living, another bedroom).
  for (const c of pool) {
    if (picks.length >= AUTO_PICKS) break;
    if (used.has(c.photoId)) continue;
    const room = AUTO_ROOMS.find((r) => fits(c, r));
    if (room) take(c, room);
  }
  const order = (p: AutoPick) => AUTO_ROOMS.indexOf(p.room);
  picks.sort((a, b) => order(a) - order(b));
  const cover = [...picks].sort((a, b) => b.score - a.score || order(a) - order(b))[0]?.photoId ?? null;
  return { picks, cover };
}

/** Una respuesta del clasificador, validada: lo que no se entiende queda como «other» con puntaje 0. */
export function cleanClasses(raw: unknown, photoIds: string[]): PhotoClass[] {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { photos?: unknown }).photos) ? (raw as { photos: unknown[] }).photos : [];
  return photoIds.map((photoId, i) => {
    const r = (list.find((x) => x && typeof x === "object" && (x as { index?: unknown }).index === i) ?? list[i] ?? {}) as Record<string, unknown>;
    const room = typeof r.room === "string" && (CLASS_ROOMS as readonly string[]).includes(r.room) ? r.room : "other";
    const score = typeof r.score === "number" && Number.isFinite(r.score) ? Math.max(0, Math.min(10, r.score)) : 0;
    return { photoId, room, furnished: r.furnished === true, score };
  });
}

// ── El avance de una demo, del aviso a la publicación ──────────────────────

export type PrepStepKey = "fotos" | "versiones" | "publicada" | "precargas";
export type PrepStep = { key: PrepStepKey; label: string; ok: boolean; note: string };
export type PrepFacts = {
  /** Fotos de la propiedad y cuántas trae la publicación (null: no se sabe). */
  photos: number;
  photosTotal: number | null;
  /** Fotos con al menos una versión ambientada, y cuántas versiones terminadas hay. */
  stagedPhotos: number;
  versions: number;
  published: boolean;
  /** Versiones esperadas (las fotos elegidas × los estilos); sin dato, 3 fotos × 2 estilos. */
  target?: number;
  /** Propiedades precargadas en su panel (además de la de la demo). */
  preloads: number;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** Los cuatro pasos de «Crear demo», en orden: fotos importadas → versiones generadas → publicada → precargas. */
export function prepSteps(f: PrepFacts): PrepStep[] {
  const wanted = AUTO_PICKS * AUTO_STYLES.length;
  return [
    {
      key: "fotos",
      label: "Fotos importadas",
      ok: f.photos > 0 && (f.photosTotal === null || f.photos >= Math.min(f.photosTotal, 3)),
      note: f.photosTotal !== null ? `${f.photos} de ${f.photosTotal} fotos` : plural(f.photos, "foto", "fotos"),
    },
    {
      key: "versiones",
      label: "Versiones generadas",
      ok: f.versions > 0 && f.versions >= Math.min(f.target ?? wanted, wanted),
      note: `${plural(f.versions, "versión", "versiones")} en ${plural(f.stagedPhotos, "foto", "fotos")}`,
    },
    { key: "publicada", label: "Demo publicada", ok: f.published, note: f.published ? "Publicada" : "Sin publicar" },
    { key: "precargas", label: "2 propiedades precargadas", ok: f.preloads >= 2, note: `${Math.min(f.preloads, 2)} de 2` },
  ];
}
