// What the property editor shows and does, as pure functions: the real state
// of each photo + style, the versions a batch still has to create, the
// photos grouped by space and the summaries of each section. Shared by the
// editor and its tests; no network, no React.
import type { DemoSettings } from "./branding";
import { stagingRoomOf, type EditorPhoto, type GenerationRow, type PropertySpace } from "./shared";

/** A version to create. room and mode: chosen in "Crear otra versión"; otherwise the photo's own settings. */
export type Task = { photoId: string; style: string; room?: string; mode?: "furnish" | "redesign" };
export const taskKey = (t: Task) => `${t.photoId}:${t.style}`;
export const liveStatus = (g: Pick<GenerationRow, "status">) => g.status === "queued" || g.status === "running";
export const isLive = (p: EditorPhoto, style?: string) => p.generations.some((g) => liveStatus(g) && (!style || g.style === style));

/**
 * Where one style of one photo stands. "ready": a created version is shown
 * for that style (downloadable). "running"/"queued": the server is working
 * on it. "waiting": pending in this tab's queue (not sent yet). "failed": the
 * last attempt failed and there is no version. "uncertain": the last attempt
 * needs a technical review; it is settled before another one starts.
 */
export type CellState =
  | { kind: "ready"; generationId: string; running: boolean }
  | { kind: "running" | "queued"; generationId: string }
  | { kind: "waiting" }
  | { kind: "failed"; generation: GenerationRow }
  | { kind: "uncertain"; generation: GenerationRow }
  | { kind: "none" };

export function cellState(photo: EditorPhoto, style: string, waiting: boolean): CellState {
  const discarded = new Set(photo.discarded);
  const attempts = photo.generations.filter((g) => g.style === style && !discarded.has(g.id));
  const live = attempts.find(liveStatus);
  const shown = photo.shown[style];
  // A version already shown stays available (view, download) while a new one is created.
  if (shown) return { kind: "ready", generationId: shown, running: Boolean(live) || waiting };
  if (live) return { kind: live.status === "running" ? "running" : "queued", generationId: live.id };
  if (waiting) return { kind: "waiting" };
  const last = attempts[0];
  if (last?.status === "needs_review") return { kind: "uncertain", generation: last };
  if (last?.status === "failed") return { kind: "failed", generation: last };
  return { kind: "none" };
}

/**
 * The versions a batch creates: for each included photo and chosen style,
 * only what is missing. Existing results, running attempts, attempts
 * waiting in this tab and uncertain results are never sent again.
 */
export function missingTasks(photos: EditorPhoto[], included: Set<string>, styles: string[], waiting: Set<string>) {
  const out: Task[] = [];
  for (const p of photos) {
    if (!included.has(p.id)) continue;
    for (const style of styles) {
      const state = cellState(p, style, waiting.has(taskKey({ photoId: p.id, style })));
      if (state.kind === "none" || state.kind === "failed") out.push({ photoId: p.id, style });
    }
  }
  return out;
}

/** Styles shown on a photo's card: the property's styles, then any other style it already has results in (never hidden). */
export function cardStyles(photo: EditorPhoto, demoStyles: string[]) {
  const extra = [...new Set(photo.generations.map((g) => g.style))].filter((s) => !demoStyles.includes(s));
  return [...demoStyles, ...extra];
}

export type SpaceGroup = { space: PropertySpace | null; photos: EditorPhoto[] };
/** Photos by space, in the spaces' order; photos without a space (or with an unknown one) go to "Sin organizar", last. */
export function groupBySpace(photos: EditorPhoto[], spaces: PropertySpace[]): SpaceGroup[] {
  const known = new Set(spaces.map((s) => s.id));
  const groups: SpaceGroup[] = [...spaces]
    .sort((a, b) => a.position - b.position)
    .map((space) => ({ space, photos: photos.filter((p) => p.spaceId === space.id) }));
  const loose = photos.filter((p) => !p.spaceId || !known.has(p.spaceId));
  if (loose.length || !spaces.length) groups.push({ space: null, photos: loose });
  return groups;
}

/** A space of a stageable kind and a photo staged as another room: shown, never fixed silently. */
export function roomConflict(photo: EditorPhoto, space: PropertySpace | null) {
  const room = space ? stagingRoomOf(space.roomType) : null;
  return room && room !== photo.room ? room : null;
}

/** Real counts of the photos section. */
export function photoSummary(photos: EditorPhoto[], spaces: PropertySpace[]) {
  let ready = 0;
  let running = 0;
  let issues = 0;
  for (const p of photos) {
    const styles = new Set(p.generations.map((g) => g.style));
    for (const style of styles) {
      const s = cellState(p, style, false);
      if (s.kind === "ready") ready++;
      if (s.kind === "running" || s.kind === "queued" || (s.kind === "ready" && s.running)) running++;
      if (s.kind === "failed" || s.kind === "uncertain") issues++;
    }
  }
  return {
    photos: photos.length,
    hidden: photos.filter((p) => !p.visible).length,
    spaces: spaces.length,
    unassigned: spaces.length ? photos.filter((p) => !p.spaceId).length : null,
    ready,
    running,
    issues,
  };
}

/** What the buyer's page would miss from the property's data. */
export function missingData(settings: DemoSettings, property: { title: string; location: string | null }) {
  const out: string[] = [];
  if (!property.location) out.push("ubicación");
  if (!settings.operation) out.push("operación");
  if (!settings.price || settings.priceConflict) out.push("precio confirmado");
  if (!settings.description) out.push("descripción");
  return out;
}

export const MAP_SUMMARY: Record<DemoSettings["map"]["precision"], string> = {
  none: "Sin mapa: se muestra solo el texto",
  zone: "Zona (área amplia)",
  approx: "Ubicación aproximada",
  exact: "Dirección exacta",
};

/** The editor's sections; each one is a fold of the same page. */
export const SECTIONS = ["fotos", "datos", "mapa", "condiciones", "marca", "publicacion"] as const;
export type Section = (typeof SECTIONS)[number];
export const isSection = (v: unknown): v is Section => typeof v === "string" && (SECTIONS as readonly string[]).includes(v);

/**
 * The download name of a version: property, space or photo, style and its
 * number in that style ("Depto Güemes - Living - Moderno - v2"; saved as
 * Depto-Guemes-Living-Moderno-v2.jpg). The version number keeps two
 * versions of one style apart.
 */
export function versionFileName(propertyTitle: string, photoName: string, styleLabel: string, version?: number | null) {
  const parts = [propertyTitle, photoName, styleLabel].map((s) => s.trim().slice(0, 40)).filter(Boolean);
  return [...parts, version ? `v${version}` : ""].filter(Boolean).join(" - ").slice(0, 100);
}

/** The created versions of a photo in one style, oldest first, numbered from 1 (discarded ones keep their number). */
export function versionNumber(photo: Pick<EditorPhoto, "generations">, generationId: string) {
  const g = photo.generations.find((x) => x.id === generationId);
  if (!g) return null;
  const same = photo.generations
    .filter((x) => x.style === g.style && x.status === "succeeded")
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const i = same.findIndex((x) => x.id === generationId);
  return i < 0 ? null : i + 1;
}

/** What the large image is showing, in words: never ambiguous between the original, a version and a comparison. */
export type ViewMode = "original" | "version" | "compare";
export function viewLabel(mode: ViewMode, styleLabel: string | null, version?: number | null, versions = 1) {
  if (mode === "original" || !styleLabel) return "Original";
  const name = versions > 1 && version ? `${styleLabel} v${version}` : styleLabel;
  return mode === "compare" ? `Comparando original y ${name}` : `${name} · versión creada`;
}

export type StyleVersions = {
  style: string;
  state: CellState;
  /** Created versions of the style that are not discarded, the one shown on the listing first, then newest first. */
  versions: { generation: GenerationRow; shown: boolean; number: number | null }[];
};
/** Every style of a photo with its real state and its versions, for the versions panel. */
export function photoVersions(photo: EditorPhoto, demoStyles: string[], waiting: Set<string>): StyleVersions[] {
  const discarded = new Set(photo.discarded);
  return cardStyles(photo, demoStyles)
    .map((style) => {
      const versions = photo.generations
        .filter((g) => g.style === style && g.status === "succeeded" && !discarded.has(g.id))
        .map((generation) => ({ generation, shown: photo.shown[style] === generation.id, number: versionNumber(photo, generation.id) }))
        .sort((a, b) => Number(b.shown) - Number(a.shown) || b.generation.created_at.localeCompare(a.generation.created_at));
      return { style, state: cellState(photo, style, waiting.has(taskKey({ photoId: photo.id, style }))), versions };
    })
    .filter((s) => s.state.kind !== "none" || s.versions.length > 0);
}

/**
 * The version the workspace opens a photo with: the one shown on the
 * listing in the main style, else any shown one, else the original. Only a
 * view: nothing is published or chosen by opening it.
 */
export function initialView(photo: EditorPhoto, mainStyle: string): string | null {
  return photo.shown[mainStyle] ?? Object.values(photo.shown)[0] ?? null;
}

/**
 * The room a new version starts with: the space's kind when it can be
 * staged, else the photo's own setting. A photo whose own setting differs
 * from its space is reported as a conflict, never changed silently.
 */
export function initialRoom(photo: Pick<EditorPhoto, "room">, space: PropertySpace | null) {
  const fromSpace = space ? stagingRoomOf(space.roomType) : null;
  return { room: fromSpace ?? photo.room, conflict: fromSpace && fromSpace !== photo.room ? photo.room : null };
}
