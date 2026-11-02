"use client";
// "¿Con qué imágenes querés empezar?" (spec v3 §1.3): what the home's three
// big actions open before their tool. An existing property (its photos are
// reused, nothing is imported again), a new listing (the panel's importer,
// which then continues to the tool) or photos uploaded without a ficha (the
// same photo groups as «Estudio de imágenes»). Nothing here creates its own
// copy of a service: every route is the one the panel already uses.
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Home, Link2, Loader2, Search, Upload, X } from "lucide-react";
import { ApiError, api } from "./admin-demos";
import { ImportProperty } from "./agency-panel";
import { track } from "@/lib/analytics";
import { adminPhotoUrl } from "@/lib/demos/shared";
import { fileProblem } from "@/lib/agency/photo-selection";
import { MAX_UPLOAD_BYTES } from "@/lib/photo-limits";
import type { PanelProperty } from "@/lib/agency/shared";

export type StartTool = "ambientar" | "editar" | "video";

export const TOOL_TITLE: Record<StartTool, string> = { ambientar: "Ambientar con IA", editar: "Editar imágenes", video: "Crear video" };

/** Where each tool opens for a property or a photo group: straight into it, never back to this picker. */
export function toolPath(tool: StartTool, id: string) {
  if (tool === "video") return `/panel/video?${new URLSearchParams({ propiedad: id })}`;
  const q = new URLSearchParams({ pestana: "fotos", fotos: id });
  if (tool === "editar") q.set("modo", "editar");
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
      id = (await api<{ id: string }>("/api/panel/imagenes/grupo", { method: "POST", body: JSON.stringify({ name: "Fotos subidas" }) })).id;
    } catch (e) {
      setStatus("");
      setError(message(e, "No pudimos empezar la subida."));
      return;
    }
    let saved = 0;
    const failed: string[] = [];
    for (const [i, file] of valid.entries()) {
      setStatus(`Subiendo foto ${i + 1} de ${valid.length}…`);
      const form = new FormData();
      form.append("image", file);
      try {
        await api(`/api/admin/demos/${id}/photos`, { method: "POST", body: form });
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
    // What failed is said in the studio too: the group lists the photos it really has.
    go(id, "subir");
  }

  const options: { id: Source; icon: typeof Home; title: string; text: string }[] = [
    { id: "elegir", icon: Home, title: "Elegir una propiedad existente", text: "Usá las fotos que ya están en tu panel." },
    { id: "importar", icon: Link2, title: "Importar nueva propiedad", text: "Pegá la URL de una publicación inmobiliaria." },
    { id: "subir", icon: Upload, title: "Subir fotos", text: "Empezá directamente, sin tener que crear una ficha." },
  ];
  // With no properties, importing and uploading come first; an empty list is not offered.
  const ordered = hasItems ? options : options.filter((o) => o.id !== "elegir");

  return (
    <dialog ref={ref} className="sp-dialog" aria-labelledby={`${uid}-title`} onClose={onClose} onCancel={onClose}>
      <div className="sp-head">
        {source ? (
          <button type="button" className="icon-button" aria-label="Volver a las opciones" disabled={Boolean(status)} onClick={() => setSource(null)}>
            <ArrowLeft size={18} />
          </button>
        ) : (
          <span className="sp-kicker">{TOOL_TITLE[tool]}</span>
        )}
        <button type="button" className="icon-button" aria-label="Cerrar" disabled={Boolean(status)} onClick={() => ref.current?.close()}>
          <X size={18} />
        </button>
      </div>
      <h2 id={`${uid}-title`}>
        {source === "elegir" ? "Elegí la propiedad" : source === "importar" ? "Importá la propiedad" : source === "subir" ? "Subí tus fotos" : "¿Con qué imágenes querés empezar?"}
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
          {sorted.length > 5 && (
            <label className="ap-search sp-search">
              <Search size={16} aria-hidden="true" />
              <input type="search" placeholder="Buscar por título o ubicación" aria-label="Buscar propiedades" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
            </label>
          )}
          <ul className="sp-list">
            {shown.map((p) => (
              <li key={p.id}>
                <button type="button" className="sp-prop" onClick={() => go(p.id, "elegir")}>
                  <PropertyThumb p={p} />
                  <span className="sp-option-text">
                    <strong>{p.title}</strong>
                    <small>
                      {p.location ? `${p.location} · ` : ""}
                      {p.photos} {p.photos === 1 ? "foto" : "fotos"}
                    </small>
                  </span>
                  <span className={`ap-badge ${p.status === "published" && !p.group ? "is-live" : ""}`}>
                    {p.group ? "Fotos sin ficha" : p.status === "published" ? "Publicada" : "Borrador"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {!shown.length && <p className="ap-empty">Ninguna propiedad coincide con la búsqueda.</p>}
        </div>
      )}

      {source === "importar" && (
        <div className="sp-import">
          <ImportProperty inputId="sp-import-url" allowMany={false} existingCount={existingCount} openPath={(id) => toolPath(tool, id)} />
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
                  <li key={`${f.name}-${i}`} className={problem ? "is-bad" : ""}>
                    <span>{f.name}</span>
                    {problem && <em>{problem}</em>}
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Quitar ${f.name}`}
                      disabled={Boolean(status)}
                      onClick={() => setFiles((all) => all.filter((_, j) => j !== i))}
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
          <p className="dm-help">Subir no usa créditos. Después podés crear una ficha con estas fotos o sumarlas a una propiedad.</p>
          <button type="button" className="button button-primary" disabled={Boolean(status) || !files.some((f) => !fileProblem(f))} onClick={() => void upload()}>
            {status ? (
              <>
                <Loader2 size={16} className="spin" aria-hidden="true" /> {status}
              </>
            ) : (
              <>
                Subir y continuar <ArrowRight size={16} aria-hidden="true" />
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
