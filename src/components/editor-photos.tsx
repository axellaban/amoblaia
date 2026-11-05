"use client";
// "Fotos" of the property editor: one photo at a time. The photos by space
// on the left, the active photo or version large in the middle with its
// versions in a strip below, and on the right two tabs: "Ambientación con
// IA" (open by default) and "Editar". On a phone they stack in that order. What is being looked
// at (the view), which version the listing shows, the cover, the photo's
// visibility and the batch selection are five separate things: choosing a
// version only changes the view, and every other change is its own button.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Download,
  Expand,
  Eye,
  EyeOff,
  ImagePlus,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Star,
  Trash2,
  Undo2,
  WandSparkles,
  X,
  Sofa,
  Bath,
  BedDouble,
  Briefcase,
  ChevronDown,
  ChevronUp,
  CookingPot,
  Flame,
  House,
  LayoutGrid,
  Trees,
  Utensils,
  Zap,
  SlidersHorizontal,
  Link2,
} from "lucide-react";
import { Comparison } from "./comparison";
import { api } from "./admin-demos";
import { rooms } from "@/lib/catalog";
import {
  groupBySpace,
  initialRoom,
  initialView,
  missingTasks,
  photoVersions,
  versionNumber,
  viewLabel,
  type CellState,
  type Task,
  type ViewMode,
} from "@/lib/demos/editor-logic";
import {
  MAX_DEMO_STYLES,
  adminGenerationUrl,
  adminPhotoUrl,
  adminRetouchUrl,
  type RetouchSource,
  photoLabel,
  roomName,
  SPACE_TYPES,
  spaceTypeName,
  styleName,
  type DemoDetail,
  type EditorPhoto,
  type GenerationRow,
  type PropertySpace,
} from "@/lib/demos/shared";
import { DEMO_STYLES as STYLE_LIST, styleFits, type PropertyType } from "@/lib/demos/styles";
import { NO_ADJUST, adjustFilter, sameAdjust, type Adjust } from "@/lib/demos/retouch";
import type { Tool } from "@/lib/demos/tools";
import { MaskBrush, type BrushHandle } from "./mask-brush";
import { track } from "@/lib/analytics";
import { RetouchControls, type ToolsState } from "./retouch-controls";
import { GenerationProgress } from "./generation-progress";

/** A state of one style of one photo, in words: created, in the queue, failed, uncertain… */
export function stateLabel(s: CellState) {
  switch (s.kind) {
    case "ready":
      return s.running ? "Creada · creando otra (la actual se conserva)" : "Creada";
    case "running":
      return "Generando…";
    case "queued":
      return "En cola en el servidor";
    case "waiting":
      return "Pendiente en esta pestaña";
    case "failed":
      return "Falló por un problema técnico (lo reservado se devuelve)";
    case "uncertain":
      return "Resultado técnico incierto: en revisión";
    default:
      return "Sin crear";
  }
}

export type WorkspaceActions = {
  patchPhoto: (photoId: string, body: Record<string, unknown>) => Promise<boolean>;
  move: (photoId: string, step: number) => void;
  spaces: (path: string, init: RequestInit, done?: string) => Promise<boolean>;
  cover: (photoId: string | null) => void;
  remove: (photoId: string) => void;
  upload: (files: FileList | File[], spaceId: string | null) => void;
  /** A photo's original (photoId), an AI version (key), or a retouch (retouchId). */
  download: (photoId: string, key: string, name: string, retouchId?: string) => void;
  /** Saves the retouch of what is viewed as a new version; the new version's id, or null when it failed. */
  retouch: (photoId: string, source: RetouchSource, adjust: Adjust) => Promise<string | null>;
  /** An AI tool on what is viewed: it starts and its result appears as a version. Null when it started, else why not. */
  tool: (photoId: string, tool: Tool, source: RetouchSource, mask?: string) => Promise<string | null>;
  /** What a tool costs and who pays, as the server quotes it. */
  quote: (photoId: string) => Promise<string>;
  review: (photoId: string, generationId: string) => void;
  /** Adds styles to the property's list (6 at most); false when there is no room. */
  addStyles: (styles: string[]) => boolean;
  toggleBatchStyle: (style: string, on: boolean) => void;
  request: (tasks: Task[], opts?: { fresh?: boolean; quoted?: boolean }) => Promise<boolean>;
  cancelPending: () => number;
  notice: (text: string) => void;
};

type Quote = { payer: "team" | "agency"; credits: number | null; newPhotos: number; blocked: string | null };
type Draft = { style: string; mode: "furnish" | "redesign"; room: string };

export function PhotoWorkspace({
  detail,
  base,
  propertyType,
  demoStyles,
  mainStyle,
  blocked,
  payerNote,
  staging,
  included,
  setIncluded,
  downloading,
  fileName,
  originalName,
  busy,
  actions,
  variant = "studio",
  gallery = "spaces",
  onUseInDemo,
  belowGrid = null,
}: {
  /** "flat": Estudio de imágenes, every photo in one gallery (no spaces on screen; they stay saved). "spaces": by space. */
  gallery?: "spaces" | "flat";
  /** Estudio de imágenes: «Usar en una demostración» of what is viewed (photo and version). */
  onUseInDemo?: (photoId: string, versionId: string | null) => void;
  /** "demo": the agency's «Crear demostración interactiva» layout; "studio": Estudio de imágenes and the team's editor. */
  variant?: "studio" | "demo";
  /** The demo's «Generar video», right under the photos. */
  belowGrid?: React.ReactNode;
  detail: DemoDetail;
  base: string;
  propertyType: PropertyType;
  demoStyles: string[];
  mainStyle: string;
  blocked: string | null;
  payerNote: string;
  staging: { queue: Task[]; current: Task | null; waiting: Set<string>; starting: boolean };
  included: Set<string>;
  setIncluded: (fn: (s: Set<string>) => Set<string>) => void;
  downloading: string | null;
  /** The download name of a version: property-space-style-vN. */
  fileName: (photo: EditorPhoto, g: GenerationRow) => string;
  originalName: (photo: EditorPhoto) => string;
  busy: boolean;
  actions: WorkspaceActions;
}) {
  const { photos, spaces } = detail;
  // Imported photos without a ficha: what is chosen is a version, not what a ficha shows.
  const photosOnly = detail.demo.kind === "fotos";
  const shownLabel = photosOnly ? "Versión seleccionada" : "Se muestra en la ficha";
  const flat = gallery === "flat";
  // Estudio de imágenes shows every photo in one gallery: its spaces are kept, never shown there.
  const groups = flat ? [{ space: null, photos: [...photos].sort((a, b) => a.position - b.position) }] : groupBySpace(photos, spaces);
  const [activeId, setActiveId] = useState<string | null>(null);
  // The version being looked at, per photo; null: the original. A view only. ?foto=&version= opens one (from the demo and back).
  const [viewOf, setViewOf] = useState<Record<string, string | null>>(() => {
    if (typeof window === "undefined") return {};
    const q = new URLSearchParams(window.location.search);
    const photoId = q.get("foto");
    const version = q.get("version");
    return photoId && version ? { [photoId]: version === "original" ? null : version } : {};
  });
  const demoUi = variant === "demo";
  // The demo and the studio open each photo compared (before / after) when it has a version.
  const [mode, setMode] = useState<ViewMode>(demoUi || flat ? "compare" : "version");
  // The demo's chosen space when it has no photos yet; and the style «Generar versión con IA» opens with.
  const [pickedSpace, setPickedSpace] = useState<string | null>(null);
  const [generating, setGenerating] = useState<string | null>(null);
  // ?modo=editar (Inicio → «Editar imágenes») opens the editor, not staging. The studio opens on
  // «Editar con IA» unless it comes from a staging action (?modo=ambientar, or a style to create).
  const [tab, setTab] = useState<"create" | "edit">(() => {
    if (typeof window === "undefined") return "create";
    const q = new URLSearchParams(window.location.search);
    if (q.get("modo") === "editar") return "edit";
    return "create";
  });
  // The retouch of each photo, previewed live with CSS filters until it is saved as a version.
  const [adjusts, setAdjusts] = useState<Record<string, Adjust>>({});
  const [saving, setSaving] = useState(false);
  // The AI tool being set up on the photo: its brush (for removing objects) lives over the picture.
  const [tool, setTool] = useState<Tool | null>(null);
  const [toolSize, setToolSize] = useState(60);
  const [painted, setPainted] = useState(false);
  const [toolNote, setToolNote] = useState("");
  const [toolBusy, setToolBusy] = useState(false);
  const [photoEl, setPhotoEl] = useState<HTMLImageElement | null>(null);
  const brush = useRef<BrushHandle>(null);
  const figureRef = useRef<HTMLElement>(null);
  const uid = useId();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [batch, setBatch] = useState(false);
  const [awaiting, setAwaiting] = useState<{ photoId: string; style: string; since: string } | null>(null);
  // The studio's «¡Imagen lista!»: the version just saved or created, while it is the one on screen.
  const [ready, setReady] = useState<{ photoId: string; versionId: string } | null>(null);
  // An AI tool asked here: its result arrives as a new retouch of the photo.
  const [awaitingTool, setAwaitingTool] = useState<{ photoId: string; known: string[] } | null>(null);
  // From the agency's demo (Generar a style, or a photo still without one): ?foto= and ?estilo= open it ready, nothing generated yet.
  const [preset] = useState(() => {
    if (typeof window === "undefined") return null;
    const q = new URLSearchParams(window.location.search);
    const photoId = q.get("foto");
    const style = q.get("estilo");
    return photoId ? { photoId, style: style && STYLE_LIST[propertyType].some((st) => st.id === style) ? style : null } : null;
  });

  // The photo comes from ?foto= (deep link, kept on reload), else the first one.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("foto");
    setActiveId((cur) => cur ?? (photos.some((p) => p.id === wanted) ? wanted : (groups.find((g) => g.photos.length)?.photos[0]?.id ?? null)));
    // Chosen once, when the first photos arrive; later the team picks.
  }, [photos.length > 0]);
  const photo = photos.find((p) => p.id === activeId) ?? groups.find((g) => g.photos.length)?.photos[0] ?? null;
  useEffect(() => {
    if (!photo) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("foto") === photo.id) return;
    url.searchParams.set("foto", photo.id);
    window.history.replaceState(window.history.state, "", url);
  }, [photo]);

  const space = photo ? (spaces.find((s) => s.id === photo.spaceId) ?? null) : null;
  const activeGroup = photo ? groups.find((g) => g.photos.some((p) => p.id === photo.id)) : groups[0];
  const shownIds = photo ? new Set(Object.values(photo.shown)) : new Set<string>();
  const discarded = new Set(photo?.discarded ?? []);
  // The view: what was chosen for this photo while it still exists, else its initial version.
  const chosen = photo ? (photo.id in viewOf ? viewOf[photo.id] : initialView(photo, mainStyle)) : null;
  const viewGen =
    photo && chosen ? (photo.generations.find((g) => g.id === chosen && g.status === "succeeded" && !discarded.has(g.id)) ?? null) : null;
  // A retouch is a version too: shown, compared and downloaded like an AI version, but it has no ficha or AI actions.
  const viewRetouch = photo && chosen ? (photo.retouches.find((r) => r.id === chosen) ?? null) : null;
  const hasView = Boolean(viewGen || viewRetouch);
  const afterUrl = viewRetouch ? adminRetouchUrl(viewRetouch.id, 1600) : viewGen ? adminGenerationUrl(viewGen.id, 1600) : "";
  const viewName = viewRetouch ? viewRetouch.label : viewGen ? styleName(viewGen.style) : "Original";
  const viewSource: RetouchSource = viewRetouch
    ? { kind: "retouch", id: viewRetouch.id }
    : viewGen
      ? { kind: "generation", id: viewGen.id }
      : { kind: "original" };
  const effectiveMode: ViewMode = hasView ? mode : "original";
  const number = photo && viewGen ? versionNumber(photo, viewGen.id) : null;
  const sameStyle = photo && viewGen ? photo.generations.filter((g) => g.style === viewGen.style && g.status === "succeeded").length : 0;
  const label = viewLabel(effectiveMode, hasView ? viewName : null, number, sameStyle);
  const versionsList = photo ? photoVersions(photo, demoStyles, staging.waiting) : [];

  const choose = (photoId: string, generationId: string | null, m: ViewMode = generationId ? "version" : "original") => {
    setViewOf((v) => ({ ...v, [photoId]: generationId }));
    // A different picture starts without adjustments: a saved retouch already carries its own.
    setAdjusts((all) => ({ ...all, [photoId]: NO_ADJUST }));
    setMode(m);
  };
  // Photos uploaded to the empty space on screen: it opens on them.
  const pickedFirst = pickedSpace ? groups.find((g) => (g.space?.id ?? "loose") === pickedSpace)?.photos[0]?.id : undefined;
  useEffect(() => {
    if (!pickedFirst) return;
    setActiveId(pickedFirst);
    setPickedSpace(null);
  }, [pickedFirst]);
  // A version asked from "Crear otra versión" opens by itself when it is ready, unless another view was chosen meanwhile.
  useEffect(() => {
    if (!awaiting) return;
    const p = photos.find((x) => x.id === awaiting.photoId);
    const made = p?.generations.find((g) => g.style === awaiting.style && g.status === "succeeded" && g.created_at >= awaiting.since);
    if (p && made) {
      setAwaiting(null);
      if (activeId === p.id) choose(p.id, made.id);
      if (flat) setReady({ photoId: p.id, versionId: made.id });
    }
    const last = p?.generations.find((g) => g.style === awaiting.style);
    if (last && (last.status === "failed" || last.status === "needs_review") && last.created_at >= awaiting.since) setAwaiting(null);
  }, [photos, awaiting, activeId]);
  // A tool's result (a new retouch) opens by itself on the photo it was asked for.
  useEffect(() => {
    if (!awaitingTool) return;
    const p = photos.find((x) => x.id === awaitingTool.photoId);
    const made = p?.retouches.find((r) => !awaitingTool.known.includes(r.id));
    if (!p || !made) return;
    setAwaitingTool(null);
    if (activeId === p.id) choose(p.id, made.id);
    setReady({ photoId: p.id, versionId: made.id });
  }, [photos, awaitingTool, activeId]);

  if (!photos.length)
    return (
      <div className="pw-empty">
        <p>Todavía no hay fotos. Agregalas acá o desde la publicación original.</p>
        <UploadButton label="Agregar fotos" onFiles={(f) => actions.upload(f, null)} primary />
      </div>
    );
  if (!photo) return null;
  const isCover = detail.demo.cover?.id === photo.id;
  // Every photo in the order of its space (the studio: in their order): what the arrows step through.
  const ordered = groups.flatMap((g) => g.photos);
  const at = ordered.findIndex((p) => p.id === photo.id);
  // The photo's own name, else its place in the space ("Vista 2"; the studio: "Foto 3"): never the space's name twice.
  const name = photo.label?.trim() || (flat ? `Foto ${at + 1}` : `Vista ${(activeGroup?.photos.findIndex((p) => p.id === photo.id) ?? 0) + 1}`);
  /** Another photo to work on: the viewer, its versions and the panel follow it. */
  const pick = (photoId: string, how: "thumb" | "arrow") => {
    setActiveId(photoId);
    if (flat) track("studio_photo_selected", { property_id: detail.demo.id, photo_id: photoId, how });
  };
  const step = (n: number) => pick(ordered[(at + n + ordered.length) % ordered.length].id, "arrow");
  const shownHere = Boolean(viewGen && shownIds.has(viewGen.id));
  const retouchShown = Boolean(viewRetouch && photo.shownRetouch === viewRetouch.id);
  // A version still being made: the clock turns over the photo until it is ready.
  const liveGen = photo?.generations.find((g) => g.status === "queued" || g.status === "running") ?? null;
  const adjust = photo ? (adjusts[photo.id] ?? NO_ADJUST) : NO_ADJUST;
  const retouch = tab === "edit" ? adjustFilter(adjust) : "";
  const setAdjust = (next: Adjust) => photo && setAdjusts((all) => ({ ...all, [photo.id]: next }));
  const brushing = Boolean(photo && tab === "edit" && tool === "remove");
  const pickTool = (next: Tool | null) => {
    setTool(next);
    setPainted(false);
    setToolNote("");
    if (photo && next) void actions.quote(photo.id).then(setToolNote);
    if (flat && next) track("studio_tool_selected", { property_id: detail.demo.id, photo_id: photo.id, tool: next });
  };
  const applyTool = async () => {
    if (!photo || !tool) return;
    const mask = tool === "remove" ? (brush.current?.exportPng() ?? null) : null;
    if (tool === "remove" && !mask) {
      setToolNote("Pintá lo que querés quitar.");
      return;
    }
    setToolBusy(true);
    const known = photo.retouches.map((r) => r.id);
    const error = await actions.tool(photo.id, tool, viewSource, mask ?? undefined);
    setToolBusy(false);
    if (error) {
      setToolNote(`No se inició: ${error}`);
      return;
    }
    if (flat) setAwaitingTool({ photoId: photo.id, known });
    setTool(null);
    setPainted(false);
    setToolNote("");
    brush.current?.clear();
  };
  const toolsState: ToolsState | undefined = photo
    ? {
        tool,
        onPick: pickTool,
        size: toolSize,
        onSize: setToolSize,
        painted,
        onUndo: () => brush.current?.undo(),
        onClear: () => brush.current?.clear(),
        note: toolNote,
        busy: toolBusy,
        onApply: () => void applyTool(),
      }
    : undefined;
  const openCreate = () => {
    if (demoUi) {
      // «Nueva versión»: the window that says the cost first, on a style this photo does not have yet.
      const fresh = STYLE_LIST[propertyType].find((st) => !photo?.shown[st.id]);
      setGenerating(fresh?.id ?? STYLE_LIST[propertyType][0].id);
      return;
    }
    setTab("create");
    document.getElementById(`${uid}-side`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  return (
    <>
      <div className={`pw ${demoUi ? "dx-photos" : ""} ${flat ? "pw-flat" : ""}`} data-testid="photo-workspace">
        {flat ? (
          <FlatGallery photos={ordered} activeId={photo.id} mainStyle={mainStyle} onPick={(id) => pick(id, "thumb")} onUpload={(f) => actions.upload(f, null)} />
        ) : demoUi ? (
          <SpaceList
            groups={groups}
            spaces={spaces}
            active={pickedSpace ?? activeGroup?.space?.id ?? "loose"}
            spacesReady={detail.spacesReady}
            busy={busy}
            actions={actions}
            onPick={(key) => {
              const g = groups.find((x) => (x.space?.id ?? "loose") === key);
              if (g?.photos.length) {
                setPickedSpace(null);
                setActiveId(g.photos[0].id);
              } else setPickedSpace(key);
            }}
          />
        ) : (
        <PhotoNav
          groups={groups}
          spaces={spaces}
          activeId={photo.id}
          activeSpace={activeGroup?.space?.id ?? null}
          coverId={detail.demo.cover?.id ?? null}
          mainStyle={mainStyle}
          spacesReady={detail.spacesReady}
          busy={busy}
          onPick={setActiveId}
          actions={actions}
        />
        )}

        {demoUi && pickedSpace ? (
          <div className="pw-main dx-empty-space">
            <p>
              {spaces.find((x) => x.id === pickedSpace)?.name ?? "Sin organizar"} todavía no tiene fotos.
            </p>
            <UploadButton label="Agregar fotos" primary onFiles={(f) => actions.upload(f, pickedSpace === "loose" ? null : pickedSpace)} />
          </div>
        ) : (
        <div className="pw-main">
          <section className="pw-stage" aria-label="Foto activa">
            <header className="pw-stage-head">
              <button type="button" className="icon-button" aria-label="Foto anterior" disabled={ordered.length < 2} onClick={() => step(-1)}>
                <ChevronLeft size={18} />
              </button>
              {flat ? (
                <div className="pw-stage-title" aria-live="polite">
                  <h3>
                    Foto {at + 1} de {ordered.length}
                  </h3>
                  {photo.label?.trim() && <small>{photo.label.trim()}</small>}
                </div>
              ) : (
              <div className="pw-stage-title">
                <h3>
                  {space ? space.name : "Sin organizar"} · {name}
                </h3>
                <small>
                  Foto {at + 1} de {ordered.length}
                </small>
              </div>
              )}
              <button type="button" className="icon-button" aria-label="Foto siguiente" disabled={ordered.length < 2} onClick={() => step(1)}>
                <ChevronRight size={18} />
              </button>
              {!flat && (
              <span className="pw-badges">
                {hasView && (
                  <span className={`pw-badge ${shownHere ? "is-on" : ""}`}>
                    {viewRetouch ? (retouchShown ? shownLabel : "Retoque guardado") : shownHere ? shownLabel : photosOnly ? "Creada y guardada" : "No se muestra en la ficha"}
                  </span>
                )}
                {!photo.visible && <span className="pw-badge">Oculta en la ficha</span>}
                {isCover && <span className="pw-badge is-on">Portada</span>}
              </span>
              )}
            </header>
            <figure className="pw-figure" ref={figureRef}>
              {hasView && effectiveMode === "compare" && !brushing ? (
                <Comparison
                  before={adminPhotoUrl(photo.id, null, 1600)}
                  after={afterUrl}
                  afterFilter={retouch}
                  beforeLabel={demoUi || flat ? "Antes" : "Original"}
                  beforeAlt={`${name}, foto original`}
                  afterLabel={demoUi || flat ? `Después (${viewName})` : viewName}
                  alt={`${name}, ${viewName}`}
                  initial={50}
                />
              ) : (
                <img
                  ref={setPhotoEl}
                  key={hasView && (effectiveMode === "version" || brushing) ? afterUrl : `o-${photo.id}`}
                  src={hasView && (effectiveMode === "version" || brushing) ? afterUrl : adminPhotoUrl(photo.id, null, 1600)}
                  alt={hasView && effectiveMode === "version" ? `${name}, ${viewName}` : `${name}, foto original`}
                  style={retouch ? { filter: retouch } : undefined}
                />
              )}
              {brushing && photoEl && <MaskBrush ref={brush} image={photoEl} size={toolSize} onChange={setPainted} />}
              {effectiveMode !== "compare" && (
                <figcaption className="pw-caption" aria-live="polite" data-testid="view-label">
                  {label}
                  {viewGen && effectiveMode !== "original" && <span> · Ambientación ilustrativa con IA</span>}
                </figcaption>
              )}
              {viewGen ? (
                <button type="button" className="pw-expand icon-button" aria-label="Ver versión completa" onClick={() => actions.review(photo.id, viewGen.id)}>
                  <Expand size={18} />
                </button>
              ) : (
                flat &&
                !brushing && (
                  <button
                    type="button"
                    className="pw-expand icon-button"
                    aria-label="Ver la foto en pantalla completa"
                    onClick={() => void figureRef.current?.requestFullscreen?.().catch(() => null)}
                  >
                    <Expand size={18} />
                  </button>
                )
              )}
              {liveGen && (
                <div className="pw-generating" role="status" aria-live="polite">
                  <span className="dv2-gen-scan" aria-hidden="true" />
                  <span className="dv2-gen-live">
                    <Sparkles size={14} aria-hidden="true" /> IA trabajando · Creando {styleName(liveGen.style)}
                  </span>
                </div>
              )}
              <div className="pw-tools" role="group" aria-label="Qué ver en la foto grande">
                <button type="button" aria-pressed={effectiveMode === "original"} onClick={() => setMode("original")}>
                  Original
                </button>
                <button
                  type="button"
                  aria-pressed={effectiveMode === "version"}
                  disabled={!hasView && !Object.keys(photo.shown).length}
                  onClick={() => (hasView ? setMode("version") : choose(photo.id, initialView(photo, mainStyle)))}
                >
                  Versión
                </button>
                <button
                  type="button"
                  aria-pressed={effectiveMode === "compare"}
                  disabled={!hasView && !Object.keys(photo.shown).length}
                  onClick={() => (hasView ? setMode("compare") : choose(photo.id, initialView(photo, mainStyle), "compare"))}
                >
                  <Columns2 size={15} aria-hidden="true" /> Comparar
                </button>
              </div>
            </figure>
            {demoUi && (
              <SpaceStrip
                photos={activeGroup?.photos ?? []}
                activeId={photo.id}
                mainStyle={mainStyle}
                coverId={detail.demo.cover?.id ?? null}
                spaceId={activeGroup?.space?.id ?? null}
                spaceName={space ? space.name : "Sin organizar"}
                onPick={setActiveId}
                actions={actions}
              />
            )}
            {!flat && (
            <div className="pw-actions">
              {viewGen && !shownHere && photo.pendingPublic?.includes(viewGen.id) && (
                <span className="pw-badge">Generada en la demo · los compradores la ven cuando la aprobás</span>
              )}
              {viewGen && !shownHere && (
                <button type="button" className="button button-small button-primary" onClick={() => void actions.patchPhoto(photo.id, { approve: viewGen.id })}>
                  <Check size={14} /> Mostrar esta en la ficha
                </button>
              )}
              {viewRetouch && !retouchShown && !photosOnly && (
                <button
                  type="button"
                  className="button button-small button-primary"
                  onClick={() => void actions.patchPhoto(photo.id, { approveRetouch: viewRetouch.id })}
                >
                  <Check size={14} /> Mostrar esta en la ficha
                </button>
              )}
              {!photosOnly && (
                <button
                  type="button"
                  className={`button button-small button-outline ${isCover ? "is-on" : ""}`}
                  aria-pressed={isCover}
                  title={isCover ? "Es la portada: abre la ficha y la vista previa del enlace" : "Usar como portada"}
                  onClick={() => actions.cover(isCover ? null : photo.id)}
                >
                  <Star size={14} /> {isCover ? "Portada" : "Usar de portada"}
                </button>
              )}
              <button
                type="button"
                className={`button button-small button-outline ${photo.visible ? "" : "is-off"}`}
                aria-pressed={!photo.visible}
                onClick={() => void actions.patchPhoto(photo.id, { changes: { visible: !photo.visible } })}
              >
                {photo.visible ? <Eye size={14} /> : <EyeOff size={14} />}{" "}
                {photosOnly
                  ? photo.visible
                    ? "Se incluye si creás la ficha"
                    : "No se incluye en la ficha"
                  : photo.visible
                    ? "Se muestra en la ficha"
                    : "Oculta en la ficha"}
              </button>
              {hasView ? (
                <button
                  type="button"
                  className="button button-small button-outline"
                  data-testid="download-active"
                  disabled={downloading === (viewRetouch?.id ?? viewGen?.id)}
                  onClick={() =>
                    viewRetouch
                      ? actions.download("", `r-${viewRetouch.id}`, `${originalName(photo).replace(/\.jpg$/, "")}-retoque-${viewRetouch.id.slice(0, 6)}.jpg`, viewRetouch.id)
                      : viewGen && actions.download("", viewGen.id, fileName(photo, viewGen))
                  }
                >
                  {downloading === (viewRetouch?.id ?? viewGen?.id) ? <Loader2 size={14} className="spin" /> : <Download size={14} />} Descargar
                </button>
              ) : (
                <button
                  type="button"
                  className="button button-small button-outline"
                  disabled={downloading === `o-${photo.id}`}
                  onClick={() => actions.download(photo.id, `o-${photo.id}`, originalName(photo))}
                >
                  {downloading === `o-${photo.id}` ? <Loader2 size={14} className="spin" /> : <Download size={14} />} Descargar original
                </button>
              )}
              {viewGen && (
                <details className="pw-more">
                  <summary>
                    <MoreHorizontal size={16} aria-hidden="true" /> Más
                  </summary>
                  <div>
                    <button type="button" className="text-link" onClick={() => actions.review(photo.id, viewGen.id)}>
                      Ver en grande
                    </button>
                    <button
                      type="button"
                      className="text-link"
                      onClick={() => {
                        if (window.confirm("La versión deja de mostrarse y queda en el historial de la foto, donde podés recuperarla. ¿Continuar?"))
                          void actions.patchPhoto(photo.id, { discard: viewGen.id });
                      }}
                    >
                      Descartar
                    </button>
                  </div>
                </details>
              )}
            </div>
            )}
            {!flat && <p className="pw-hint">Descargar no usa créditos ni publica nada: JPEG de hasta 2048 px.</p>}
          </section>

          <section className="pw-versions-panel" aria-labelledby={`${uid}-versions`}>
            <div className="pw-versions-head">
              <h4 id={`${uid}-versions`}>Versiones de esta foto</h4>
              <small>Elegir una versión solo cambia lo que ves.</small>
            </div>
            <ul className="pw-versions">
              <li>
                <button type="button" className="pw-version" aria-pressed={flat ? !hasView : !viewGen} onClick={() => choose(photo.id, null, flat ? "original" : undefined)}>
                  <img src={adminPhotoUrl(photo.id, null, 480)} alt="" loading="lazy" />
                  <span>
                    <strong>Original</strong>
                    <small>La foto subida</small>
                  </span>
                </button>
              </li>
              {versionsList.map((s) => (
                <StyleItem
                  key={s.style}
                  shownLabel={shownLabel}
                  s={s}
                  photo={photo}
                  viewing={viewGen?.id ?? null}
                  fits={styleFits(s.style, propertyType)}
                  blocked={blocked}
                  onChoose={(id) => choose(photo.id, id, mode === "compare" ? "compare" : "version")}
                  actions={actions}
                />
              ))}
              {photo.retouches.map((r) => (
                <li key={r.id}>
                  <button type="button" className="pw-version" aria-pressed={chosen === r.id} onClick={() => choose(photo.id, r.id)}>
                    <img src={adminRetouchUrl(r.id, 480)} alt="" loading="lazy" />
                    <span>
                      <strong>{r.label}</strong>
                      <small>{photo.shownRetouch === r.id ? shownLabel : "Retoque guardado"}</small>
                    </span>
                    {photo.shownRetouch === r.id && <Check size={16} className="pw-version-check" aria-label={shownLabel} />}
                  </button>
                </li>
              ))}
              <li>
                <button type="button" className="pw-version pw-version-new" onClick={openCreate}>
                  <span className="pw-version-new-art" aria-hidden="true">
                    <Plus size={20} />
                  </span>
                  <span>
                    <strong>Nueva versión</strong>
                    <small>Con ambientación IA</small>
                  </span>
                </button>
              </li>
            </ul>
          </section>
        </div>
        )}

        <aside id={`${uid}-side`} className={`pw-side ${demoUi ? "dx-side" : ""}`} aria-label={demoUi ? (tab === "create" ? "Ambientar con IA" : "Editar imagen") : "Ambientar y editar"}>
          {demoUi || flat ? (
            <div className="pw-modes" role="group" aria-label="Qué querés hacer" id={`${uid}-what`}>
              {(
                [
                  { id: "create", icon: Sparkles, title: "Ambientar con IA" },
                  { id: "edit", icon: SlidersHorizontal, title: "Editar con IA" },
                ] as const
              ).map(({ id: what, icon: Icon, title }) => (
                <button
                  key={what}
                  type="button"
                  aria-pressed={tab === what}
                  aria-controls={`${uid}-panel`}
                  onClick={() => {
                    if (tab !== what) track("studio_mode_selected", { property_id: detail.demo.id, photo_id: photo.id, mode: what === "create" ? "ambientar" : "editar" });
                    setTab(what);
                    if (what === "create") pickTool(null);
                  }}
                >
                  <Icon size={16} aria-hidden="true" /> {title}
                </button>
              ))}
            </div>
          ) : (
          <h3 className="pw-side-title" id={`${uid}-what`}>¿Qué querés hacer?</h3>
          )}
          {/* Two modes (spec v3 §3.3): staging, or the existing editor with its light, colour and AI tools. */}
          {!demoUi && !flat && (
          <ul className="pw-what pw-what-modes" aria-labelledby={`${uid}-what`}>
            {(
              [
                { id: "create", icon: Sofa, title: "Ambientar con IA", text: "Amoblá o rediseñá el ambiente." },
                { id: "edit", icon: WandSparkles, title: "Editar con IA", text: "Mejorá la foto, quitá objetos o cambiá el cielo." },
              ] as const
            ).map(({ id: what, icon: Icon, title, text }) => (
              <li key={what}>
                <button
                  type="button"
                  className="pw-what-item"
                  aria-pressed={tab === what}
                  aria-controls={`${uid}-panel`}
                  onClick={() => {
                    setTab(what);
                    if (what === "create") pickTool(null);
                  }}
                >
                  <span className="pw-what-icon" aria-hidden="true">
                    <Icon size={18} />
                  </span>
                  <span className="pw-what-text">
                    <strong>{title}</strong>
                    <small>{text}</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          )}
          <div id={`${uid}-panel`} className="pw-what-panel" aria-labelledby={`${uid}-what`}>
            {tab === "create" && demoUi ? (
              <DemoStyles
                key={photo.id}
                photo={photo}
                space={space}
                propertyType={propertyType}
                demoStyles={demoStyles}
                waiting={staging.waiting}
                viewing={viewGen?.style ?? null}
                blocked={blocked}
                onView={(generationId) => choose(photo.id, generationId, "compare")}
                onGenerate={setGenerating}
              />
            ) : tab === "create" ? (
              <CreatePanel
                key={photo.id}
                photo={photo}
                photoName={name}
                space={space}
                base={base}
                propertyType={propertyType}
                demoStyles={demoStyles}
                staging={detail.staging}
                payerNote={payerNote}
                waiting={staging.waiting}
                draft={drafts[photo.id]}
                preset={preset?.photoId === photo.id ? preset : null}
                compact={flat}
                onViewVersion={flat ? (generationId) => choose(photo.id, generationId, "compare") : undefined}
                onStylePicked={flat ? (style) => track("studio_style_selected", { property_id: detail.demo.id, photo_id: photo.id, style }) : undefined}
                onDraft={(d) => setDrafts((all) => ({ ...all, [photo.id]: d }))}
                onConfirm={async (task, fresh) => {
                  const since = new Date(Date.now() - 5000).toISOString();
                  if (!actions.addStyles([task.style])) return false;
                  const ok = await actions.request([task], { fresh, quoted: true });
                  if (ok) {
                    setAwaiting({ photoId: task.photoId, style: task.style, since });
                    setDrafts((all) => {
                      const { [photo.id]: _done, ...rest } = all;
                      return rest;
                    });
                  }
                  return ok;
                }}
              />
            ) : (
              <EditPanel
                compact={flat || demoUi}
                hideSpace={flat}
                photo={photo}
                viewing={label}
                adjust={adjust}
                onAdjust={setAdjust}
                saving={saving}
                tools={toolsState}
                onSave={async () => {
                  setSaving(true);
                  try {
                    const id = await actions.retouch(photo.id, viewSource, adjust);
                    if (id) {
                      setAdjust(NO_ADJUST);
                      choose(photo.id, id);
                      if (flat) {
                        setReady({ photoId: photo.id, versionId: id });
                        track("studio_version_saved", { property_id: detail.demo.id, photo_id: photo.id, kind: "retouch", from: viewSource.kind });
                      }
                    }
                  } finally {
                    setSaving(false);
                  }
                }}
                spaces={spaces}
                propertyType={propertyType}
                index={photos.indexOf(photo)}
                total={photos.length}
                actions={actions}
              />
            )}
          </div>
          {flat && (
            <ResultActions
              photo={photo}
              ready={Boolean(ready && ready.photoId === photo.id && ready.versionId === chosen && hasView)}
              viewName={hasView ? viewName : "Original"}
              downloading={downloading === (viewRetouch?.id ?? viewGen?.id ?? `o-${photo.id}`)}
              photosOnly={photosOnly}
              onDownload={() =>
                viewRetouch
                  ? actions.download("", `r-${viewRetouch.id}`, `${originalName(photo).replace(/\.jpg$/, "")}-retoque-${viewRetouch.id.slice(0, 6)}.jpg`, viewRetouch.id)
                  : viewGen
                    ? actions.download("", viewGen.id, fileName(photo, viewGen))
                    : actions.download(photo.id, `o-${photo.id}`, originalName(photo))
              }
              onUseInDemo={onUseInDemo ? () => onUseInDemo(photo.id, viewGen?.id ?? viewRetouch?.id ?? null) : undefined}
              more={
                <>
                  {viewGen && !shownHere && !photosOnly && photo.pendingPublic?.includes(viewGen.id) && (
                    <span className="pw-badge">Generada en la demo · los compradores la ven cuando la aprobás</span>
                  )}
                  {viewGen && !shownHere && !photosOnly && (
                    <button type="button" className="button button-small button-outline" onClick={() => void actions.patchPhoto(photo.id, { approve: viewGen.id })}>
                      <Check size={14} /> Mostrar esta en la ficha
                    </button>
                  )}
                  {viewRetouch && !retouchShown && !photosOnly && (
                    <button type="button" className="button button-small button-outline" onClick={() => void actions.patchPhoto(photo.id, { approveRetouch: viewRetouch.id })}>
                      <Check size={14} /> Mostrar esta en la ficha
                    </button>
                  )}
                  {(shownHere || retouchShown) && <span className="pw-badge is-on">{shownLabel}</span>}
                  {!photosOnly && (
                    <button
                      type="button"
                      className={`button button-small button-outline ${isCover ? "is-on" : ""}`}
                      aria-pressed={isCover}
                      onClick={() => actions.cover(isCover ? null : photo.id)}
                    >
                      <Star size={14} /> {isCover ? "Portada" : "Usar de portada"}
                    </button>
                  )}
                  <button
                    type="button"
                    className={`button button-small button-outline ${photo.visible ? "" : "is-off"}`}
                    aria-pressed={!photo.visible}
                    onClick={() => void actions.patchPhoto(photo.id, { changes: { visible: !photo.visible } })}
                  >
                    {photo.visible ? <Eye size={14} /> : <EyeOff size={14} />}{" "}
                    {photosOnly ? (photo.visible ? "Se incluye si creás la ficha" : "No se incluye en la ficha") : photo.visible ? "Se muestra en la ficha" : "Oculta en la ficha"}
                  </button>
                  {viewGen && (
                    <button
                      type="button"
                      className="text-link"
                      onClick={() => {
                        if (window.confirm("La versión deja de mostrarse y queda en el historial de la foto, donde podés recuperarla. ¿Continuar?"))
                          void actions.patchPhoto(photo.id, { discard: viewGen.id });
                      }}
                    >
                      Descartar esta versión
                    </button>
                  )}
                </>
              }
            />
          )}
        </aside>
      </div>

      {belowGrid}
      {generating && photo && (
        <GenerateDialog
          photo={photo}
          photoName={name}
          space={space}
          base={base}
          propertyType={propertyType}
          demoStyles={demoStyles}
          staging={detail.staging}
          waiting={staging.waiting}
          initialStyle={generating}
          onClose={() => setGenerating(null)}
          onConfirm={async (task, fresh) => {
            const since = new Date(Date.now() - 5000).toISOString();
            if (!actions.addStyles([task.style])) return false;
            const ok = await actions.request([task], { fresh, quoted: true });
            if (ok) setAwaiting({ photoId: task.photoId, style: task.style, since });
            return ok;
          }}
        />
      )}

      <div className="pw-batch-bar">
        <span>
          <strong>¿Querés trabajar varias fotos?</strong>
          <small>La edición de a una foto queda siempre disponible.</small>
        </span>
        <button type="button" className="button button-small button-outline" aria-expanded={batch} aria-controls="pw-batch" onClick={() => setBatch((v) => !v)}>
          {batch ? "Cerrar trabajo por tandas" : "Seleccionar fotos para una tanda"}
        </button>
      </div>
      {batch && (
        <BatchPanel
          flat={flat}
          detail={detail}
          groups={groups}
          demoStyles={demoStyles}
          propertyType={propertyType}
          included={included}
          setIncluded={setIncluded}
          staging={staging}
          blocked={blocked}
          actions={actions}
        />
      )}
    </>
  );
}

/** One style in the versions panel: its state, its versions (pick to view), and the next action when it has none. */
function StyleItem({
  shownLabel,
  s,
  photo,
  viewing,
  fits,
  blocked,
  onChoose,
  actions,
}: {
  /** "Se muestra en la ficha", or "Versión seleccionada" while there is no ficha. */
  shownLabel: string;
  s: ReturnType<typeof photoVersions>[number];
  photo: EditorPhoto;
  viewing: string | null;
  fits: boolean;
  blocked: string | null;
  onChoose: (generationId: string) => void;
  actions: WorkspaceActions;
}) {
  const name = styleName(s.style);
  const live = s.state.kind === "running" || s.state.kind === "queued" || s.state.kind === "waiting" || (s.state.kind === "ready" && s.state.running);
  const many = s.versions.length > 1;
  return (
    <>
      {s.versions.map((v) => (
        <li key={v.generation.id}>
          <button type="button" className="pw-version" aria-pressed={viewing === v.generation.id} onClick={() => onChoose(v.generation.id)}>
            <img src={adminGenerationUrl(v.generation.id, 480)} alt="" loading="lazy" />
            <span>
              <strong>
                {name}
                {many && v.number ? ` v${v.number}` : ""}
              </strong>
              <small>
                {v.shown ? shownLabel : "Creada · guardada"}
                {!fits ? " · de otro tipo de inmueble" : ""}
              </small>
            </span>
            {v.shown && <Check size={16} className="pw-version-check" aria-label={shownLabel} />}
          </button>
        </li>
      ))}
      {(s.state.kind !== "ready" || live) && (
        <li className={`pw-version-state is-${s.state.kind}`}>
          <span className="pw-version-icon" aria-hidden="true">
            {live ? <Loader2 size={16} className="spin" /> : s.state.kind === "failed" ? <X size={16} /> : null}
          </span>
          <span>
            <strong>{s.versions.length ? `${name} · nueva` : name}</strong>
            <small>{stateLabel(live && s.state.kind === "ready" ? { kind: "running", generationId: "" } : s.state)}</small>
            {s.state.kind === "uncertain" && (
              <small className="pc-note">
                No sabemos si terminó bien: no se reintenta solo. Descartalo para crear otra, o esperá a que el equipo lo concilie.
              </small>
            )}
          </span>
          {s.state.kind === "failed" && fits && (
            <button
              type="button"
              className="button button-small"
              disabled={Boolean(blocked)}
              title={blocked ?? undefined}
              onClick={() => void actions.request([{ photoId: photo.id, style: s.style }])}
            >
              <RefreshCw size={14} /> Reintentar
            </button>
          )}
          {s.state.kind === "uncertain" && (
            <button
              type="button"
              className="button button-small button-outline"
              disabled={Boolean(blocked)}
              onClick={async () => {
                if (!window.confirm("Se descarta el resultado en revisión y se crea una versión nueva de este estilo. ¿Continuar?")) return;
                const st = s.state as Extract<CellState, { kind: "uncertain" }>;
                if (await actions.patchPhoto(photo.id, { discard: st.generation.id })) void actions.request([{ photoId: photo.id, style: s.style }], { fresh: true });
              }}
            >
              Descartar y crear otra
            </button>
          )}
        </li>
      )}
    </>
  );
}

/**
 * Estudio de imágenes: «Todas las fotos (N)», one gallery without spaces. Two
 * thumbnails a row on a computer (scrolling down), a strip on a phone; the
 * active one in green with its check, and «Agregar fotos» at the end.
 */
function FlatGallery({
  photos,
  activeId,
  mainStyle,
  onPick,
  onUpload,
}: {
  photos: EditorPhoto[];
  activeId: string;
  mainStyle: string;
  onPick: (photoId: string) => void;
  onUpload: (files: FileList) => void;
}) {
  const activeRef = useRef<HTMLButtonElement>(null);
  // The active photo stays in sight when the arrows change it.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId]);
  return (
    <nav className="pw-gallery" aria-labelledby="pw-gallery-title">
      <h3 id="pw-gallery-title" className="pw-gallery-title">
        Todas las fotos <span>({photos.length})</span>
      </h3>
      <ul className="pw-gallery-grid">
        {photos.map((p, i) => (
          <li key={p.id}>
            <button
              ref={p.id === activeId ? activeRef : undefined}
              type="button"
              className="pw-thumb"
              aria-pressed={p.id === activeId}
              aria-label={`Foto ${i + 1}${p.label?.trim() ? `: ${p.label.trim()}` : ""}`}
              onClick={() => onPick(p.id)}
            >
              <img src={p.shown[mainStyle] ? adminGenerationUrl(p.shown[mainStyle], 480) : adminPhotoUrl(p.id, null, 480)} alt="" loading="lazy" />
              {p.id === activeId && (
                <span className="pw-thumb-check" aria-hidden="true">
                  <Check size={13} strokeWidth={3} />
                </span>
              )}
            </button>
          </li>
        ))}
        <li className="pw-gallery-add-item">
          <UploadButton label="Agregar fotos" onFiles={onUpload} />
        </li>
      </ul>
    </nav>
  );
}

/**
 * The studio's result of what is on screen: download it and, as a secondary
 * choice, use it in a demo. «¡Imagen lista!» right after it was saved or
 * created. What a ficha shows (version, cover, visibility) is folded under
 * «Opciones de la ficha»: viewing or saving a version never publishes it.
 */
function ResultActions({
  photo,
  ready,
  viewName,
  downloading,
  photosOnly,
  onDownload,
  onUseInDemo,
  more,
}: {
  photo: EditorPhoto;
  ready: boolean;
  viewName: string;
  downloading: boolean;
  photosOnly: boolean;
  onDownload: () => void;
  onUseInDemo?: () => void;
  more: React.ReactNode;
}) {
  return (
    <section className={`pw-result ${ready ? "is-ready" : ""}`} aria-label="Resultado" aria-live="polite" key={photo.id}>
      {ready ? (
        <div className="pw-result-head">
          <span className="pw-result-icon" aria-hidden="true">
            <Check size={20} strokeWidth={3} />
          </span>
          <span>
            <strong>¡Imagen lista!</strong>
            <small>Guardada como nueva versión: {viewName}.</small>
          </span>
        </div>
      ) : (
        <p className="pw-result-on">
          En pantalla: <strong>{viewName}</strong>
        </p>
      )}
      <button type="button" className="button button-outline pw-result-button" disabled={downloading} onClick={onDownload} data-testid="download-active">
        {downloading ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Download size={16} aria-hidden="true" />} Descargar imagen
      </button>
      {onUseInDemo && (
        <button type="button" className="button button-outline pw-result-button" onClick={onUseInDemo}>
          <Link2 size={16} aria-hidden="true" /> Usar en una demostración
        </button>
      )}
      <p className="pw-hint">Descargar no usa créditos ni publica nada: JPEG de hasta 2048 px.</p>
      <details className="pw-result-more">
        <summary>{photosOnly ? "Opciones de la foto" : "Opciones de la ficha"}</summary>
        <div>{more}</div>
      </details>
    </section>
  );
}

function UploadButton({ label, onFiles, primary = false }: { label: string; onFiles: (files: FileList) => void; primary?: boolean }) {
  return (
    <label className={primary ? "button button-primary" : "button button-small button-outline pw-add"}>
      <ImagePlus size={primary ? 16 : 15} aria-hidden="true" /> {label}
      <input
        type="file"
        className="dm-hidden-input"
        accept="image/jpeg,image/png,image/webp"
        multiple
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </label>
  );
}

/** Every photo, by space: pick one to work on it; upload, a new space and the active space's settings. */
function PhotoNav({
  groups,
  spaces,
  activeId,
  activeSpace,
  coverId,
  mainStyle,
  spacesReady,
  busy,
  onPick,
  actions,
}: {
  groups: ReturnType<typeof groupBySpace>;
  spaces: PropertySpace[];
  activeId: string;
  activeSpace: string | null;
  coverId: string | null;
  mainStyle: string;
  spacesReady: boolean;
  busy: boolean;
  onPick: (photoId: string) => void;
  actions: WorkspaceActions;
}) {
  const [adding, setAdding] = useState(false);
  const total = groups.reduce((n, g) => n + g.photos.length, 0);
  const current = spaces.find((s) => s.id === activeSpace) ?? null;
  return (
    <nav className="pw-spaces" aria-label="Fotos por espacio">
      <p className="pw-kicker">
        Fotos · {total}
      </p>
      {groups.map((g) => (
        <section key={g.space?.id ?? "loose"} className="pw-space" aria-label={g.space ? g.space.name : "Sin organizar"}>
          <h4 aria-current={(g.space?.id ?? null) === activeSpace ? "true" : undefined}>
            <span>{g.space ? g.space.name : "Sin organizar"}</span>
            <small>{g.photos.length || "Sin fotos"}</small>
          </h4>
          {g.photos.length > 0 && (
            <div className="pw-space-photos">
              {g.photos.map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  className="pw-thumb"
                  aria-pressed={p.id === activeId}
                  aria-label={`${g.space ? g.space.name : "Sin organizar"}, foto ${i + 1}: ${photoLabel(p)}${p.visible ? "" : " (oculta)"}${p.id === coverId ? " (portada)" : ""}`}
                  onClick={() => onPick(p.id)}
                >
                  <img src={p.shown[mainStyle] ? adminGenerationUrl(p.shown[mainStyle], 480) : adminPhotoUrl(p.id, null, 480)} alt="" loading="lazy" />
                  {!p.visible && <EyeOff size={13} className="pw-thumb-off" aria-hidden="true" />}
                  {p.id === coverId && <Star size={12} className="pw-thumb-cover" aria-hidden="true" />}
                </button>
              ))}
            </div>
          )}
        </section>
      ))}
      <UploadButton label="Subir fotos" onFiles={(f) => actions.upload(f, activeSpace)} />
      {spacesReady ? (
        adding ? (
          <NewSpace
            disabled={busy}
            onCancel={() => setAdding(false)}
            onCreate={async (name, roomType) => {
              const ok = await actions.spaces("", { method: "POST", body: JSON.stringify({ name, roomType }) }, `Espacio «${name.trim()}» creado.`);
              if (ok) setAdding(false);
              return ok;
            }}
          />
        ) : (
          <button type="button" className="pw-add-space" onClick={() => setAdding(true)}>
            <Plus size={14} /> Nuevo espacio
          </button>
        )
      ) : (
        <p className="dm-help">Para organizar por espacios falta aplicar la migración 202610310001_property_spaces.sql.</p>
      )}
      {current && <SpaceMenu space={current} spaces={spaces} count={groups.find((g) => g.space?.id === current.id)?.photos.length ?? 0} actions={actions} />}
    </nav>
  );
}

/** The active space: rename, kind, order and delete (its photos go elsewhere, never deleted). */
function SpaceMenu({ space, spaces, count, actions }: { space: PropertySpace; spaces: PropertySpace[]; count: number; actions: WorkspaceActions }) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [moveTo, setMoveTo] = useState("");
  const ids = spaces.map((s) => s.id);
  const at = ids.indexOf(space.id);
  const reorder = (step: number) => {
    const next = [...ids];
    [next[at], next[at + step]] = [next[at + step], next[at]];
    void actions.spaces("", { method: "PATCH", body: JSON.stringify({ order: next }) });
  };
  return (
    <details className="pw-space-menu">
      <summary>
        <MoreHorizontal size={14} /> {space.name}: ajustes
      </summary>
      <div>
        {editing ? (
          <input
            defaultValue={space.name}
            maxLength={60}
            aria-label="Nombre del espacio"
            autoFocus
            onBlur={(e) => {
              setEditing(false);
              if (e.target.value.trim() && e.target.value.trim() !== space.name)
                void actions.spaces(`/${space.id}`, { method: "PATCH", body: JSON.stringify({ name: e.target.value }) });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setEditing(false);
            }}
          />
        ) : (
          <button type="button" className="text-link" onClick={() => setEditing(true)}>
            <Pencil size={13} /> Renombrar
          </button>
        )}
        <label>
          Tipo
          <select
            value={space.roomType}
            onChange={(e) => void actions.spaces(`/${space.id}`, { method: "PATCH", body: JSON.stringify({ roomType: e.target.value }) })}
          >
            {SPACE_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <span className="pw-row">
          <button type="button" className="icon-button" aria-label="Subir espacio" disabled={at <= 0} onClick={() => reorder(-1)}>
            <ArrowUp size={14} />
          </button>
          <button type="button" className="icon-button" aria-label="Bajar espacio" disabled={at >= ids.length - 1} onClick={() => reorder(1)}>
            <ArrowDown size={14} />
          </button>
          <button type="button" className="text-link dm-danger" onClick={() => setDeleting(true)}>
            <Trash2 size={13} /> Eliminar espacio
          </button>
        </span>
        {deleting && (
          <div className="sp-delete" role="group" aria-label={`Eliminar ${space.name}`}>
            <p>
              Se elimina el espacio, no sus fotos ni sus versiones.
              {count ? ` ¿Adónde van sus ${count} ${count === 1 ? "foto" : "fotos"}?` : ""}
            </p>
            {count > 0 && (
              <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} aria-label="Destino de las fotos">
                <option value="">Sin organizar</option>
                {spaces
                  .filter((s) => s.id !== space.id)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            )}
            <button
              type="button"
              className="button button-small"
              onClick={() => {
                setDeleting(false);
                void actions.spaces(
                  `/${space.id}${moveTo ? `?destino=${moveTo}` : ""}`,
                  { method: "DELETE" },
                  `Espacio eliminado; sus fotos quedaron en ${moveTo ? spaces.find((s) => s.id === moveTo)?.name : "Sin organizar"}.`,
                );
              }}
            >
              Eliminar espacio
            </button>
            <button type="button" className="text-link" onClick={() => setDeleting(false)}>
              Cancelar
            </button>
          </div>
        )}
      </div>
    </details>
  );
}

/** "Editar": the retouch of the photo the large view shows, like the studio's editor: light and colour, AI tools, then the photo's settings. */
function EditPanel({
  compact = false,
  hideSpace = false,
  photo,
  viewing,
  adjust,
  onAdjust,
  saving,
  onSave,
  tools,
  spaces,
  propertyType,
  index,
  total,
  actions,
}: {
  /** Estudio de imágenes: the controls first, the approved names («Guardar versión»), no spaces. */
  compact?: boolean;
  hideSpace?: boolean;
  photo: EditorPhoto;
  /** What the large photo shows, in words. */
  viewing: string;
  adjust: Adjust;
  onAdjust: (next: Adjust) => void;
  saving: boolean;
  onSave: () => void;
  tools?: ToolsState;
  spaces: PropertySpace[];
  propertyType: PropertyType;
  index: number;
  total: number;
  actions: WorkspaceActions;
}) {
  const dirty = !sameAdjust(adjust, NO_ADJUST);
  return (
    <div className={`pw-edit ${compact ? "pw-edit-compact" : ""}`}>
      {compact ? (
        <p className="pw-edit-on" aria-live="polite">
          Editando: <strong>{viewing}</strong>
          {dirty && <span className="pw-badge is-on">Sin guardar</span>}
        </p>
      ) : (
      <div className="pw-edit-head">
        <div>
          <p className="pw-kicker">Editando</p>
          <h3 className="pw-title">{viewing}</h3>
        </div>
        {dirty && <span className="pw-badge is-on">Sin guardar</span>}
      </div>
      )}

      <RetouchControls id={photo.id} adjust={adjust} onAdjust={onAdjust} tools={tools} layout={compact ? "tiles" : "list"} />

      <div className="pw-edit-actions">
        <button type="button" className="button button-outline button-small" disabled={!dirty} onClick={() => onAdjust(NO_ADJUST)}>
          Descartar
        </button>
        <button type="button" className="button button-primary button-small" disabled={!dirty || saving} onClick={onSave}>
          {saving ? <Loader2 size={14} className="spin" /> : compact ? <Check size={15} aria-hidden="true" /> : null}{" "}
          {saving ? "Guardando…" : compact ? "Guardar versión" : "Guardar como versión"}
        </button>
      </div>
      <p className="pw-hint">Guardar crea una versión nueva, sin créditos. El original no se toca.</p>

      <PhotoSettings photo={photo} spaces={spaces} propertyType={propertyType} index={index} total={total} actions={actions} hideSpace={hideSpace} />
    </div>
  );
}

/** "Ajustes de la foto": name, space, defaults for new versions, order, discarded versions and delete. */
function PhotoSettings({
  photo,
  spaces,
  propertyType,
  index,
  total,
  actions,
  hideSpace = false,
}: {
  /** Estudio de imágenes does not show spaces: the photo keeps its own. */
  hideSpace?: boolean;
  photo: EditorPhoto;
  spaces: PropertySpace[];
  propertyType: PropertyType;
  index: number;
  total: number;
  actions: WorkspaceActions;
}) {
  const uid = useId();
  const live = photo.generations.some((g) => g.status === "queued" || g.status === "running");
  const discardedDone = photo.generations.filter((g) => g.status === "succeeded" && photo.discarded.includes(g.id));
  return (
    <details className="pw-settings">
      <summary>Ajustes de la foto</summary>
      <div className="pw-settings-body">
        <label htmlFor={`${uid}-name`}>Nombre</label>
        <input
          id={`${uid}-name`}
          key={photo.id}
          defaultValue={photo.label ?? ""}
          placeholder={roomName(photo.room)}
          maxLength={80}
          onBlur={(e) => {
            if ((photo.label ?? "") !== e.target.value.trim()) void actions.patchPhoto(photo.id, { changes: { label: e.target.value } });
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
        {!hideSpace && (
          <>
        <label htmlFor={`${uid}-space`}>Espacio</label>
        <select
          id={`${uid}-space`}
          value={photo.spaceId ?? ""}
          disabled={!spaces.length}
          onChange={(e) => void actions.spaces("", { method: "PATCH", body: JSON.stringify({ photoIds: [photo.id], spaceId: e.target.value || null }) })}
        >
          <option value="">Sin organizar</option>
          {spaces.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
          </>
        )}
        {propertyType === "residential" && (
          <>
            <label htmlFor={`${uid}-room`}>Ambiente para crear</label>
            <select id={`${uid}-room`} value={photo.room} disabled={live} onChange={(e) => void actions.patchPhoto(photo.id, { changes: { room: e.target.value } })}>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </>
        )}
        <span className="pw-row">
          <button type="button" className="button button-small button-outline" disabled={index <= 0} onClick={() => actions.move(photo.id, -1)}>
            <ArrowUp size={14} /> Antes
          </button>
          <button type="button" className="button button-small button-outline" disabled={index >= total - 1} onClick={() => actions.move(photo.id, 1)}>
            <ArrowDown size={14} /> Después
          </button>
        </span>
        {discardedDone.length > 0 && (
          <div className="pw-discarded">
            <p>Versiones descartadas</p>
            <ul>
              {discardedDone.map((g) => (
                <li key={g.id}>
                  <img src={adminGenerationUrl(g.id, 480)} alt="" loading="lazy" />
                  <span>
                    {styleName(g.style)} v{versionNumber(photo, g.id)}
                  </span>
                  <button type="button" className="text-link" onClick={() => void actions.patchPhoto(photo.id, { restore: g.id })}>
                    <Undo2 size={13} /> Recuperar
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <button type="button" className="text-link dm-danger" disabled={live} onClick={() => actions.remove(photo.id)}>
          <Trash2 size={14} /> Eliminar foto
        </button>
      </div>
    </details>
  );
}

/**
 * "Ambientación con IA": one action and one style for this photo, the cost
 * and who pays from the server before anything starts, and a confirmation.
 * A refused request keeps what was chosen (per photo).
 */
function CreatePanel({
  photo,
  photoName,
  space,
  base,
  propertyType,
  demoStyles,
  staging,
  payerNote,
  waiting,
  draft,
  preset = null,
  compact = false,
  onViewVersion,
  onStylePicked,
  onDraft,
  onConfirm,
}: {
  /** Estudio de imágenes: the styles first, the cost on the button, the other options folded. */
  compact?: boolean;
  /** Picking a style this photo already has shows that version (no credits). */
  onViewVersion?: (generationId: string) => void;
  onStylePicked?: (style: string) => void;
  /** Chosen in the agency's demo before its panel was its own: the photo, and the style when it picked one. */
  preset?: { photoId: string; style: string | null } | null;
  photo: EditorPhoto;
  photoName: string;
  space: PropertySpace | null;
  base: string;
  propertyType: PropertyType;
  demoStyles: string[];
  staging: DemoDetail["staging"];
  payerNote: string;
  waiting: Set<string>;
  draft: Draft | undefined;
  onDraft: (d: Draft) => void;
  onConfirm: (task: Task, fresh: boolean) => Promise<boolean>;
}) {
  const uid = useId();
  const roomStart = initialRoom(photo, space);
  const options = useMemo(() => photoVersions(photo, STYLE_LIST[propertyType].map((s) => s.id), waiting), [photo, propertyType, waiting]);
  const stateOf = (style: string) => options.find((o) => o.style === style)?.state ?? ({ kind: "none" } as CellState);
  const [value, setValue] = useState<Draft>(
    () =>
      draft ?? {
        style: preset?.style ?? demoStyles.find((s) => stateOf(s).kind === "none") ?? demoStyles[0] ?? "",
        mode: photo.mode,
        room: roomStart.room,
      },
  );
  const [quote, setQuote] = useState<Quote | null>(null);
  const [step, setStep] = useState<"choose" | "confirm">("choose");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [working, setWorking] = useState(false);
  // The studio says the cost on the button before anything starts: asking the server costs nothing.
  const [estimate, setEstimate] = useState<Quote | null>(null);
  useEffect(() => {
    if (!compact || staging?.payer !== "agency") return;
    let live = true;
    api<Quote>(`${base}/costo`, { method: "POST", body: JSON.stringify({ photoIds: [photo.id] }) })
      .then((q) => live && setEstimate(q))
      .catch(() => live && setEstimate(null));
    return () => {
      live = false;
    };
  }, [compact, base, photo.id, staging?.payer]);
  const set = (patch: Partial<Draft>) => {
    const next = { ...value, ...patch };
    setValue(next);
    onDraft(next);
    setStep("choose");
    setQuote(null);
    setDone("");
  };
  const state = stateOf(value.style);
  const exists = state.kind === "ready";
  const live = state.kind === "running" || state.kind === "queued" || state.kind === "waiting" || (state.kind === "ready" && state.running);
  // Since when this style is being created: the server's record, or the moment this tab asked for it.
  const liveRow = live ? photo.generations.find((g) => g.style === value.style && (g.status === "queued" || g.status === "running")) : undefined;
  const askedAt = useMemo(() => Date.now(), [photo.id, value.style, live]);
  const liveSince = liveRow ? Math.min(Date.parse(liveRow.created_at) || askedAt, Date.now()) : askedAt;
  const progress = live && !staging?.blocked;
  const why =
    staging?.blocked ??
    (live
      ? "Ese estilo ya se está creando para esta foto."
      : state.kind === "uncertain"
        ? "Ese estilo tiene un resultado en revisión técnica: descartalo antes de crear otro."
        : !value.style
          ? "Elegí un estilo."
          : null);

  const moreFields = (
    <>
      <div className="pw-field">
        <span id={`${uid}-mode`}>Qué querés hacer</span>
        <div className="pw-seg" role="group" aria-labelledby={`${uid}-mode`}>
          <button type="button" aria-pressed={value.mode === "furnish"} onClick={() => set({ mode: "furnish" })}>
            Amoblar
          </button>
          <button type="button" aria-pressed={value.mode === "redesign"} onClick={() => set({ mode: "redesign" })}>
            Rediseñar
          </button>
        </div>
        <small>{value.mode === "furnish" ? "El espacio está vacío: lo amoblamos." : "Ya tiene muebles: los cambiamos por otros."}</small>
      </div>
      {propertyType === "residential" &&
        (roomStart.conflict ? (
          <fieldset className="pw-conflict">
            <legend>El ambiente no coincide</legend>
            <p className="dm-help">
              El espacio es {spaceTypeName(space!.roomType)} y esta foto tenía «{roomName(roomStart.conflict)}» como ajuste propio.
            </p>
            <label>
              <input type="radio" name={`${uid}-room`} checked={value.room === roomStart.room} onChange={() => set({ room: roomStart.room })} />
              Crear como {roomName(roomStart.room)} (el espacio)
            </label>
            <label>
              <input type="radio" name={`${uid}-room`} checked={value.room === roomStart.conflict} onChange={() => set({ room: roomStart.conflict! })} />
              Mantener {roomName(roomStart.conflict)} (la foto)
            </label>
          </fieldset>
        ) : (
          <label className="pw-field">
            Ambiente
            <select value={value.room} onChange={(e) => set({ room: e.target.value })}>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        ))}
    </>
  );
  async function review() {
    setError("");
    setWorking(true);
    try {
      setQuote(
        staging?.payer === "agency"
          ? await api<Quote>(`${base}/costo`, { method: "POST", body: JSON.stringify({ photoIds: [photo.id] }) })
          : { payer: "team", credits: null, newPhotos: 0, blocked: null },
      );
      setStep("confirm");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos calcular el costo. Probá de nuevo.");
    } finally {
      setWorking(false);
    }
  }
  async function confirm() {
    setError("");
    setWorking(true);
    try {
      const ok = await onConfirm(
        { photoId: photo.id, style: value.style, mode: value.mode, ...(propertyType === "residential" ? { room: value.room } : {}) },
        exists,
      );
      if (ok) {
        setStep("choose");
        setQuote(null);
        setDone(`Creando ${styleName(value.style)}: aparece en «Versiones de esta foto» y se abre sola cuando esté lista.`);
      } else setError("No se inició: revisá el mensaje del editor. Lo que elegiste se conserva.");
    } finally {
      setWorking(false);
    }
  }
  return (
    <form
      className="pw-create"
      aria-label="Crear una versión con IA"
      onSubmit={(e) => {
        e.preventDefault();
        if (step === "choose") void review();
        else void confirm();
      }}
    >
      {!compact && (
        <p className="dm-help">
          {space ? space.name : "Sin organizar"} · {photoName}. El costo se revisa antes de generar.
        </p>
      )}
      {preset && !draft && (
        <p className="inline-notice" role="status">
          {preset.style
            ? `Seguís con lo que elegiste en la demo: ${styleName(preset.style)} para esta foto. Revisá el costo y confirmá para generarla.`
            : "Seguís con la foto que elegiste en la demo: elegí un estilo, revisá el costo y confirmá para ambientarla."}
        </p>
      )}
      {!compact && moreFields}
      <StyleGrid
        value={value.style}
        room={propertyType === "residential" ? value.room : null}
        demoStyles={demoStyles}
        propertyType={propertyType}
        stateOf={stateOf}
        compact={compact}
        onPick={(style) => {
          set({ style });
          onStylePicked?.(style);
          // A style this photo already has: it is shown at once, nothing is generated.
          const s = stateOf(style);
          if (s.kind === "ready") onViewVersion?.(s.generationId);
        }}
      />
      {compact && (
        <details className="pw-create-more">
          <summary>Más opciones</summary>
          {moreFields}
        </details>
      )}
      {exists && !why && compact && (
        <p className="pw-note">Ya hay una versión {styleName(value.style)} (la ves en la foto, sin costo). Generar crea otra y la anterior se conserva.</p>
      )}
      {exists && !why && !compact && (
        <p className="pw-note">
          Ya hay una versión {styleName(value.style)}: se crea otra y la anterior se conserva. Cuando esté lista, la nueva pasa a mostrarse en la ficha en ese
          estilo; podés volver a elegir la anterior.
        </p>
      )}
      {progress && (
        <GenerationProgress
          since={liveSince}
          styleName={styleName(value.style)}
          note="Podés seguir con otras fotos: la versión aparece en «Versiones de esta foto» y se abre sola cuando esté lista."
        />
      )}
      <div className="pw-quote" role="status" aria-live="polite">
        {progress ? null : why ? (
          <span className="inline-error">{why}</span>
        ) : done ? (
          <span>{done}</span>
        ) : step === "confirm" && quote ? (
          quote.payer === "team" ? (
            <span>Paga: equipo habita (demo). No usa créditos de la inmobiliaria.</span>
          ) : quote.blocked ? (
            <span className="inline-error">
              {quote.blocked}{" "}
              {/* In the agency's own panel, the way to top up; the team adds credits from its own pages. */}
              {typeof window !== "undefined" && window.location.pathname.startsWith("/panel/") && <a href="/panel/creditos">Comprar créditos</a>}
            </span>
          ) : (
            <span>
              Paga: saldo de la inmobiliaria.{" "}
              {quote.newPhotos
                ? `Usa ${quote.newPhotos} ${quote.newPhotos === 1 ? "crédito" : "créditos"}; quedarían ${(quote.credits ?? 0) - quote.newPhotos}.`
                : "No usa créditos: la foto ya está paga y su cobertura sigue vigente."}
            </span>
          )
        ) : compact ? null : (
          <span>{payerNote}</span>
        )}
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <div className="pw-create-actions">
        {step === "choose" ? (
          <button className="button button-primary" disabled={Boolean(why) || working}>
            {working || progress ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />} {progress ? `Generando ${styleName(value.style)}…` : "Generar versión"}
            {!progress && compact && estimate && !estimate.blocked
              ? estimate.newPhotos
                ? ` (${estimate.newPhotos} ${estimate.newPhotos === 1 ? "crédito" : "créditos"})`
                : " (sin costo)"
              : ""}
          </button>
        ) : (
          <>
            <button type="button" className="button button-outline" disabled={working} onClick={() => setStep("choose")}>
              Cambiar
            </button>
            <button className="button button-primary" disabled={Boolean(why) || Boolean(quote?.blocked) || working} data-testid="confirm-version">
              {working ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />} Confirmar y generar
            </button>
          </>
        )}
      </div>
    </form>
  );
}

/**
 * The styles of this kind of property as cards, the property's own first,
 * with what each one already has on this photo. A home shows each style's
 * example scene for the chosen room; an office, its color.
 */
function StyleGrid({
  value,
  room,
  demoStyles,
  propertyType,
  stateOf,
  onPick,
  compact = false,
}: {
  compact?: boolean;
  value: string;
  room: string | null;
  demoStyles: string[];
  propertyType: PropertyType;
  stateOf: (s: string) => CellState;
  onPick: (style: string) => void;
}) {
  const uid = useId();
  const [all, setAll] = useState(false);
  const full = demoStyles.length >= MAX_DEMO_STYLES;
  const list = [...STYLE_LIST[propertyType]].sort((a, b) => Number(!demoStyles.includes(a.id)) - Number(!demoStyles.includes(b.id)));
  // Four styles (the property's own first), plus the chosen one; the rest with «Ver más estilos» (spec v3 §3.3).
  const first = list.slice(0, 4);
  const listed = all
    ? list
    : compact
      ? // Four in one row: the chosen one takes the last place when it is not among them.
        first.some((st) => st.id === value) || !list.some((st) => st.id === value)
        ? first
        : [...first.slice(0, 3), list.find((st) => st.id === value)!]
      : list.filter((st, i) => i < 4 || st.id === value);
  return (
    <div className="pw-field">
      <span id={`${uid}-styles`} className={compact ? "dv2-sr" : undefined}>
        Estilo
      </span>
      <div className={`pw-styles ${compact ? "pw-styles-row" : ""}`} role="radiogroup" aria-labelledby={`${uid}-styles`}>
        {listed.map((st) => {
          const s = stateOf(st.id);
          const isNew = !demoStyles.includes(st.id);
          const note =
            s.kind === "ready" ? "Ya creada" : s.kind === "uncertain" ? "En revisión" : s.kind === "none" || s.kind === "failed" ? "" : "En curso";
          return (
            <button
              key={st.id}
              type="button"
              role="radio"
              aria-checked={value === st.id}
              className="pw-style"
              disabled={isNew && full}
              title={isNew && full ? "La propiedad ya tiene 6 estilos" : undefined}
              onClick={() => onPick(st.id)}
            >
              <span className="pw-style-art" style={room ? undefined : { background: st.color }}>
                {room && <img src={`/ejemplos/${room}-${st.id}.webp`} alt="" loading="lazy" />}
                {value === st.id && <Check size={13} strokeWidth={3} className="pw-style-check" aria-hidden="true" />}
              </span>
              <span className="pw-style-name">
                {st.name}
                {note && <small>{note}</small>}
              </span>
            </button>
          );
        })}
      </div>
      {list.length > listed.length || all ? (
        <button type="button" className={compact ? "button button-outline pw-more-styles is-block" : "text-link pw-more-styles"} aria-expanded={all} onClick={() => setAll((v) => !v)}>
          {all ? "Menos estilos" : `Ver más estilos (${list.length - listed.length})`}
        </button>
      ) : null}
    </div>
  );
}

/**
 * "Trabajar varias fotos": choose photos (by space) and styles, see what is
 * missing, then the server's quote and one confirmation. Unticking a photo
 * only leaves it out of the next batch: its versions and states stay.
 */
function BatchPanel({
  flat = false,
  detail,
  groups,
  demoStyles,
  propertyType,
  included,
  setIncluded,
  staging,
  blocked,
  actions,
}: {
  /** Estudio de imágenes: one list with every photo, no spaces. */
  flat?: boolean;
  detail: DemoDetail;
  groups: ReturnType<typeof groupBySpace>;
  demoStyles: string[];
  propertyType: PropertyType;
  included: Set<string>;
  setIncluded: (fn: (s: Set<string>) => Set<string>) => void;
  staging: { queue: Task[]; current: Task | null; waiting: Set<string>; starting: boolean };
  blocked: string | null;
  actions: WorkspaceActions;
}) {
  const [moveTo, setMoveTo] = useState("");
  const missing = missingTasks(detail.photos, included, demoStyles, staging.waiting);
  const canAdd = demoStyles.length < MAX_DEMO_STYLES;
  const toggle = (id: string, on: boolean) =>
    setIncluded((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  const pending = staging.queue.length + (staging.current ? 1 : 0);
  return (
    <section id="pw-batch" className="ed-batch pw-batch" aria-label="Trabajar varias fotos">
      <div className="ed-batch-styles">
        <span className="ed-batch-label">Estilos de la tanda</span>
        {STYLE_LIST[propertyType].map((st) => {
          const on = demoStyles.includes(st.id);
          const hasVersions = detail.styles.includes(st.id);
          return (
            <label key={st.id} className={`ed-chip ${on ? "is-on" : ""}`}>
              <input
                type="checkbox"
                checked={on}
                disabled={(!on && !canAdd) || (on && hasVersions)}
                title={on && hasVersions ? "Ya tiene versiones: queda en la propiedad (se quita desde Publicación)" : undefined}
                onChange={(e) => actions.toggleBatchStyle(st.id, e.target.checked)}
              />
              <span className="dm-style-swatch" style={{ background: st.color }} aria-hidden="true" />
              {st.name}
            </label>
          );
        })}
      </div>
      {groups.map((g) => (
        <fieldset key={g.space?.id ?? "loose"} className="pw-batch-group">
          <legend>
            {flat ? `Todas las fotos (${g.photos.length})` : g.space ? g.space.name : "Sin organizar"}{" "}
            {g.photos.length > 0 && (
              <button type="button" className="text-link" onClick={() => setIncluded((s) => new Set([...s, ...g.photos.map((p) => p.id)]))}>
                Elegir todas
              </button>
            )}
          </legend>
          <div className="ap-photo-grid">
            {g.photos.map((p) => (
              <label key={p.id} className={included.has(p.id) ? "is-on" : ""}>
                <input type="checkbox" checked={included.has(p.id)} onChange={(e) => toggle(p.id, e.target.checked)} aria-label={`Incluir ${photoLabel(p)}`} />
                <img src={adminPhotoUrl(p.id, null, 480)} alt="" loading="lazy" />
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <div className="ed-batch-foot">
        <span>
          {included.size} {included.size === 1 ? "foto elegida" : "fotos elegidas"} · {missing.length}{" "}
          {missing.length === 1 ? "versión faltante" : "versiones faltantes"} · máx. {MAX_DEMO_STYLES} estilos
          {pending ? ` · ${pending} en esta pestaña: si la cerrás, solo sigue la que ya está en el servidor` : ""}
        </span>
        <span className="ed-batch-buttons">
          <button type="button" className="text-link" onClick={() => setIncluded(() => new Set())}>
            Ninguna
          </button>
          {staging.queue.length > 0 && (
            <button
              type="button"
              className="text-link"
              onClick={() => {
                const n = actions.cancelPending();
                actions.notice(`${n} ${n === 1 ? "versión pendiente quitada" : "versiones pendientes quitadas"}; la que se está creando sigue.`);
              }}
            >
              Quitar pendientes
            </button>
          )}
          {detail.spaces.length > 0 && !flat && (
            <span className="pw-row">
              <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} aria-label="Mover las fotos elegidas a">
                <option value="">Sin organizar</option>
                {detail.spaces.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="button button-small button-outline"
                disabled={!included.size}
                onClick={() =>
                  void actions.spaces("", { method: "PATCH", body: JSON.stringify({ photoIds: [...included], spaceId: moveTo || null }) }, "Fotos movidas.")
                }
              >
                Mover las elegidas
              </button>
            </span>
          )}
          <button
            type="button"
            className="button button-primary"
            disabled={!missing.length || staging.starting || Boolean(blocked)}
            title={blocked ?? undefined}
            onClick={() => void actions.request(missing)}
          >
            {staging.starting ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
            {missing.length ? `Cotizar y crear ${missing.length} ${missing.length === 1 ? "versión" : "versiones"}` : "Nada faltante en la tanda"}
          </button>
        </span>
      </div>
      {blocked && <p className="dm-help">{blocked}</p>}
    </section>
  );
}

/** "Nuevo espacio": a name and a kind. */
export function NewSpace({
  onCreate,
  onCancel,
  disabled,
}: {
  onCreate: (name: string, type: string) => Promise<boolean>;
  onCancel?: () => void;
  disabled: boolean;
}) {
  const uid = useId();
  const [name, setName] = useState("");
  const [type, setType] = useState("bedroom");
  return (
    <form
      className="sp-new"
      onSubmit={async (e) => {
        e.preventDefault();
        if (name.trim() && (await onCreate(name, type))) setName("");
      }}
    >
      <label htmlFor={`${uid}-name`}>Nuevo espacio</label>
      <input id={`${uid}-name`} value={name} maxLength={60} placeholder="Ej.: Dormitorio 2" autoFocus onChange={(e) => setName(e.target.value)} />
      <select value={type} aria-label="Tipo de espacio" onChange={(e) => setType(e.target.value)}>
        {SPACE_TYPES.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <button className="button button-small" disabled={disabled || !name.trim()}>
        Crear espacio
      </button>
      {onCancel && (
        <button type="button" className="text-link" onClick={onCancel}>
          Cancelar
        </button>
      )}
    </form>
  );
}


/* ------------------------------------------------------------------------------------------------
 * «Crear demostración interactiva» (the agency's property editor): the same workspace, laid out as
 * the approved design. Ambientes on the left, the photo (before/after) with its space's photos in
 * the middle, «Ambientar con IA» on the right. «Editar imagen» opens this same workspace's editor
 * (the studio's), and a new version is created from the «Generar versión con IA» window, always
 * after its cost. Every action is the one the studio already uses (WorkspaceActions).
 * ---------------------------------------------------------------------------------------------- */

const SPACE_ICONS: Record<string, typeof Sofa> = {
  living: Sofa,
  bedroom: BedDouble,
  dining: Utensils,
  kitchen: CookingPot,
  office: Briefcase,
  outdoor: Trees,
  studio: Sofa,
  quincho: Flame,
  bathroom: Bath,
  exterior: House,
  other: LayoutGrid,
};

/** «Ambientes»: the property's real spaces with how many photos each has; add one, or adjust the active one. */
function SpaceList({
  groups,
  spaces,
  active,
  spacesReady,
  busy,
  onPick,
  actions,
}: {
  groups: ReturnType<typeof groupBySpace>;
  spaces: PropertySpace[];
  /** The space on screen: an id, "loose" (Sin organizar). */
  active: string;
  spacesReady: boolean;
  busy: boolean;
  onPick: (key: string) => void;
  actions: WorkspaceActions;
}) {
  const [adding, setAdding] = useState(false);
  const current = spaces.find((s) => s.id === active) ?? null;
  return (
    <nav className="pw-spaces dx-spaces" aria-label="Ambientes">
      <h3 className="dx-col-title">Ambientes</h3>
      <ul className="dx-space-list">
        {groups.map((g) => {
          const key = g.space?.id ?? "loose";
          const Icon = g.space ? (SPACE_ICONS[g.space.roomType] ?? LayoutGrid) : ImagePlus;
          return (
            <li key={key}>
              <button type="button" className="dx-space" aria-current={key === active ? "true" : undefined} onClick={() => onPick(key)}>
                <Icon size={18} aria-hidden="true" />
                <span>
                  {g.space ? g.space.name : "Sin organizar"} ({g.photos.length})
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {spacesReady ? (
        adding ? (
          <NewSpace
            disabled={busy}
            onCancel={() => setAdding(false)}
            onCreate={async (name, roomType) => {
              const ok = await actions.spaces("", { method: "POST", body: JSON.stringify({ name, roomType }) }, `Ambiente «${name.trim()}» creado.`);
              if (ok) setAdding(false);
              return ok;
            }}
          />
        ) : (
          <button type="button" className="button button-small button-outline dx-add-space" onClick={() => setAdding(true)}>
            <Plus size={16} aria-hidden="true" /> Agregar ambiente
          </button>
        )
      ) : (
        <p className="dm-help">Para organizar por ambientes falta aplicar la migración 202610310001_property_spaces.sql.</p>
      )}
      {current && (
        <SpaceMenu space={current} spaces={spaces} count={groups.find((g) => g.space?.id === current.id)?.photos.length ?? 0} actions={actions} />
      )}
    </nav>
  );
}

/** The photos of the space on screen, under the large photo, and «+» to add more to it. */
function SpaceStrip({
  photos,
  activeId,
  mainStyle,
  coverId,
  spaceId,
  spaceName,
  onPick,
  actions,
}: {
  photos: EditorPhoto[];
  activeId: string | null;
  mainStyle: string;
  coverId: string | null;
  spaceId: string | null;
  spaceName: string;
  onPick: (id: string) => void;
  actions: WorkspaceActions;
}) {
  return (
    <ul className="dx-strip" aria-label={`Fotos de ${spaceName}`}>
      {photos.map((p, i) => (
        <li key={p.id}>
          <button
            type="button"
            className="pw-thumb"
            aria-pressed={p.id === activeId}
            aria-label={`${spaceName}, foto ${i + 1}${p.visible ? "" : " (oculta)"}${p.id === coverId ? " (portada)" : ""}`}
            onClick={() => onPick(p.id)}
          >
            <img src={p.shown[mainStyle] ? adminGenerationUrl(p.shown[mainStyle], 480) : adminPhotoUrl(p.id, null, 480)} alt="" loading="lazy" />
            {!p.visible && <EyeOff size={13} className="pw-thumb-off" aria-hidden="true" />}
            {p.id === coverId && <Star size={12} className="pw-thumb-cover" aria-hidden="true" />}
          </button>
        </li>
      ))}
      <li>
        <label className="dx-strip-add" title={`Agregar fotos a ${spaceName}`}>
          <Plus size={20} aria-hidden="true" />
          <span className="dv2-sr">Agregar fotos a {spaceName}</span>
          <input
            type="file"
            className="dm-hidden-input"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={(e) => {
              if (e.target.files?.length) actions.upload(e.target.files, spaceId);
              e.target.value = "";
            }}
          />
        </label>
      </li>
    </ul>
  );
}

/** How many styles «Ambientar con IA» lists before «Más estilos». */
const DEMO_VISIBLE_STYLES = 4;

/**
 * «Ambientar con IA»: the styles of this photo. One already created is shown
 * at once (no credits); another one opens «Generar versión con IA», which
 * says its cost first. «Más estilos» only unfolds the full catalog.
 */
function DemoStyles({
  photo,
  space,
  propertyType,
  demoStyles,
  waiting,
  viewing,
  blocked,
  onView,
  onGenerate,
}: {
  photo: EditorPhoto;
  space: PropertySpace | null;
  propertyType: PropertyType;
  demoStyles: string[];
  waiting: Set<string>;
  /** The style on screen (its version), or null: the original. */
  viewing: string | null;
  blocked: string | null;
  onView: (generationId: string) => void;
  onGenerate: (style: string) => void;
}) {
  const [all, setAll] = useState(false);
  const catalog = STYLE_LIST[propertyType];
  const states = useMemo(() => photoVersions(photo, catalog.map((s) => s.id), waiting), [photo, catalog, waiting]);
  const stateOf = (style: string) => states.find((o) => o.style === style)?.state ?? ({ kind: "none" } as CellState);
  // Created first, then the property's styles, then the rest of the catalog.
  const rank = (id: string) => (stateOf(id).kind === "ready" ? 0 : demoStyles.includes(id) ? 1 : 2);
  const ordered = [...catalog].sort((a, b) => rank(a.id) - rank(b.id));
  const listed = all ? ordered : ordered.filter((st, i) => i < DEMO_VISIBLE_STYLES || st.id === viewing);
  const room = propertyType === "residential" ? initialRoom(photo, space).room : null;
  return (
    <div className="dx-styles">
      <ul className="dx-style-list" role="radiogroup" aria-label="Estilos para esta foto">
        {listed.map((st) => {
          const s = stateOf(st.id);
          const ready = s.kind === "ready" ? s : null;
          const live = s.kind === "running" || s.kind === "queued" || s.kind === "waiting";
          const on = Boolean(ready && viewing === st.id);
          return (
            <li key={st.id}>
              <button
                type="button"
                role="radio"
                aria-checked={on}
                className={`dx-style ${on ? "is-on" : ""}`}
                disabled={live || (!ready && Boolean(blocked))}
                title={!ready && blocked ? blocked : undefined}
                onClick={() => (ready ? onView(ready.generationId) : onGenerate(st.id))}
              >
                <span className="dx-style-art" style={room ? undefined : { background: st.color }}>
                  {ready ? (
                    <img src={adminGenerationUrl(ready.generationId, 240)} alt="" loading="lazy" />
                  ) : room ? (
                    <img src={`/ejemplos/${room}-${st.id}.webp`} alt="" loading="lazy" />
                  ) : null}
                </span>
                <span className="dx-style-name">
                  {st.name}
                  <small>
                    {ready ? (ready.running ? "Lista · creando otra" : "Lista") : live ? "Creando…" : s.kind === "uncertain" ? "En revisión" : s.kind === "failed" ? "Falló: generar de nuevo" : "Generar"}
                  </small>
                </span>
                <span className={`dx-radio ${on ? "is-on" : ""}`} aria-hidden="true">
                  {on ? <Check size={13} strokeWidth={3} /> : live ? <Loader2 size={13} className="spin" /> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {ordered.length > DEMO_VISIBLE_STYLES && (
        <button type="button" className="button button-outline dx-more-styles" aria-expanded={all} onClick={() => setAll((v) => !v)}>
          {all ? (
            <>
              Menos estilos <ChevronUp size={16} aria-hidden="true" />
            </>
          ) : (
            <>
              <Plus size={16} aria-hidden="true" /> Más estilos <ChevronDown size={16} aria-hidden="true" />
            </>
          )}
        </button>
      )}
    </div>
  );
}

/**
 * «Generar versión con IA»: the original, the style, what it costs (the
 * server's quote: opening this or choosing a style costs nothing) and the
 * confirmation. Its options (amoblar o rediseñar, el ambiente) are the same
 * as «Crear otra versión». The result keeps the original and every version.
 */
function GenerateDialog({
  photo,
  photoName,
  space,
  base,
  propertyType,
  demoStyles,
  staging,
  waiting,
  initialStyle,
  onClose,
  onConfirm,
}: {
  photo: EditorPhoto;
  photoName: string;
  space: PropertySpace | null;
  base: string;
  propertyType: PropertyType;
  demoStyles: string[];
  staging: DemoDetail["staging"];
  waiting: Set<string>;
  initialStyle: string;
  onClose: () => void;
  onConfirm: (task: Task, fresh: boolean) => Promise<boolean>;
}) {
  const uid = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const roomStart = initialRoom(photo, space);
  const catalog = STYLE_LIST[propertyType];
  const states = useMemo(() => photoVersions(photo, catalog.map((s) => s.id), waiting), [photo, catalog, waiting]);
  const stateOf = (style: string) => states.find((o) => o.style === style)?.state ?? ({ kind: "none" } as CellState);
  const [style, setStyle] = useState(initialStyle);
  const [mode, setMode] = useState(photo.mode);
  const [room, setRoom] = useState(roomStart.room);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const full = demoStyles.length >= MAX_DEMO_STYLES;
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  // The cost of this photo, as the server works it out: asking costs nothing.
  useEffect(() => {
    if (staging?.payer !== "agency") {
      setQuote({ payer: "team", credits: null, newPhotos: 0, blocked: null });
      return;
    }
    let live = true;
    api<Quote>(`${base}/costo`, { method: "POST", body: JSON.stringify({ photoIds: [photo.id] }) })
      .then((q) => live && setQuote(q))
      .catch((e) => live && setQuoteError(e instanceof Error ? e.message : "No pudimos calcular el costo."));
    return () => {
      live = false;
    };
  }, [base, photo.id, staging?.payer]);
  const state = stateOf(style);
  const exists = state.kind === "ready";
  const live = state.kind === "running" || state.kind === "queued" || state.kind === "waiting" || (state.kind === "ready" && state.running);
  const why =
    staging?.blocked ??
    quote?.blocked ??
    (live
      ? "Ese estilo ya se está creando para esta foto."
      : state.kind === "uncertain"
        ? "Ese estilo tiene un resultado en revisión técnica: descartalo antes de crear otro."
        : !style
          ? "Elegí un estilo."
          : full && !demoStyles.includes(style)
            ? `La propiedad ya tiene ${MAX_DEMO_STYLES} estilos.`
            : null);
  const cost = !quote
    ? quoteError || "Calculando…"
    : quote.payer === "team"
      ? "Sin costo para la inmobiliaria (demo del equipo habita)."
      : quote.newPhotos
        ? `${quote.newPhotos} ${quote.newPhotos === 1 ? "crédito" : "créditos"} · te quedarían ${(quote.credits ?? 0) - quote.newPhotos}`
        : "Sin costo: la foto ya está paga y su cobertura sigue vigente.";
  async function confirm() {
    setError("");
    setWorking(true);
    try {
      const ok = await onConfirm({ photoId: photo.id, style, mode, ...(propertyType === "residential" ? { room } : {}) }, exists);
      if (ok) ref.current?.close();
      else setError("No se inició: revisá el mensaje del editor. Lo que elegiste se conserva.");
    } finally {
      setWorking(false);
    }
  }
  return (
    <dialog ref={ref} className="dx-dialog" aria-labelledby={`${uid}-title`} onClose={onClose} onCancel={onClose}>
      <div className="dx-dialog-head">
        <h2 id={`${uid}-title`}>Generar versión con IA</h2>
        <button type="button" className="icon-button" aria-label="Cerrar" disabled={working} onClick={() => ref.current?.close()}>
          <X size={18} />
        </button>
      </div>
      <form
        className="dx-generate"
        onSubmit={(e) => {
          e.preventDefault();
          void confirm();
        }}
      >
        <img className="dx-generate-photo" src={adminPhotoUrl(photo.id, null, 640)} alt={`${space ? space.name : "Foto"}, ${photoName}: original`} />
        <div className="dx-generate-fields">
          <label className="pw-field">
            Estilo
            <select value={style} onChange={(e) => setStyle(e.target.value)} autoFocus>
              {catalog.map((st) => (
                <option key={st.id} value={st.id} disabled={full && !demoStyles.includes(st.id)}>
                  {st.name}
                  {stateOf(st.id).kind === "ready" ? " (ya creada)" : ""}
                </option>
              ))}
            </select>
          </label>
          <p className="dx-cost" role="status" aria-live="polite">
            <Zap size={16} aria-hidden="true" /> Costo estimado: {cost}
          </p>
          <details className="dx-generate-more">
            <summary>Más opciones</summary>
            <div className="pw-field">
              <span id={`${uid}-mode`}>Qué querés hacer</span>
              <div className="pw-seg" role="group" aria-labelledby={`${uid}-mode`}>
                <button type="button" aria-pressed={mode === "furnish"} onClick={() => setMode("furnish")}>
                  Amoblar
                </button>
                <button type="button" aria-pressed={mode === "redesign"} onClick={() => setMode("redesign")}>
                  Rediseñar
                </button>
              </div>
            </div>
            {propertyType === "residential" && (
              <label className="pw-field">
                Ambiente
                <select value={room} onChange={(e) => setRoom(e.target.value)}>
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
                {roomStart.conflict && <small>La foto tenía «{roomName(roomStart.conflict)}» como ajuste propio.</small>}
              </label>
            )}
          </details>
          {exists && !why && <p className="pw-note">Ya hay una versión {styleName(style)}: se crea otra y la anterior se conserva.</p>}
          {why && (
            <p className="inline-error" role="alert">
              {why}{" "}
              {quote?.blocked && typeof window !== "undefined" && window.location.pathname.startsWith("/panel/") && <a href="/panel/creditos">Comprar créditos</a>}
            </p>
          )}
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="dx-dialog-actions">
          <button type="button" className="button button-outline" disabled={working} onClick={() => ref.current?.close()}>
            Cancelar
          </button>
          <button className="button button-primary" disabled={Boolean(why) || !quote || working} data-testid="confirm-version">
            {working ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />} Generar con IA
          </button>
        </div>
      </form>
    </dialog>
  );
}
