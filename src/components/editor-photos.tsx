"use client";
// "Fotos y espacios" of the property editor: one card per photo with the
// image on the left and everything about it on the right (space, room,
// styles with their real state, create, view, download), grouped by the
// property's spaces. Selecting a photo for a batch, showing or hiding it and
// making it the cover are separate controls; none of them hides results.
import { useEffect, useId, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Download,
  Eye,
  EyeOff,
  ImagePlus,
  Loader2,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Sparkles,
  Star,
  Trash2,
  Undo2,
} from "lucide-react";
import { Comparison } from "./comparison";
import { rooms } from "@/lib/catalog";
import { cardStyles, cellState, roomConflict, taskKey, type CellState } from "@/lib/demos/editor-logic";
import {
  adminGenerationUrl,
  adminPhotoUrl,
  photoLabel,
  roomName,
  SPACE_TYPES,
  spaceTypeName,
  styleName,
  type EditorPhoto,
  type GenerationRow,
  type PropertySpace,
} from "@/lib/demos/shared";
import { styleFits, type PropertyType } from "@/lib/demos/styles";

export type CardActions = {
  include: (on: boolean) => void;
  patch: (changes: Record<string, unknown>) => void;
  move: (step: number) => void;
  assign: (spaceId: string | null) => void;
  cover: () => void;
  remove: () => void;
  create: (style: string, fresh?: boolean) => void;
  /** Several new styles of this photo at once: one quote, one confirmation. */
  createMany: (styles: string[]) => void;
  review: (generationId: string) => void;
  download: (generationId: string, style: string) => void;
  discard: (generationId: string) => void;
  restore: (generationId: string) => void;
  approve: (generationId: string) => void;
  retryUncertain: (generationId: string, style: string) => void;
};

const date = (iso: string) => new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "short" });

function stateLabel(s: CellState) {
  switch (s.kind) {
    case "ready":
      return s.running ? "Creada · creando otra" : "Creada";
    case "running":
      return "Generando…";
    case "queued":
      return "En cola en el servidor";
    case "waiting":
      return "Pendiente en esta pestaña";
    case "failed":
      return "Falló por un problema técnico (lo reservado se devuelve)";
    case "uncertain":
      return "En revisión técnica";
    default:
      return "Sin crear";
  }
}

/** One style of one photo: its real state and the next useful action. */
function StyleRow({
  photo,
  style,
  waiting,
  fits,
  blocked,
  downloading,
  actions,
  onPreview,
  previewing,
}: {
  photo: EditorPhoto;
  style: string;
  waiting: boolean;
  fits: boolean;
  blocked: string | null;
  downloading: boolean;
  actions: CardActions;
  onPreview: () => void;
  previewing: boolean;
}) {
  const s = cellState(photo, style, waiting);
  const name = styleName(style);
  return (
    <li className={`pc-style is-${s.kind} ${previewing ? "is-previewing" : ""}`}>
      {s.kind === "ready" ? (
        <button type="button" className="pc-style-thumb" onClick={onPreview} aria-label={`Ver ${name} en la foto grande`} aria-pressed={previewing}>
          <img src={adminGenerationUrl(s.generationId, 480)} alt="" loading="lazy" />
        </button>
      ) : (
        <span className="pc-style-thumb is-empty" aria-hidden="true">
          {s.kind === "running" || s.kind === "queued" || s.kind === "waiting" ? <Loader2 size={16} className="spin" /> : null}
        </span>
      )}
      <span className="pc-style-text">
        <strong>{name}</strong>
        <small>
          {stateLabel(s)}
          {!fits && " · de otro tipo de inmueble, no se muestra en la ficha"}
        </small>
        {s.kind === "uncertain" && (
          <small className="pc-note">
            El resultado técnico es incierto (puede haber quedado reservado). Descartalo para crear otro, o esperá a que el equipo lo concilie.
          </small>
        )}
      </span>
      <span className="pc-style-actions">
        {s.kind === "ready" && (
          <>
            <button type="button" className="button button-small button-outline" onClick={() => actions.review(s.generationId)}>
              Ver
            </button>
            <button
              type="button"
              className="button button-small button-outline"
              disabled={downloading}
              onClick={() => actions.download(s.generationId, style)}
              aria-label={`Descargar ${name}`}
            >
              {downloading ? <Loader2 size={14} className="spin" /> : <Download size={14} />} Descargar
            </button>
          </>
        )}
        {(s.kind === "none" || s.kind === "failed") && fits && (
          <button
            type="button"
            className="button button-small"
            disabled={Boolean(blocked)}
            title={blocked ?? undefined}
            onClick={() => actions.create(style)}
          >
            {s.kind === "failed" ? <RefreshCw size={14} /> : <Sparkles size={14} />} {s.kind === "failed" ? "Reintentar" : "Crear"}
          </button>
        )}
        {s.kind === "uncertain" && (
          <button
            type="button"
            className="button button-small button-outline"
            disabled={Boolean(blocked)}
            onClick={() => actions.retryUncertain(s.generation.id, style)}
          >
            Descartar y crear otra
          </button>
        )}
      </span>
    </li>
  );
}

/** Every version of the photo, also discarded ones: view, download, show, discard, recover. */
function History({ photo, actions, downloading }: { photo: EditorPhoto; actions: CardActions; downloading: string | null }) {
  const done = photo.generations.filter((g) => g.status === "succeeded");
  if (!done.length) return <p className="dm-help">Todavía no hay versiones creadas.</p>;
  const label = (g: GenerationRow) =>
    photo.shown[g.style] === g.id ? "Se muestra" : photo.discarded.includes(g.id) ? "Descartada" : "Guardada";
  return (
    <ul className="pc-history">
      {done.map((g) => (
        <li key={g.id}>
          <img src={adminGenerationUrl(g.id, 480)} alt="" loading="lazy" />
          <span>
            <strong>{styleName(g.style)}</strong> · {label(g)} · {date(g.created_at)}
          </span>
          <span className="pc-history-actions">
            <button type="button" className="text-link" onClick={() => actions.review(g.id)}>
              Ver
            </button>
            <button type="button" className="text-link" disabled={downloading === g.id} onClick={() => actions.download(g.id, g.style)}>
              Descargar
            </button>
            {photo.shown[g.style] !== g.id && !photo.discarded.includes(g.id) && (
              <button type="button" className="text-link" onClick={() => actions.approve(g.id)}>
                Mostrar esta
              </button>
            )}
            {photo.discarded.includes(g.id) ? (
              <button type="button" className="text-link" onClick={() => actions.restore(g.id)}>
                <Undo2 size={13} /> Recuperar
              </button>
            ) : (
              <button type="button" className="text-link" onClick={() => actions.discard(g.id)}>
                Descartar
              </button>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function PhotoCard({
  photo,
  index,
  total,
  spaces,
  propertyType,
  demoStyles,
  compatibleStyles,
  roomForStyles,
  isCover,
  included,
  waiting,
  blocked,
  downloading,
  organizing,
  organizeSelected,
  onOrganizeSelect,
  actions,
  mainStyle,
}: {
  photo: EditorPhoto;
  index: number;
  total: number;
  spaces: PropertySpace[];
  propertyType: PropertyType;
  demoStyles: string[];
  compatibleStyles: { id: string; name: string; color: string }[];
  /** How many styles the property can still add (6 at most). */
  roomForStyles: number;
  isCover: boolean;
  included: boolean;
  waiting: Set<string>;
  blocked: string | null;
  downloading: string | null;
  organizing: boolean;
  organizeSelected: boolean;
  onOrganizeSelect: (on: boolean) => void;
  actions: CardActions;
  mainStyle: string;
}) {
  const allStyles = cardStyles(photo, demoStyles);
  const stateOf = (st: string) => cellState(photo, st, waiting.has(taskKey({ photoId: photo.id, style: st })));
  // Above: styles with something to show or follow (created, in progress, failed, in review). Below: the rest, as boxes.
  const styles = allStyles
    .filter((st) => stateOf(st).kind !== "none")
    .sort((a, b) => Number(stateOf(b).kind === "ready") - Number(stateOf(a).kind === "ready"));
  const [picking, setPicking] = useState<Set<string>>(new Set());
  const firstReady = styles.find((st) => photo.shown[st]);
  const [preview, setPreview] = useState<string | null>(photo.shown[mainStyle] ? mainStyle : (firstReady ?? null));
  const [compare, setCompare] = useState(false);
  const [naming, setNaming] = useState(false);
  // A version that disappears (discarded) stops being previewed.
  useEffect(() => {
    if (preview && !photo.shown[preview]) setPreview(firstReady ?? null);
  }, [photo.shown, preview, firstReady]);
  const space = spaces.find((s) => s.id === photo.spaceId) ?? null;
  const conflict = roomConflict(photo, space);
  const shownId = preview ? photo.shown[preview] : null;
  const name = photoLabel(photo);
  const choices = compatibleStyles.filter((s) => stateOf(s.id).kind === "none");
  // New styles for the property count against its limit; styles it already has do not.
  const newPicked = [...picking].filter((st) => !demoStyles.includes(st)).length;
  const live = styles.some((st) => {
    const s = cellState(photo, st, waiting.has(taskKey({ photoId: photo.id, style: st })));
    return s.kind === "running" || s.kind === "queued";
  });

  return (
    <li className={`pc-card ${photo.visible ? "" : "is-hidden"} ${included ? "is-included" : ""}`} id={`foto-${photo.id}`}>
      <div className="pc-media">
        {shownId && compare ? (
          <Comparison
            before={adminPhotoUrl(photo.id, null, 960)}
            after={adminGenerationUrl(shownId, 960)}
            beforeLabel="Original"
            beforeAlt={`${name}, foto original`}
            afterLabel={styleName(preview!)}
            alt={`${name}, ${styleName(preview!)}`}
            initial={50}
          />
        ) : (
          <img
            src={shownId ? adminGenerationUrl(shownId, 960) : adminPhotoUrl(photo.id, null, 960)}
            alt={shownId ? `${name}, ${styleName(preview!)}` : `${name}, foto original`}
            loading="lazy"
          />
        )}
        <div className="dm-badges">
          {isCover && <span>Portada</span>}
          {!photo.visible && <span className="is-muted">Oculta en la ficha</span>}
        </div>
        <div className="pc-media-switch" role="group" aria-label="Qué ver en la foto grande">
          <button type="button" aria-pressed={!shownId} onClick={() => (setPreview(null), setCompare(false))}>
            Original
          </button>
          {firstReady && (
            <>
              <button type="button" aria-pressed={Boolean(shownId) && !compare} onClick={() => (setPreview(preview && photo.shown[preview] ? preview : firstReady), setCompare(false))}>
                Versión
              </button>
              <button type="button" aria-pressed={Boolean(shownId) && compare} onClick={() => (setPreview(preview && photo.shown[preview] ? preview : firstReady), setCompare(true))}>
                Comparar
              </button>
            </>
          )}
        </div>
      </div>

      <div className="pc-panel">
        <div className="pc-head">
          {organizing && (
            <input
              type="checkbox"
              className="pc-organize"
              aria-label={`Elegir ${name} para mover`}
              checked={organizeSelected}
              onChange={(e) => onOrganizeSelect(e.target.checked)}
            />
          )}
          <div className="pc-title">
            <span className="eyebrow">
              {space ? space.name : "Sin organizar"} · Vista {index + 1}
            </span>
            {naming ? (
              <input
                className="pc-name-input"
                defaultValue={photo.label ?? ""}
                placeholder={roomName(photo.room)}
                maxLength={80}
                aria-label="Nombre de la foto"
                autoFocus
                onBlur={(e) => {
                  setNaming(false);
                  if ((photo.label ?? "") !== e.target.value.trim()) actions.patch({ label: e.target.value });
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") setNaming(false);
                }}
              />
            ) : (
              <h3>
                {name}
                <button type="button" className="icon-button" aria-label={`Renombrar ${name}`} onClick={() => setNaming(true)}>
                  <Pencil size={14} />
                </button>
              </h3>
            )}
          </div>
          <label className="pc-include">
            <input type="checkbox" checked={included} onChange={(e) => actions.include(e.target.checked)} />
            Incluir en lote
          </label>
        </div>

        <div className="pc-fields">
          <label>
            Espacio
            <select value={photo.spaceId ?? ""} onChange={(e) => actions.assign(e.target.value || null)} disabled={!spaces.length}>
              <option value="">Sin organizar</option>
              {spaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          {propertyType === "residential" && (
            <label>
              Ambiente para crear
              <select value={photo.room} disabled={live} onChange={(e) => actions.patch({ room: e.target.value })}>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Modo
            <select value={photo.mode} disabled={live} onChange={(e) => actions.patch({ mode: e.target.value })}>
              <option value="furnish">Amoblar (vacío)</option>
              <option value="redesign">Rediseñar (con muebles)</option>
            </select>
          </label>
        </div>
        {conflict && propertyType === "residential" && (
          <p className="pc-note" role="note">
            El espacio es {spaceTypeName(space!.roomType)}, pero esta foto se crea como {roomName(photo.room)}.{" "}
            <button type="button" className="text-link" disabled={live} onClick={() => actions.patch({ room: conflict })}>
              Usar {roomName(conflict)}
            </button>
          </p>
        )}

        <ul className="pc-styles" aria-label={`Estilos de ${name}`}>
          {styles.map((st) => (
            <StyleRow
              key={st}
              photo={photo}
              style={st}
              waiting={waiting.has(taskKey({ photoId: photo.id, style: st }))}
              fits={styleFits(st, propertyType)}
              blocked={blocked}
              downloading={downloading === photo.shown[st]}
              actions={actions}
              previewing={preview === st && Boolean(shownId)}
              onPreview={() => (setPreview(st), setCompare(false))}
            />
          ))}
        </ul>
        {choices.length > 0 && (
          <div className="pc-pick">
            <span className="pc-pick-title">{styles.length ? "Crear más estilos" : "Elegí estilos para crear"}</span>
            <div className="pc-chips" role="group" aria-label={`Estilos para crear en ${name}`}>
              {choices.map((st) => {
                const on = picking.has(st.id);
                const full = !on && !demoStyles.includes(st.id) && newPicked >= roomForStyles;
                return (
                  <button
                    key={st.id}
                    type="button"
                    className={`pc-chip ${on ? "is-on" : ""}`}
                    aria-pressed={on}
                    disabled={full || Boolean(blocked)}
                    title={full ? "La propiedad ya tiene el máximo de estilos" : undefined}
                    onClick={() =>
                      setPicking((cur) => {
                        const n = new Set(cur);
                        if (n.has(st.id)) n.delete(st.id);
                        else n.add(st.id);
                        return n;
                      })
                    }
                  >
                    <span className="dm-style-swatch" style={{ background: st.color }} aria-hidden="true" />
                    {st.name}
                  </button>
                );
              })}
            </div>
            {picking.size > 0 && (
              <div className="pc-pick-foot">
                <button
                  type="button"
                  className="button button-small button-primary"
                  disabled={Boolean(blocked)}
                  onClick={() => {
                    actions.createMany([...picking]);
                    setPicking(new Set());
                  }}
                >
                  <Sparkles size={14} /> Crear {picking.size} {picking.size === 1 ? "estilo" : "estilos"}
                </button>
                <button type="button" className="text-link" onClick={() => setPicking(new Set())}>
                  Limpiar
                </button>
              </div>
            )}
          </div>
        )}

        <div className="pc-controls">
          <button
            type="button"
            className={`button button-small button-outline ${photo.visible ? "" : "is-off"}`}
            aria-pressed={!photo.visible}
            onClick={() => actions.patch({ visible: !photo.visible })}
          >
            {photo.visible ? <Eye size={14} /> : <EyeOff size={14} />} {photo.visible ? "Se muestra" : "Oculta"}
          </button>
          <button type="button" className={`button button-small button-outline ${isCover ? "is-on" : ""}`} aria-pressed={isCover} onClick={actions.cover}>
            <Star size={14} /> {isCover ? "Es la portada (abre la ficha)" : "Usar de portada"}
          </button>
          <details className="ap-menu pc-more">
            <summary>
              <MoreHorizontal size={15} /> Más
            </summary>
            <div className="ap-menu-list pc-more-list">
              <button type="button" disabled={index === 0} onClick={() => actions.move(-1)}>
                <ArrowUp size={14} /> Subir
              </button>
              <button type="button" disabled={index === total - 1} onClick={() => actions.move(1)}>
                <ArrowDown size={14} /> Bajar
              </button>
              <details className="pc-history-wrap">
                <summary>Historial de versiones</summary>
                <History photo={photo} actions={actions} downloading={downloading} />
              </details>
              <button type="button" className="dm-danger" disabled={live} onClick={actions.remove}>
                <Trash2 size={14} /> Eliminar foto
              </button>
            </div>
          </details>
        </div>
      </div>
    </li>
  );
}

/** A space's header: name, kind, order, upload into it, include its photos in the batch, delete. */
export function SpaceHeader({
  space,
  count,
  first,
  last,
  spaces,
  onRename,
  onType,
  onMove,
  onDelete,
  onUpload,
  onIncludeAll,
}: {
  space: PropertySpace | null;
  count: number;
  first: boolean;
  last: boolean;
  spaces: PropertySpace[];
  onRename: (name: string) => void;
  onType: (type: string) => void;
  onMove: (step: number) => void;
  onDelete: (moveTo: string | null) => void;
  onUpload: (files: FileList) => void;
  onIncludeAll: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [moveTo, setMoveTo] = useState("");
  return (
    <div className="sp-head" id={space ? `espacio-${space.id}` : "espacio-sin-organizar"}>
      <div className="sp-title">
        {space && editing ? (
          <input
            defaultValue={space.name}
            maxLength={60}
            aria-label="Nombre del espacio"
            autoFocus
            onBlur={(e) => {
              setEditing(false);
              if (e.target.value.trim() && e.target.value.trim() !== space.name) onRename(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setEditing(false);
            }}
          />
        ) : (
          <h3>
            {space ? space.name : "Sin organizar"} <small>({count})</small>
          </h3>
        )}
        {space && (
          <select value={space.roomType} aria-label={`Tipo de ${space.name}`} onChange={(e) => onType(e.target.value)}>
            {SPACE_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="sp-actions">
        <label className="button button-small button-outline sp-upload">
          <ImagePlus size={14} /> Agregar fotos{space ? " acá" : ""}
          <input
            type="file"
            className="dm-hidden-input"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={(e) => {
              if (e.target.files?.length) onUpload(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
        {count > 0 && (
          <button type="button" className="button button-small button-outline" onClick={onIncludeAll}>
            Incluir en lote
          </button>
        )}
        {space && (
          <details className="ap-menu">
            <summary>
              <MoreHorizontal size={15} /> Espacio
            </summary>
            <div className="ap-menu-list">
              <button type="button" onClick={() => setEditing(true)}>
                <Pencil size={14} /> Renombrar
              </button>
              <button type="button" disabled={first} onClick={() => onMove(-1)}>
                <ArrowUp size={14} /> Subir
              </button>
              <button type="button" disabled={last} onClick={() => onMove(1)}>
                <ArrowDown size={14} /> Bajar
              </button>
              <button type="button" className="dm-danger" onClick={() => setDeleting(true)}>
                <Trash2 size={14} /> Eliminar espacio
              </button>
            </div>
          </details>
        )}
      </div>
      {space && deleting && (
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
          <button type="button" className="button button-small" onClick={() => (setDeleting(false), onDelete(moveTo || null))}>
            Eliminar espacio
          </button>
          <button type="button" className="text-link" onClick={() => setDeleting(false)}>
            Cancelar
          </button>
        </div>
      )}
    </div>
  );
}

/** "Nuevo espacio": a name and a kind. */
export function NewSpace({ onCreate, disabled }: { onCreate: (name: string, type: string) => Promise<boolean>; disabled: boolean }) {
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
      <input id={`${uid}-name`} value={name} maxLength={60} placeholder="Ej.: Dormitorio 2" onChange={(e) => setName(e.target.value)} />
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
    </form>
  );
}
