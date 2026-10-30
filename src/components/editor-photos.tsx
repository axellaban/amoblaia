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
import { RetouchControls, type ToolsState } from "./retouch-controls";

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
  /** An AI tool on what is viewed: it starts, and its result appears as a version. False when it did not start. */
  tool: (photoId: string, tool: Tool, source: RetouchSource, mask?: string) => Promise<boolean>;
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
}: {
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
  const groups = groupBySpace(photos, spaces);
  const [activeId, setActiveId] = useState<string | null>(null);
  // The version being looked at, per photo; null: the original. A view only.
  const [viewOf, setViewOf] = useState<Record<string, string | null>>({});
  const [mode, setMode] = useState<ViewMode>("version");
  const [tab, setTab] = useState<"create" | "edit">("create");
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
  const uid = useId();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [batch, setBatch] = useState(false);
  const [awaiting, setAwaiting] = useState<{ photoId: string; style: string; since: string } | null>(null);

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
  // A version asked from "Crear otra versión" opens by itself when it is ready, unless another view was chosen meanwhile.
  useEffect(() => {
    if (!awaiting) return;
    const p = photos.find((x) => x.id === awaiting.photoId);
    const made = p?.generations.find((g) => g.style === awaiting.style && g.status === "succeeded" && g.created_at >= awaiting.since);
    if (p && made) {
      setAwaiting(null);
      if (activeId === p.id) choose(p.id, made.id);
    }
    const last = p?.generations.find((g) => g.style === awaiting.style);
    if (last && (last.status === "failed" || last.status === "needs_review") && last.created_at >= awaiting.since) setAwaiting(null);
  }, [photos, awaiting, activeId]);

  if (!photos.length)
    return (
      <div className="pw-empty">
        <p>Todavía no hay fotos. Agregalas acá o desde la publicación original.</p>
        <UploadButton label="Agregar fotos" onFiles={(f) => actions.upload(f, null)} primary />
      </div>
    );
  if (!photo) return null;
  const isCover = detail.demo.cover?.id === photo.id;
  // The photo's own name, else its place in the space ("Vista 2"): never the space's name twice.
  const name = photo.label?.trim() || `Vista ${(activeGroup?.photos.findIndex((p) => p.id === photo.id) ?? 0) + 1}`;

  // Every photo in the order of its space: what the arrows step through.
  const ordered = groups.flatMap((g) => g.photos);
  const at = ordered.findIndex((p) => p.id === photo.id);
  const step = (n: number) => setActiveId(ordered[(at + n + ordered.length) % ordered.length].id);
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
  };
  const applyTool = async () => {
    if (!photo || !tool) return;
    const mask = tool === "remove" ? (brush.current?.exportPng() ?? null) : null;
    if (tool === "remove" && !mask) {
      setToolNote("Pintá lo que querés quitar.");
      return;
    }
    setToolBusy(true);
    const ok = await actions.tool(photo.id, tool, viewSource, mask ?? undefined);
    setToolBusy(false);
    if (ok) {
      setTool(null);
      setPainted(false);
      setToolNote("");
      brush.current?.clear();
    }
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
    setTab("create");
    document.getElementById(`${uid}-side`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  return (
    <>
      <div className="pw" data-testid="photo-workspace">
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

        <div className="pw-main">
          <section className="pw-stage" aria-label="Foto activa">
            <header className="pw-stage-head">
              <button type="button" className="icon-button" aria-label="Foto anterior" disabled={ordered.length < 2} onClick={() => step(-1)}>
                <ChevronLeft size={18} />
              </button>
              <div className="pw-stage-title">
                <h3>
                  {space ? space.name : "Sin organizar"} · {name}
                </h3>
                <small>
                  Foto {at + 1} de {ordered.length}
                </small>
              </div>
              <button type="button" className="icon-button" aria-label="Foto siguiente" disabled={ordered.length < 2} onClick={() => step(1)}>
                <ChevronRight size={18} />
              </button>
              <span className="pw-badges">
                {hasView && (
                  <span className={`pw-badge ${shownHere ? "is-on" : ""}`}>
                    {viewRetouch ? (retouchShown ? shownLabel : "Retoque guardado") : shownHere ? shownLabel : photosOnly ? "Creada y guardada" : "No se muestra en la ficha"}
                  </span>
                )}
                {!photo.visible && <span className="pw-badge">Oculta en la ficha</span>}
                {isCover && <span className="pw-badge is-on">Portada</span>}
              </span>
            </header>
            <figure className="pw-figure">
              {hasView && effectiveMode === "compare" && !brushing ? (
                <Comparison
                  before={adminPhotoUrl(photo.id, null, 1600)}
                  after={afterUrl}
                  afterFilter={retouch}
                  beforeLabel="Original"
                  beforeAlt={`${name}, foto original`}
                  afterLabel={viewName}
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
              {viewGen && (
                <button type="button" className="pw-expand icon-button" aria-label="Ver versión completa" onClick={() => actions.review(photo.id, viewGen.id)}>
                  <Expand size={18} />
                </button>
              )}
              {liveGen && (
                <div className="pw-generating" role="status" aria-live="polite">
                  <Loader2 size={24} className="spin" aria-hidden="true" />
                  <span>Creando {styleName(liveGen.style)}…</span>
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
            <div className="pw-actions">
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
            <p className="pw-hint">Descargar no usa créditos ni publica nada: JPEG de hasta 2048 px.</p>
          </section>

          <section className="pw-versions-panel" aria-labelledby={`${uid}-versions`}>
            <div className="pw-versions-head">
              <h4 id={`${uid}-versions`}>Versiones de esta foto</h4>
              <small>Elegir una versión solo cambia lo que ves.</small>
            </div>
            <ul className="pw-versions">
              <li>
                <button type="button" className="pw-version" aria-pressed={!viewGen} onClick={() => choose(photo.id, null)}>
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

        <aside id={`${uid}-side`} className="pw-side" aria-label="Ambientar y editar">
          <div className="pw-tabs" role="tablist" aria-label="Qué querés hacer con esta foto">
            <button
              type="button"
              role="tab"
              id={`${uid}-tab-create`}
              aria-selected={tab === "create"}
              aria-controls={`${uid}-panel`}
              onClick={() => setTab("create")}
            >
              <WandSparkles size={15} aria-hidden="true" /> Ambientación con IA
            </button>
            <button
              type="button"
              role="tab"
              id={`${uid}-tab-edit`}
              aria-selected={tab === "edit"}
              aria-controls={`${uid}-panel`}
              onClick={() => setTab("edit")}
            >
              <Pencil size={15} aria-hidden="true" /> Editar
            </button>
          </div>
          <div role="tabpanel" id={`${uid}-panel`} aria-labelledby={`${uid}-tab-${tab}`}>
            {tab === "create" ? (
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
        </aside>
      </div>

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
    <div className="pw-edit">
      <div className="pw-edit-head">
        <div>
          <p className="pw-kicker">Editando</p>
          <h3 className="pw-title">{viewing}</h3>
        </div>
        {dirty && <span className="pw-badge is-on">Sin guardar</span>}
      </div>

      <RetouchControls id={photo.id} adjust={adjust} onAdjust={onAdjust} tools={tools} />

      <div className="pw-edit-actions">
        <button type="button" className="button button-outline button-small" disabled={!dirty} onClick={() => onAdjust(NO_ADJUST)}>
          Descartar
        </button>
        <button type="button" className="button button-primary button-small" disabled={!dirty || saving} onClick={onSave}>
          {saving ? <Loader2 size={14} className="spin" /> : null} {saving ? "Guardando…" : "Guardar como versión"}
        </button>
      </div>
      <p className="pw-hint">Guardar crea una versión nueva, sin créditos. El original no se toca.</p>

      <PhotoSettings photo={photo} spaces={spaces} propertyType={propertyType} index={index} total={total} actions={actions} />
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
}: {
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
  onDraft,
  onConfirm,
}: {
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
    () => draft ?? { style: demoStyles.find((s) => stateOf(s).kind === "none") ?? demoStyles[0] ?? "", mode: photo.mode, room: roomStart.room },
  );
  const [quote, setQuote] = useState<Quote | null>(null);
  const [step, setStep] = useState<"choose" | "confirm">("choose");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [working, setWorking] = useState(false);
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
  const why =
    staging?.blocked ??
    (live
      ? "Ese estilo ya se está creando para esta foto."
      : state.kind === "uncertain"
        ? "Ese estilo tiene un resultado en revisión técnica: descartalo antes de crear otro."
        : !value.style
          ? "Elegí un estilo."
          : null);

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
      <p className="dm-help">
        {space ? space.name : "Sin organizar"} · {photoName}. El costo se revisa antes de generar.
      </p>
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
      <StyleGrid
        value={value.style}
        room={propertyType === "residential" ? value.room : null}
        demoStyles={demoStyles}
        propertyType={propertyType}
        stateOf={stateOf}
        onPick={(style) => set({ style })}
      />
      {exists && !why && (
        <p className="pw-note">
          Ya hay una versión {styleName(value.style)}: se crea otra y la anterior se conserva. Cuando esté lista, la nueva pasa a mostrarse en la ficha en ese
          estilo; podés volver a elegir la anterior.
        </p>
      )}
      <div className="pw-quote" role="status" aria-live="polite">
        {why ? (
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
        ) : (
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
            {working ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />} Generar
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
}: {
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
  const own = list.filter((st) => demoStyles.includes(st.id)).length;
  // The property's styles (at least four), plus the chosen one; the rest on request.
  const listed = all ? list : list.filter((st, i) => i < Math.max(own, 4) || st.id === value);
  return (
    <div className="pw-field">
      <span id={`${uid}-styles`}>Estilo</span>
      <div className="pw-styles" role="radiogroup" aria-labelledby={`${uid}-styles`}>
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
        <button type="button" className="text-link pw-more-styles" aria-expanded={all} onClick={() => setAll((v) => !v)}>
          {all ? "Menos estilos" : `Ver todos los estilos (${list.length})`}
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
            {g.space ? g.space.name : "Sin organizar"}{" "}
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
          {detail.spaces.length > 0 && (
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

