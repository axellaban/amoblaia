"use client";
// "Fotos" of the property editor: one photo at a time. Spaces on the left,
// the active photo or version large in the middle, its versions and actions
// on the right; on a phone they stack in that order. What is being looked
// at (the view), which version the listing shows, the cover, the photo's
// visibility and the batch selection are five separate things: choosing a
// version only changes the view, and every other change is its own button.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
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
  download: (url: string, key: string, name: string) => void;
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
  const [dialog, setDialog] = useState(false);
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
  const effectiveMode: ViewMode = viewGen ? mode : "original";
  const number = photo && viewGen ? versionNumber(photo, viewGen.id) : null;
  const sameStyle = photo && viewGen ? photo.generations.filter((g) => g.style === viewGen.style && g.status === "succeeded").length : 0;
  const label = viewLabel(effectiveMode, viewGen ? styleName(viewGen.style) : null, number, sameStyle);
  const versionsList = photo ? photoVersions(photo, demoStyles, staging.waiting) : [];

  const choose = (photoId: string, generationId: string | null, m: ViewMode = generationId ? "version" : "original") => {
    setViewOf((v) => ({ ...v, [photoId]: generationId }));
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

  return (
    <>
      <div className="pw" data-testid="photo-workspace">
        <SpaceNav
          groups={groups}
          spaces={spaces}
          activeSpace={activeGroup?.space?.id ?? null}
          spacesReady={detail.spacesReady}
          busy={busy}
          onPick={(g) => g.photos[0] && setActiveId(g.photos[0].id)}
          actions={actions}
        />

        <section className="pw-stage" aria-label="Foto activa">
          <header className="pw-stage-head">
            <h3>
              {space ? space.name : "Sin organizar"} · {name}
            </h3>
            <span className="pw-badges">
              <span className={`pw-badge ${photo.visible ? "is-on" : ""}`}>{photo.visible ? "Visible en la ficha" : "Oculta en la ficha"}</span>
              {isCover && <span className="pw-badge is-on">Portada</span>}
            </span>
          </header>
          <figure className="pw-figure">
            {viewGen && effectiveMode === "compare" ? (
              <Comparison
                before={adminPhotoUrl(photo.id, null, 1600)}
                after={adminGenerationUrl(viewGen.id, 1600)}
                beforeLabel="Original"
                beforeAlt={`${name}, foto original`}
                afterLabel={styleName(viewGen.style)}
                alt={`${name}, ${styleName(viewGen.style)}`}
                initial={50}
              />
            ) : (
              <img
                key={viewGen && effectiveMode === "version" ? viewGen.id : `o-${photo.id}`}
                src={viewGen && effectiveMode === "version" ? adminGenerationUrl(viewGen.id, 1600) : adminPhotoUrl(photo.id, null, 1600)}
                alt={viewGen && effectiveMode === "version" ? `${name}, ${styleName(viewGen.style)}` : `${name}, foto original`}
              />
            )}
            <figcaption className="pw-caption" aria-live="polite" data-testid="view-label">
              {label}
              {viewGen && effectiveMode !== "original" && <span> · Ambientación ilustrativa con IA</span>}
            </figcaption>
            {viewGen && (
              <button type="button" className="pw-expand icon-button" aria-label="Ver versión completa" onClick={() => actions.review(photo.id, viewGen.id)}>
                <Expand size={18} />
              </button>
            )}
          </figure>
          <div className="pw-stage-tools">
            <div className="pc-media-switch pw-switch" role="group" aria-label="Qué ver en la foto grande">
              <button type="button" aria-pressed={effectiveMode === "original"} onClick={() => setMode("original")}>
                Original
              </button>
              <button
                type="button"
                aria-pressed={effectiveMode === "version"}
                disabled={!viewGen && !Object.keys(photo.shown).length}
                onClick={() => (viewGen ? setMode("version") : choose(photo.id, initialView(photo, mainStyle)))}
              >
                Versión
              </button>
              <button
                type="button"
                aria-pressed={effectiveMode === "compare"}
                disabled={!viewGen && !Object.keys(photo.shown).length}
                onClick={() => (viewGen ? setMode("compare") : choose(photo.id, initialView(photo, mainStyle), "compare"))}
              >
                Comparar
              </button>
            </div>
            <span className="pw-stage-actions">
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
            </span>
          </div>
          <div className="pw-strip" role="group" aria-label={`Fotos de ${activeGroup?.space?.name ?? "Sin organizar"}`}>
            {(activeGroup?.photos ?? []).map((p) => (
              <button
                key={p.id}
                type="button"
                className="pw-thumb"
                aria-pressed={p.id === photo.id}
                aria-label={`${photoLabel(p)}${p.visible ? "" : " (oculta)"}`}
                onClick={() => setActiveId(p.id)}
              >
                <img src={p.shown[mainStyle] ? adminGenerationUrl(p.shown[mainStyle], 480) : adminPhotoUrl(p.id, null, 480)} alt="" loading="lazy" />
                {!p.visible && <EyeOff size={13} className="pw-thumb-off" aria-hidden="true" />}
              </button>
            ))}
            <UploadButton label="Fotos" onFiles={(f) => actions.upload(f, activeGroup?.space?.id ?? null)} />
          </div>
        </section>

        <aside className="pw-side" aria-label="Versiones y acciones">
          <p className="pw-kicker">La versión que estás viendo</p>
          <h3 className="pw-title">{viewGen ? `${styleName(viewGen.style)}${sameStyle > 1 && number ? ` v${number}` : ""}` : "Original"}</h3>
          <p className="pw-state">
            {viewGen
              ? `${shownIds.has(viewGen.id) ? shownLabel : photosOnly ? "Creada y guardada" : "Creada y guardada · no se muestra en la ficha"} · lista para descargar`
              : "La foto como se subió"}
          </p>
          {viewGen ? (
            <button
              type="button"
              className="button button-primary pw-download"
              data-testid="download-active"
              disabled={downloading === viewGen.id}
              onClick={() => actions.download("", viewGen.id, fileName(photo, viewGen))}
            >
              {downloading === viewGen.id ? <Loader2 size={16} className="spin" /> : <Download size={16} />} Descargar esta versión
            </button>
          ) : (
            <button
              type="button"
              className="button button-outline pw-download"
              disabled={downloading === `o-${photo.id}`}
              onClick={() => actions.download(photo.id, `o-${photo.id}`, originalName(photo))}
            >
              {downloading === `o-${photo.id}` ? <Loader2 size={16} className="spin" /> : <Download size={16} />} Descargar original
            </button>
          )}
          <p className="pw-hint">JPEG de hasta 2048 px. Descargar no usa créditos ni publica nada.</p>
          {viewGen && !shownIds.has(viewGen.id) && (
            <button type="button" className="button button-small button-outline pw-show" onClick={() => void actions.patchPhoto(photo.id, { approve: viewGen.id })}>
              <Check size={14} /> Mostrar esta en la ficha
            </button>
          )}
          <button type="button" className="pw-create" onClick={() => setDialog(true)} aria-haspopup="dialog">
            <Plus size={15} /> Crear otra versión
          </button>

          <h4 className="pw-versions-title">Versiones de esta foto</h4>
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
          </ul>
          <p className="pw-hint">Elegir una versión cambia lo que ves. Mostrarla en la ficha, publicar o regenerar son acciones separadas.</p>
          {viewGen && (
            <div className="pw-version-actions">
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
          )}
          <PhotoSettings photo={photo} spaces={spaces} propertyType={propertyType} index={photos.indexOf(photo)} total={photos.length} actions={actions} />
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

      {dialog && (
        <CreateVersionDialog
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
          onClose={() => setDialog(false)}
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
    <label className={primary ? "button button-primary" : "pw-thumb pw-add"}>
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

/** The spaces of the property, with their photo counts; a new space and the active space's settings. */
function SpaceNav({
  groups,
  spaces,
  activeSpace,
  spacesReady,
  busy,
  onPick,
  actions,
}: {
  groups: ReturnType<typeof groupBySpace>;
  spaces: PropertySpace[];
  activeSpace: string | null;
  spacesReady: boolean;
  busy: boolean;
  onPick: (g: ReturnType<typeof groupBySpace>[number]) => void;
  actions: WorkspaceActions;
}) {
  const [adding, setAdding] = useState(false);
  const total = groups.reduce((n, g) => n + g.photos.length, 0);
  const current = spaces.find((s) => s.id === activeSpace) ?? null;
  return (
    <nav className="pw-spaces" aria-label="Espacios">
      <p className="pw-kicker">
        Espacios · {total} {total === 1 ? "foto" : "fotos"}
      </p>
      <ul>
        {groups.map((g) => (
          <li key={g.space?.id ?? "loose"}>
            <button type="button" aria-current={(g.space?.id ?? null) === activeSpace ? "true" : undefined} disabled={!g.photos.length} onClick={() => onPick(g)}>
              <span>{g.space ? g.space.name : "Sin organizar"}</span>
              <small>{g.photos.length}</small>
            </button>
          </li>
        ))}
      </ul>
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
            <Plus size={14} /> Espacio
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

/** The photo's own settings: name, space, defaults for new versions, order, discarded versions and delete. */
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
 * "Crear otra versión": one action and one style for this photo, the cost
 * and who pays from the server before anything starts, and a confirmation.
 * Cancelling or a refused request keeps what was chosen (per photo).
 */
function CreateVersionDialog({
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
  payerNote: string;
  waiting: Set<string>;
  draft: Draft | undefined;
  onDraft: (d: Draft) => void;
  onClose: () => void;
  onConfirm: (task: Task, fresh: boolean) => Promise<boolean>;
}) {
  const uid = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const roomStart = initialRoom(photo, space);
  const options = useMemo(() => photoVersions(photo, STYLE_LIST[propertyType].map((s) => s.id), waiting), [photo, propertyType, waiting]);
  const stateOf = (style: string) => options.find((o) => o.style === style)?.state ?? ({ kind: "none" } as CellState);
  const [value, setValue] = useState<Draft>(
    () => draft ?? { style: demoStyles.find((s) => stateOf(s).kind === "none") ?? demoStyles[0] ?? "", mode: photo.mode, room: roomStart.room },
  );
  const [quote, setQuote] = useState<Quote | null>(null);
  const [step, setStep] = useState<"choose" | "confirm">("choose");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  const set = (patch: Partial<Draft>) => {
    const next = { ...value, ...patch };
    setValue(next);
    onDraft(next);
    setStep("choose");
    setQuote(null);
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
      if (ok) ref.current?.close();
      else setError("No se inició: revisá el mensaje del editor. Lo que elegiste se conserva.");
    } finally {
      setWorking(false);
    }
  }
  return (
    <dialog ref={ref} className="aa-dialog pw-dialog" aria-labelledby={`${uid}-title`} onClose={onClose} onCancel={onClose}>
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (step === "choose") void review();
          else void confirm();
        }}
      >
        <h2 id={`${uid}-title`}>Crear otra versión</h2>
        <p className="dm-help">
          {space ? space.name : "Sin organizar"} · {photoName}. Una acción y un estilo; el costo se revisa antes de generar.
        </p>
        <div className="pw-dialog-fields">
          <label>
            Qué querés hacer
            <select value={value.mode} onChange={(e) => set({ mode: e.target.value as Draft["mode"] })}>
              <option value="furnish">Amoblar (el espacio está vacío)</option>
              <option value="redesign">Rediseñar con otros muebles</option>
            </select>
          </label>
          <label>
            Estilo
            <select value={value.style} onChange={(e) => set({ style: e.target.value })}>
              {!value.style && <option value="">Elegí un estilo…</option>}
              <StyleOptions demoStyles={demoStyles} propertyType={propertyType} stateOf={stateOf} />
            </select>
          </label>
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
            <details className="pw-advanced">
              <summary>Ambiente: {roomName(value.room)}</summary>
              <label>
                Ambiente para crear
                <select value={value.room} onChange={(e) => set({ room: e.target.value })}>
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
            </details>
          ))}
        {exists && !why && (
          <p className="pw-note">
            Ya hay una versión {styleName(value.style)}: se crea otra y la anterior se conserva. Cuando esté lista, la nueva pasa a mostrarse en la ficha en ese
            estilo; podés volver a elegir la anterior.
          </p>
        )}
        <div className="pw-quote" role="status" aria-live="polite">
          {why ? (
            <span className="inline-error">{why}</span>
          ) : step === "confirm" && quote ? (
            quote.payer === "team" ? (
              <span>Paga: equipo habita (demo). No usa créditos de la inmobiliaria.</span>
            ) : quote.blocked ? (
              <span className="inline-error">{quote.blocked}</span>
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
        <div className="aa-dialog-actions">
          <button type="button" className="button button-outline" onClick={() => ref.current?.close()} disabled={working}>
            Cancelar
          </button>
          {step === "choose" ? (
            <button className="button button-primary" disabled={Boolean(why) || working}>
              {working ? <Loader2 size={16} className="spin" /> : null} Revisar costo y continuar
            </button>
          ) : (
            <button className="button button-primary" disabled={Boolean(why) || Boolean(quote?.blocked) || working} data-testid="confirm-version">
              {working ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />} {exists ? "Crear otra versión" : "Crear versión"}
            </button>
          )}
        </div>
      </form>
    </dialog>
  );
}

/** The styles of this kind of property, with what each one already has on this photo. */
function StyleOptions({ demoStyles, propertyType, stateOf }: { demoStyles: string[]; propertyType: PropertyType; stateOf: (s: string) => CellState }) {
  const list = STYLE_LIST[propertyType];
  const full = demoStyles.length >= MAX_DEMO_STYLES;
  return (
    <>
      {list.map((st) => {
        const s = stateOf(st.id);
        const isNew = !demoStyles.includes(st.id);
        const note =
          s.kind === "ready" ? " · ya creada (se crea otra)" : s.kind === "uncertain" ? " · en revisión técnica" : s.kind === "none" || s.kind === "failed" ? "" : " · en curso";
        return (
          <option key={st.id} value={st.id} disabled={isNew && full}>
            {st.name}
            {note}
            {isNew && full ? " · la propiedad ya tiene 6 estilos" : ""}
          </option>
        );
      })}
    </>
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

