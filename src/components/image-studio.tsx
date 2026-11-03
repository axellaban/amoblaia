"use client";
// "Estudio de imágenes": the agency's photos in one place. "Mis fotos" opens
// the photo workspace for a photo group or a property with every photo in
// one gallery (all the photos · the photo and its versions · Ambientar /
// Editar con IA); "Desde una URL" brings new photos. Same routes, credits and
// limits as the property editor. It edits photos: a ficha is optional.
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { ArrowLeft, Check, ChevronDown, CircleHelp, FileText, Home, Images, Link2, MoreVertical, Search } from "lucide-react";
import { ApiError, api } from "./admin-demos";
import { DemoEditor } from "./demo-editor";
import { ImportImages, type Method } from "./agency-images";
import { track } from "@/lib/analytics";
import { OPEN_ASSISTANT_EVENT } from "@/lib/assistant/shared";
import { safeReturn, type PanelProperty } from "@/lib/agency/shared";
import { adminPhotoUrl } from "@/lib/demos/shared";

type Item = PanelProperty & { group: boolean };

/** Where a property or photo group opens in the studio. */
export const studioPath = (id: string) => `/panel/imagenes?${new URLSearchParams({ pestana: "fotos", fotos: id })}`;

export function ImageStudio({ initialTab, initialMethod, initialId }: { initialTab: "fotos" | "url"; initialMethod: Method; initialId: string | null }) {
  const router = useRouter();
  const [tab, setTab] = useState<"fotos" | "url">(initialTab);
  const [items, setItems] = useState<Item[] | null>(null);
  const [selected, setSelected] = useState<string | null>(initialId);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // From the demo's «Editar imagen» (?volver=): the way back to that property and photo.
  const [backTo, setBackTo] = useState("");
  const opened = useRef(false);

  useEffect(() => {
    setBackTo(safeReturn(new URLSearchParams(window.location.search).get("volver"), ""));
  }, []);

  useEffect(() => {
    Promise.all([
      api<{ items: PanelProperty[] }>("/api/panel/imagenes").then((d) => d.items.map((p) => ({ ...p, group: true }))),
      api<{ items: PanelProperty[] }>("/api/panel/propiedades?por=48").then((d) => d.items.map((p) => ({ ...p, group: false }))),
    ])
      .then(([groups, props]) => {
        const all = [...groups, ...props];
        setItems(all);
        setSelected((cur) => (cur && all.some((i) => i.id === cur) ? cur : (all[0]?.id ?? null)));
        if (!all.length && initialTab === "fotos") setTab("url");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No pudimos cargar tus fotos."));
  }, [initialTab]);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("pestana", tab);
    if (tab === "fotos" && selected) url.searchParams.set("fotos", selected);
    window.history.replaceState(window.history.state, "", url);
  }, [tab, selected]);

  const current = items?.find((i) => i.id === selected) ?? null;

  // Entering the studio, once: where from and with what (ids only, never content).
  useEffect(() => {
    if (opened.current || !items) return;
    opened.current = true;
    const q = new URLSearchParams(window.location.search);
    track("studio_opened", {
      entry: q.get("volver") ? "demo_edit_image" : q.get("modo") === "editar" ? "home_editar" : q.get("modo") === "ambientar" ? "ambientar" : q.get("fotos") ? "link" : "menu",
      tab,
      items: items.length,
      ...(current ? { property_id: current.id, kind: current.group ? "photo_group" : "property", photos: current.photos } : {}),
    });
  }, [items, current, tab]);

  /** Another property or photo group: its own first photo, nothing of the previous one carried over. */
  function choose(id: string) {
    if (id === selected) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("foto");
    url.searchParams.delete("version");
    window.history.replaceState(window.history.state, "", url);
    setSelected(id);
    const next = items?.find((i) => i.id === id);
    track("studio_source_changed", { property_id: id, kind: next?.group ? "photo_group" : "property" });
  }

  async function createFicha(open: string) {
    if (!current) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/panel/imagenes/${current.id}/ficha`, { method: "POST" });
      track("studio_ficha_created", { photos: current.photos, property_id: current.id });
      router.push(open);
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : "No pudimos crear la ficha.");
      setBusy(false);
    }
  }

  /** «Usar en una demostración»: the property's demo on this photo and version; photos without a ficha get one first (a draft, nothing published). */
  function openInDemo(photoId: string, versionId: string | null) {
    if (!current) return;
    const q = new URLSearchParams({ seccion: "fotos", foto: photoId, volver: `${window.location.pathname}${window.location.search}` });
    if (versionId) q.set("version", versionId);
    const target = `/panel/propiedades/${current.id}?${q}`;
    track("studio_used_in_demo", { property_id: current.id, photo_id: photoId, kind: current.group ? "photo_group" : "property", has_version: Boolean(versionId) });
    if (!current.group) {
      router.push(target);
      return;
    }
    if (
      window.confirm(
        "Para usar estas fotos en una demostración se crea una ficha en borrador con todas sus fotos y versiones. No se publica nada. ¿Crear la ficha?",
      )
    )
      void createFicha(target);
  }

  /** The way back to the demo, on the photo being worked here. */
  function goBack() {
    const back = new URL(backTo, window.location.origin);
    const here = new URLSearchParams(window.location.search);
    const photo = here.get("foto");
    if (photo && photo !== back.searchParams.get("foto")) {
      back.searchParams.set("foto", photo);
      back.searchParams.delete("version");
    }
    router.push(`${back.pathname}${back.search}`);
  }

  return (
    <div className="st">
      {backTo && (
        <button type="button" className="text-link st-back" onClick={goBack}>
          <ArrowLeft size={16} aria-hidden="true" /> Volver a la demostración
        </button>
      )}
      <header className="st-head">
        <div>
          <h1>Estudio de imágenes</h1>
          <p>Mejorá, transformá y ambientá las fotos con IA.</p>
        </div>
        <div className="st-head-actions">
          {tab === "fotos" && current && items && <SourcePicker items={items} current={current} onPick={choose} />}
          <details className="st-menu">
            <summary aria-label="Más opciones">
              <MoreVertical size={20} aria-hidden="true" />
            </summary>
            <div role="menu">
              <button type="button" role="menuitem" onClick={() => window.dispatchEvent(new Event(OPEN_ASSISTANT_EVENT))}>
                <CircleHelp size={16} aria-hidden="true" /> Cómo funciona
              </button>
              {tab === "fotos" && current &&
                (current.group ? (
                  <button type="button" role="menuitem" disabled={busy} onClick={() => void createFicha(`/panel/propiedades/${current.id}?seccion=datos`)}>
                    <FileText size={16} aria-hidden="true" /> {busy ? "Creando…" : "Crear ficha con estas fotos"}
                  </button>
                ) : (
                  <a role="menuitem" href={`/panel/propiedades/${current.id}`}>
                    <FileText size={16} aria-hidden="true" /> Abrir la ficha
                  </a>
                ))}
            </div>
          </details>
        </div>
      </header>
      <div className="st-bar">
        <div className="st-tabs" role="tablist" aria-label="Estudio de imágenes">
          <button type="button" role="tab" aria-selected={tab === "fotos"} onClick={() => setTab("fotos")}>
            <Images size={17} aria-hidden="true" /> Mis fotos
          </button>
          <button type="button" role="tab" aria-selected={tab === "url"} onClick={() => setTab("url")}>
            <Link2 size={17} aria-hidden="true" /> Desde una URL
          </button>
        </div>
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {tab === "fotos" ? (
        !items ? (
          !error && <p role="status">Cargando tus fotos…</p>
        ) : current ? (
          <DemoEditor key={current.id} id={current.id} mode="agency" studio onUseInDemo={openInDemo} />
        ) : (
          <div className="st-empty">
            <p>Todavía no tenés fotos para trabajar.</p>
            <button type="button" className="button button-primary" onClick={() => setTab("url")}>
              Traer fotos desde una URL
            </button>
          </div>
        )
      ) : (
        <div className="st-import">
          <p className="dm-help">Traé fotos desde una publicación o subilas. Importar no genera imágenes ni usa créditos.</p>
          <ImportImages initialMethod={initialMethod} studioPath={studioPath} />
        </div>
      )}
    </div>
  );
}

/** The property or photo group being worked: its cover, name and count; a search when there are many. */
function SourcePicker({ items, current, onPick }: { items: Item[]; current: Item; onPick: (id: string) => void }) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  const q = query.trim().toLowerCase();
  const shown = q ? items.filter((i) => `${i.title} ${i.location ?? ""}`.toLowerCase().includes(q)) : items;
  return (
    <div className="st-source" ref={box}>
      <button type="button" className="st-source-button" aria-haspopup="listbox" aria-expanded={open} aria-controls={`${uid}-list`} onClick={() => setOpen((v) => !v)}>
        <Thumb item={current} />
        <span className="st-source-text">
          <strong>{current.title}</strong>
          <small>
            {current.photos} {current.photos === 1 ? "foto" : "fotos"}
            {current.group ? " · sin ficha" : ""}
          </small>
        </span>
        <ChevronDown size={18} aria-hidden="true" />
      </button>
      {open && (
        <div className="st-source-pop">
          {items.length > 5 && (
            <label className="ap-search st-source-search">
              <Search size={16} aria-hidden="true" />
              <input type="search" placeholder="Buscar propiedad…" aria-label="Buscar propiedades y fotos" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
            </label>
          )}
          <ul id={`${uid}-list`} role="listbox" aria-label="Propiedades y fotos">
            {shown.map((i) => (
              <li key={i.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i.id === current.id}
                  className="st-source-option"
                  onClick={() => {
                    onPick(i.id);
                    setOpen(false);
                  }}
                >
                  <Thumb item={i} />
                  <span className="st-source-text">
                    <strong>{i.title}</strong>
                    <small>
                      {i.location ? `${i.location} · ` : ""}
                      {i.photos} {i.photos === 1 ? "foto" : "fotos"}
                      {i.group ? " · sin ficha" : ""}
                    </small>
                  </span>
                  {i.id === current.id && <Check size={16} aria-hidden="true" className="st-source-check" />}
                </button>
              </li>
            ))}
          </ul>
          {!shown.length && <p className="ap-empty">Ninguna propiedad coincide con la búsqueda.</p>}
        </div>
      )}
    </div>
  );
}

function Thumb({ item }: { item: Item }) {
  return <span className="st-source-thumb">{item.coverPhotoId ? <img src={adminPhotoUrl(item.coverPhotoId, null, 240)} alt="" /> : <Home size={18} aria-hidden="true" />}</span>;
}
