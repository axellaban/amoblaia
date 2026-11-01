"use client";
// "Estudio de imágenes": the agency's photos in one place. "Mis fotos" opens
// the photo workspace (spaces · the photo and its versions · what to do) for
// a photo group or a property; "Desde una URL" brings new photos. Same
// routes, credits and limits as the property editor.
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CircleHelp, FileText, Images, Link2 } from "lucide-react";
import { ApiError, api } from "./admin-demos";
import { DemoEditor } from "./demo-editor";
import { ImportImages, type Method } from "./agency-images";
import { track } from "@/lib/analytics";
import { OPEN_ASSISTANT_EVENT } from "@/lib/assistant/shared";
import type { PanelProperty } from "@/lib/agency/shared";

type Item = PanelProperty & { group: boolean };

export function ImageStudio({ initialTab, initialMethod, initialId }: { initialTab: "fotos" | "url"; initialMethod: Method; initialId: string | null }) {
  const router = useRouter();
  const [tab, setTab] = useState<"fotos" | "url">(initialTab);
  const [items, setItems] = useState<Item[] | null>(null);
  const [selected, setSelected] = useState<string | null>(initialId);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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

  async function createFicha() {
    if (!current) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/panel/imagenes/${current.id}/ficha`, { method: "POST" });
      track("studio_ficha_created", { photos: current.photos });
      router.push(`/panel/propiedades/${current.id}?seccion=datos`);
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : "No pudimos crear la ficha.");
      setBusy(false);
    }
  }

  return (
    <div className="st">
      <header className="st-head">
        <div>
          <h1>Estudio de imágenes</h1>
          <p>Mejorá, transformá y ambientá las fotos de tus propiedades con IA.</p>
        </div>
        <button type="button" className="button button-outline st-help" onClick={() => window.dispatchEvent(new Event(OPEN_ASSISTANT_EVENT))}>
          <CircleHelp size={17} aria-hidden="true" /> Cómo funciona
        </button>
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
        {tab === "fotos" && current && (
          <div className="st-bar-actions">
            <label className="st-pick">
              <span>Fotos de</span>
              <select value={current.id} onChange={(e) => setSelected(e.target.value)}>
                {items!.some((i) => i.group) && (
                  <optgroup label="Fotos importadas">
                    {items!.filter((i) => i.group).map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.title} · {i.photos} fotos
                      </option>
                    ))}
                  </optgroup>
                )}
                {items!.some((i) => !i.group) && (
                  <optgroup label="Propiedades">
                    {items!.filter((i) => !i.group).map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.title} · {i.photos} fotos
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
            {current.group ? (
              <button type="button" className="button button-primary" disabled={busy} onClick={() => void createFicha()}>
                <FileText size={17} aria-hidden="true" /> {busy ? "Creando…" : "Crear ficha con estas fotos"}
              </button>
            ) : (
              <a className="button button-outline" href={`/panel/propiedades/${current.id}`}>
                <FileText size={17} aria-hidden="true" /> Abrir la ficha
              </a>
            )}
          </div>
        )}
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
          <DemoEditor key={current.id} id={current.id} mode="agency" studio />
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
          <ImportImages initialMethod={initialMethod} />
        </div>
      )}
    </div>
  );
}
