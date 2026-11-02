"use client";
// "¿Con qué imágenes querés empezar?" (spec v3 §1.3): what the home's three
// big actions open before their tool. An existing property (its photos are
// reused, nothing is imported again), a new listing (the panel's importer,
// which then continues to the tool) or photos uploaded without a ficha (the
// same photo groups as «Estudio de imágenes»). Nothing here creates its own
// copy of a service: every route is the one the panel already uses.
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, Home, Link2, Loader2, Search, Star, Upload, X } from "lucide-react";
import { ApiError, api } from "./admin-demos";
import { ImportProperty } from "./agency-panel";
import { track } from "@/lib/analytics";
import { adminPhotoUrl } from "@/lib/demos/shared";
import { fileProblem } from "@/lib/agency/photo-selection";
import { MAX_UPLOAD_BYTES } from "@/lib/photo-limits";
import type { PanelProperty } from "@/lib/agency/shared";

export type StartTool = "demo" | "ambientar" | "editar" | "video";

export const TOOL_TITLE: Record<StartTool, string> = {
  demo: "Crear demostración interactiva",
  ambientar: "Ambientar con IA",
  editar: "Editar imágenes",
  video: "Crear video",
};

/** Where each tool opens for a property or a photo group: straight into it, never back to this picker. */
export function toolPath(tool: StartTool, id: string) {
  // The three ways in end in the same editor of the property (its demo): photos first.
  if (tool === "demo") return `/panel/propiedades/${id}?${new URLSearchParams({ seccion: "fotos", volver: "/panel" })}`;
  if (tool === "video") return `/panel/video?${new URLSearchParams({ propiedad: id })}`;
  const q = new URLSearchParams({ pestana: "fotos", fotos: id });
  q.set("modo", tool === "editar" ? "editar" : "ambientar");
  return `/panel/imagenes?${q}`;
}

type Item = PanelProperty & { group: boolean };
type Source = "elegir" | "importar" | "subir";
const MB = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));
const message = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message || fallback : fallback);

export function StartPicker({ tool, existingCount, onClose }: { tool: StartTool; existingCount: number; onClose: () => void }) {
  const router = useRouter();
  const uid = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const [items, setItems] = useState<Item[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [source, setSource] = useState<Source | null>(null);
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const demo = tool === "demo";
  // «Elegir una propiedad existente» of the demo: chosen first, then «Continuar».
  const [chosen, setChosen] = useState<string | null>(null);
  // «Subir fotos» of the demo: the one that opens the ficha (its cover).
  const [cover, setCover] = useState(0);
  const previews = useMemo(() => files.map((f) => (fileProblem(f) ? null : URL.createObjectURL(f))), [files]);
  useEffect(() => () => previews.forEach((u) => u && URL.revokeObjectURL(u)), [previews]);

  useEffect(() => {
    ref.current?.showModal();
    track("panel_start_picker_opened", { tool });
  }, [tool]);

  useEffect(() => {
    Promise.all([
      api<{ items: PanelProperty[] }>("/api/panel/propiedades?por=48").then((d) => d.items.map((p) => ({ ...p, group: false }))),
      api<{ items: PanelProperty[] }>("/api/panel/imagenes")
        .then((d) => d.items.map((p) => ({ ...p, group: true })))
        .catch(() => [] as Item[]),
    ])
      .then(([props, groups]) => setItems([...props, ...groups]))
      .catch((e) => {
        setItems([]);
        setLoadError(message(e, "No pudimos cargar tus propiedades."));
      });
  }, []);

  // The property the team prepared in the demo goes first; then the most recent ones.
  const sorted = useMemo(
    () =>
      [...(items ?? [])].sort(
        (a, b) => Number(b.origin === "admin" && !b.group) - Number(a.origin === "admin" && !a.group) || b.createdAt.localeCompare(a.createdAt),
      ),
    [items],
  );
  const q = query.trim().toLowerCase();
  const shown = q ? sorted.filter((p) => `${p.title} ${p.location ?? ""}`.toLowerCase().includes(q)) : sorted;
  const hasItems = sorted.length > 0;

  const go = (id: string, how: Source) => {
    track("panel_start_picker_chosen", { tool, source: how });
    router.push(toolPath(tool, id));
  };

  /** The same photo group as «Estudio de imágenes → Subir fotos»: no ficha, one request per file. */
  async function upload() {
    const valid = files.filter((f) => !fileProblem(f));
    if (!valid.length) return;
    setError("");
    let id: string;
    try {
      setStatus("Preparando…");
      id = (await api<{ id: string }>("/api/panel/imagenes/grupo", { method: "POST", body: JSON.stringify({ name: demo ? "Propiedad nueva" : "Fotos subidas" }) })).id;
    } catch (e) {
      setStatus("");
      setError(message(e, "No pudimos empezar la subida."));
      return;
    }
    let saved = 0;
    const failed: string[] = [];
    const coverFile = files[cover];
    let coverId: string | null = null;
    for (const [i, file] of valid.entries()) {
      setStatus(`Subiendo foto ${i + 1} de ${valid.length}…`);
      const form = new FormData();
      form.append("image", file);
      try {
        const made = await api<{ id: string }>(`/api/admin/demos/${id}/photos`, { method: "POST", body: form });
        if (file === coverFile) coverId = made.id;
        saved++;
      } catch (e) {
        failed.push(`«${file.name}»: ${message(e, "no se pudo subir")}`);
      }
    }
    if (!saved) {
      setStatus("");
      setError(`No se pudo subir ninguna foto. ${failed.slice(0, 3).join(" ")}`);
      return;
    }
    track("panel_start_photos_uploaded", { tool, photos: saved, failed: failed.length });
    if (demo) {
      // A draft ficha with only what is needed: its data is completed in the editor, whenever.
      try {
        setStatus("Creando la ficha…");
        await api(`/api/panel/imagenes/${id}/ficha`, { method: "POST" });
        if (coverId) await api(`/api/admin/demos/${id}`, { method: "PATCH", body: JSON.stringify({ action: "cover", photoId: coverId }) }).catch(() => null);
      } catch (e) {
        setStatus("");
        setError(`Las fotos se subieron, pero no pudimos crear la ficha: ${message(e, "probá de nuevo")}. Las encontrás en «Estudio de imágenes».`);
        return;
      }
    }
    // What failed is said in the studio too: the group lists the photos it really has.
    go(id, "subir");
  }

  const options: { id: Source; icon: typeof Home; title: string; text: string }[] = demo
    ? [
        { id: "elegir", icon: Home, title: "Elegir una propiedad existente", text: "Usá una de tus propiedades ya creadas." },
        { id: "importar", icon: Link2, title: "Importar nueva propiedad desde URL", text: "Traé sus datos y fotografías desde una publicación." },
        { id: "subir", icon: Upload, title: "Subir fotos", text: "Cargá tus fotos y creá la ficha." },
      ]
    : [
        { id: "elegir", icon: Home, title: "Elegir una propiedad existente", text: "Usá las fotos que ya están en tu panel." },
        { id: "importar", icon: Link2, title: "Importar nueva propiedad", text: "Pegá la URL de una publicación inmobiliaria." },
        { id: "subir", icon: Upload, title: "Subir fotos", text: "Empezá directamente, sin tener que crear una ficha." },
      ];
  // With no properties, importing and uploading come first; an empty list is not offered (the demo always shows its three ways in).
  const ordered = demo ? options : hasItems ? options : options.filter((o) => o.id !== "elegir");
  // The demo works on fichas: photo groups without one are not offered there.
  const listed = demo ? shown.filter((p) => !p.group) : shown;
  const move = (i: number, step: number) => {
    const next = [...files];
    [next[i], next[i + step]] = [next[i + step], next[i]];
    setFiles(next);
    setCover((c) => (c === i ? i + step : c === i + step ? i : c));
  };

  return (
    <dialog ref={ref} className="sp-dialog" aria-labelledby={`${uid}-title`} onClose={onClose} onCancel={onClose}>
      <div className="sp-head">
        {source ? (
          <button type="button" className="icon-button" aria-label="Volver a las opciones" disabled={Boolean(status)} onClick={() => setSource(null)}>
            <ArrowLeft size={18} />
          </button>
        ) : demo ? (
          <h2 className="sp-demo-title">{TOOL_TITLE[tool]}</h2>
        ) : (
          <span className="sp-kicker">{TOOL_TITLE[tool]}</span>
        )}
        <button type="button" className="icon-button" aria-label="Cerrar" disabled={Boolean(status)} onClick={() => ref.current?.close()}>
          <X size={18} />
        </button>
      </div>
      <h2 id={`${uid}-title`}>
        {source === "elegir"
          ? demo
            ? "Elegí una propiedad"
            : "Elegí la propiedad"
          : source === "importar"
            ? demo
              ? "Importar propiedad"
              : "Importá la propiedad"
            : source === "subir"
              ? demo
                ? "Subir fotos"
                : "Subí tus fotos"
              : demo
                ? "¿Con qué querés empezar?"
                : "¿Con qué imágenes querés empezar?"}
      </h2>

      {!source && (
        <>
          {!items && <p role="status">Cargando tus propiedades…</p>}
          {items && hasItems && sorted[0].origin === "admin" && !sorted[0].group && (
            <button type="button" className="sp-featured" onClick={() => go(sorted[0].id, "elegir")}>
              <PropertyThumb p={sorted[0]} />
              <span className="sp-option-text">
                <strong>Seguir con {sorted[0].title}</strong>
                <small>La propiedad que preparamos en tu demostración.</small>
              </span>
              <ArrowRight size={18} aria-hidden="true" />
            </button>
          )}
          {items && (
            <ul className="sp-options">
              {ordered.map(({ id, icon: Icon, title, text }) => (
                <li key={id}>
                  <button type="button" className="sp-option" onClick={() => setSource(id)}>
                    <span className="sp-option-icon" aria-hidden="true">
                      <Icon size={20} />
                    </span>
                    <span className="sp-option-text">
                      <strong>{title}</strong>
                      <small>{text}</small>
                    </span>
                    <ArrowRight size={18} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {loadError && (
            <p className="inline-notice" role="status">
              {loadError} Podés importar una propiedad o subir fotos.
            </p>
          )}
        </>
      )}

      {source === "elegir" && (
        <div className="sp-pick">
          {(demo || sorted.length > 5) && (
            <label className="ap-search sp-search">
              <Search size={16} aria-hidden="true" />
              <input type="search" placeholder="Buscar por título o ubicación" aria-label="Buscar propiedades" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
            </label>
          )}
          <ul className="sp-list" role={demo ? "listbox" : undefined} aria-label={demo ? "Tus propiedades" : undefined}>
            {listed.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className={`sp-prop ${chosen === p.id ? "is-on" : ""}`}
                  role={demo ? "option" : undefined}
                  aria-selected={demo ? chosen === p.id : undefined}
                  onClick={() => (demo ? setChosen(p.id) : go(p.id, "elegir"))}
                >
                  <PropertyThumb p={p} />
                  <span className="sp-option-text">
                    <strong>{p.title}</strong>
                    <small>
                      {p.location ? `${p.location} · ` : ""}
                      {p.photos} {p.photos === 1 ? "foto" : "fotos"}
                    </small>
                  </span>
                  {demo && chosen === p.id ? (
                    <span className="sp-chosen" aria-hidden="true">
                      <Check size={15} strokeWidth={3} />
                    </span>
                  ) : (
                    <span className={`ap-badge ${p.status === "published" && !p.group ? "is-live" : ""}`}>
                      {p.group ? "Fotos sin ficha" : p.status === "published" ? "Publicada" : "Borrador"}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          {!listed.length && (
            <p className="ap-empty">{q ? "Ninguna propiedad coincide con la búsqueda." : "Todavía no tenés propiedades: importá una o subí sus fotos."}</p>
          )}
          {demo && (
            <button type="button" className="button button-primary sp-continue" disabled={!chosen} onClick={() => chosen && go(chosen, "elegir")}>
              Continuar
            </button>
          )}
        </div>
      )}

      {source === "importar" && (
        <div className="sp-import">
          <ImportProperty inputId="sp-import-url" allowMany={false} existingCount={existingCount} openPath={(id) => toolPath(tool, id)} />
          {demo && (
            <p className="dm-help">
              ¿La publicación no se puede leer?{" "}
              <button type="button" className="text-link" onClick={() => setSource("subir")}>
                Subí las fotos a mano
              </button>{" "}
              y completá los datos en el editor.
            </p>
          )}
        </div>
      )}

      {source === "subir" && (
        <div className="sp-upload">
          <div
            className="ap-img-drop"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              setFiles((all) => [...all, ...Array.from(e.dataTransfer.files)]);
            }}
          >
            <Upload size={22} aria-hidden="true" />
            <p>Arrastrá tus fotos o elegí archivos</p>
            <small>JPG, PNG o WebP · Hasta {MB} MB por foto</small>
            <input
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp"
              aria-label="Elegir fotos desde el dispositivo"
              disabled={Boolean(status)}
              onChange={(e) => {
                const list = e.target.files;
                if (list?.length) setFiles((all) => [...all, ...Array.from(list)]);
                e.target.value = "";
              }}
            />
          </div>
          {files.length > 0 && (
            <ul className="sp-files">
              {files.map((f, i) => {
                const problem = fileProblem(f);
                return (
                  <li key={`${f.name}-${i}`} className={`${problem ? "is-bad" : ""} ${demo ? "is-demo" : ""}`}>
                    {demo && previews[i] && <img src={previews[i]!} alt="" className="sp-file-thumb" />}
                    <span>{f.name}</span>
                    {problem && <em>{problem}</em>}
                    {demo && !problem && (
                      <>
                        <button
                          type="button"
                          className={`icon-button sp-cover ${cover === i ? "is-on" : ""}`}
                          aria-pressed={cover === i}
                          aria-label={cover === i ? `${f.name} es la portada` : `Usar ${f.name} de portada`}
                          title={cover === i ? "Portada" : "Usar de portada"}
                          disabled={Boolean(status)}
                          onClick={() => setCover(i)}
                        >
                          <Star size={14} />
                        </button>
                        <button type="button" className="icon-button" aria-label={`Subir ${f.name}`} disabled={Boolean(status) || i === 0} onClick={() => move(i, -1)}>
                          <ArrowUp size={14} />
                        </button>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`Bajar ${f.name}`}
                          disabled={Boolean(status) || i === files.length - 1}
                          onClick={() => move(i, 1)}
                        >
                          <ArrowDown size={14} />
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Quitar ${f.name}`}
                      disabled={Boolean(status)}
                      onClick={() => {
                        setFiles((all) => all.filter((_, j) => j !== i));
                        setCover((c) => (c > i ? c - 1 : c === i ? 0 : c));
                      }}
                    >
                      <X size={14} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <p className="dm-help">
            {demo
              ? "Subir no usa créditos. Se crea un borrador de la propiedad con estas fotos: el título, la ubicación y los demás datos se completan en el editor."
              : "Subir no usa créditos. Después podés crear una ficha con estas fotos o sumarlas a una propiedad."}
          </p>
          <button type="button" className="button button-primary" disabled={Boolean(status) || !files.some((f) => !fileProblem(f))} onClick={() => void upload()}>
            {status ? (
              <>
                <Loader2 size={16} className="spin" aria-hidden="true" /> {status}
              </>
            ) : (
              <>
                {demo ? "Continuar" : "Subir y continuar"} <ArrowRight size={16} aria-hidden="true" />
              </>
            )}
          </button>
        </div>
      )}
    </dialog>
  );
}

function PropertyThumb({ p }: { p: PanelProperty }) {
  return <span className="sp-thumb">{p.coverPhotoId ? <img src={adminPhotoUrl(p.coverPhotoId, null, 240)} alt="" loading="lazy" /> : <Home size={18} aria-hidden="true" />}</span>;
}
