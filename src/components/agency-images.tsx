"use client";
// Importar imágenes: bring photos from listing links or local files, choose
// them by source, and import them as photo groups. No ficha is created, no
// credit is used and nothing is published. Each source says what happened:
// one failed link never blocks the others, and a retry never duplicates what
// was already saved.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ImagePlus, Upload } from "lucide-react";
import { ApiError, api } from "./admin-demos";
import { syncPhotos } from "./demo-import";
import type { ImportedDemo } from "@/lib/demos/import";
import { MAX_UPLOAD_BYTES } from "@/lib/photo-limits";
import type { PanelProperty } from "@/lib/agency/shared";
import { MAX_LISTINGS, fileProblem, readCounts, selectionTotals, splitListings } from "@/lib/agency/photo-selection";

export type Method = "url" | "many" | "files";
const METHODS: { id: Method; label: string }[] = [
  { id: "url", label: "Desde URL" },
  { id: "many", label: "Varias URLs" },
  { id: "files", label: "Subir fotos" },
];
type Preview = ImportedDemo & { listingUrl: string; duplicateOf: string | null };
type Listing = {
  id: string;
  url: string;
  state: "waiting" | "reading" | "ready" | "duplicate" | "error";
  preview?: Preview;
  duplicateOf?: string | null;
  error?: string;
  /** The photos chosen for this import. Empty: this listing is left out. */
  picks: Set<string>;
};
type Upload = { id: string; file: File; picked: boolean };
/** An import as the panel reports it: what was saved, what is still missing. */
type Imported = {
  id: string;
  title: string;
  demoId: string | null;
  importId: string | null;
  total: number;
  done: number;
  /** Listing photos not downloaded yet: retried, never sent twice when saved. */
  pending: string[];
  /** Uploaded files not sent yet. */
  files: File[];
  status: "working" | "done" | "partial" | "error";
  error?: string;
  ficha?: boolean;
  /** The existing property of a listing already imported: opened, never copied again. */
  duplicateOf?: string;
};

const message = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);
const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 60);
  }
};
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const MB = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));

export function ImportImages({ initialMethod = "url" }: { initialMethod?: Method }) {
  const [method, setMethod] = useState<Method>(initialMethod);
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [listings, setListings] = useState<Listing[]>([]);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [groupName, setGroupName] = useState("");
  const [step, setStep] = useState<"buscar" | "elegir" | "listo">("buscar");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [imported, setImported] = useState<Imported[]>([]);
  const [groups, setGroups] = useState<PanelProperty[] | null>(null);
  const [groupsError, setGroupsError] = useState("");
  const tabs = useRef<Record<Method, HTMLButtonElement | null>>({ url: null, many: null, files: null });
  const previews = useRef(new Map<File, string>());

  useEffect(() => {
    const urls = previews.current;
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  async function loadGroups() {
    try {
      const data = await api<{ items: PanelProperty[] }>("/api/panel/imagenes");
      setGroups(data.items);
      setGroupsError("");
    } catch (e) {
      setGroupsError(message(e, "No pudimos cargar tus grupos de fotos."));
    }
  }
  useEffect(() => {
    void loadGroups();
  }, []);

  const patch = (id: string, change: Partial<Listing>) => setListings((all) => all.map((l) => (l.id === id ? { ...l, ...change } : l)));
  const patchImport = (key: string, change: Partial<Imported>) => setImported((all) => all.map((i) => (i.id === key ? { ...i, ...change } : i)));

  /** Reads one listing: its photos, or what it is (a duplicate) or why it could not be read. */
  async function readListing(l: Listing) {
    patch(l.id, { state: "reading", error: undefined });
    try {
      const data = await api<Preview>("/api/panel/importar", { method: "POST", body: JSON.stringify({ url: l.url, preview: true }) });
      patch(l.id, {
        state: data.duplicateOf ? "duplicate" : "ready",
        preview: data,
        duplicateOf: data.duplicateOf,
        picks: new Set(data.duplicateOf ? [] : data.images),
      });
    } catch (e) {
      patch(l.id, { state: "error", error: message(e, "No pudimos leer las fotos de esa publicación.") });
    }
  }

  /** Adds links and reads them one by one: a link that fails does not stop the rest. */
  async function readLinks(urls: string[]) {
    setError("");
    const fresh: Listing[] = [];
    for (const u of urls) {
      if (listings.some((l) => l.url === u) || fresh.some((l) => l.url === u)) continue;
      fresh.push({ id: crypto.randomUUID(), url: u, state: "waiting", picks: new Set() });
    }
    if (!fresh.length) {
      setError("Esa publicación ya está en la lista.");
      return;
    }
    setListings((all) => [...all, ...fresh]);
    for (const l of fresh) await readListing(l);
  }

  const many = splitListings(text);
  const readyCount = listings.filter((l) => l.state === "ready").length;
  const validUploads = uploads.filter((u) => !fileProblem(u.file));
  const chosenFiles = uploads.filter((u) => u.picked && !fileProblem(u.file));
  const sources = readyCount + validUploads.length;
  const counts = readCounts(listings);

  function addFiles(list: FileList | File[]) {
    const next = Array.from(list).map((file) => ({ id: crypto.randomUUID(), file, picked: true }));
    setUploads((all) => [...all, ...next]);
  }
  const previewOf = (file: File) => {
    let src = previews.current.get(file);
    if (!src) {
      src = URL.createObjectURL(file);
      previews.current.set(file, src);
    }
    return src;
  };

  function onTabKey(e: React.KeyboardEvent, current: Method) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const order = METHODS.map((m) => m.id);
    const next = order[(order.indexOf(current) + (e.key === "ArrowRight" ? 1 : order.length - 1)) % order.length];
    setMethod(next);
    tabs.current[next]?.focus();
  }

  /** Listing photos go to the group, then the browser downloads them and reports what it got. */
  async function importListing(l: Listing): Promise<Imported> {
    const images = (l.preview?.images ?? []).filter((src) => l.picks.has(src));
    const base = { id: l.id, title: l.preview?.title ?? host(l.url), demoId: null, importId: null, total: images.length, done: 0, pending: images, files: [], status: "working" as const };
    try {
      const made = await api<{ id: string; importId: string; images: string[] }>("/api/panel/imagenes", {
        method: "POST",
        body: JSON.stringify({ url: l.preview?.listingUrl ?? l.url, key: crypto.randomUUID(), images }),
      });
      return await sendPhotos({ ...base, demoId: made.id, importId: made.importId, pending: made.images, total: made.images.length });
    } catch (e) {
      const body = e instanceof ApiError ? e.body : null;
      if (body?.duplicateOf)
        return { ...base, status: "error", error: "Esta publicación ya está en tu panel.", duplicateOf: String(body.duplicateOf) };
      return { ...base, status: "error", error: message(e, "No pudimos importarla.") };
    }
  }

  /** Downloads the listing photos still missing and reports them; what was saved is kept. */
  async function sendPhotos(item: Imported): Promise<Imported> {
    if (!item.demoId || !item.pending.length) return { ...item, status: item.pending.length ? item.status : "done" };
    try {
      const sync = await syncPhotos(`/api/admin/demos/${item.demoId}`, item.pending, setBusy);
      const done = await api<{ photosDone: number; photosTotal: number; status: string }>("/api/panel/importar", {
        method: "PATCH",
        body: JSON.stringify({ importId: item.importId, done: sync.done, failed: sync.failedUrls }),
      });
      const pending = item.pending.filter((src) => !sync.done.includes(src));
      return {
        ...item,
        pending,
        done: done.photosDone,
        total: done.photosTotal,
        status: pending.length ? "partial" : "done",
        error: sync.failed ? `${plural(sync.failed, "foto no se pudo descargar", "fotos no se pudieron descargar")}. Podés reintentarlas.` : undefined,
      };
    } catch (e) {
      return { ...item, status: "partial", error: message(e, "No pudimos terminar de descargar las fotos.") };
    }
  }

  /** Uploaded files go to one photo group, one request per file: a failed file is kept to retry. */
  async function importFiles(list: File[], title: string, key: string, demoId?: string): Promise<Imported> {
    let id = demoId;
    if (!id) {
      try {
        id = (await api<{ id: string }>("/api/panel/imagenes/grupo", { method: "POST", body: JSON.stringify({ name: title }) })).id;
      } catch (e) {
        return { id: key, title, demoId: null, importId: null, total: list.length, done: 0, pending: [], files: list, status: "error", error: message(e, "No pudimos crear el grupo.") };
      }
    }
    let saved = 0;
    const failed: File[] = [];
    // Why each file failed, so a file that is not a valid photo is not only "retry".
    const reasons: string[] = [];
    for (const [i, file] of list.entries()) {
      setBusy(`Subiendo foto ${i + 1} de ${list.length}…`);
      const form = new FormData();
      form.append("image", file);
      try {
        await api(`/api/admin/demos/${id}/photos`, { method: "POST", body: form });
        saved++;
      } catch (e) {
        failed.push(file);
        if (e instanceof ApiError && e.status >= 400 && e.status < 500) reasons.push(`«${file.name}»: ${e.message}`);
      }
    }
    return {
      id: key,
      title,
      demoId: id,
      importId: null,
      total: list.length,
      done: saved,
      pending: [],
      files: failed,
      status: failed.length ? "partial" : "done",
      error: failed.length
        ? `${plural(failed.length, "foto no se pudo subir", "fotos no se pudieron subir")}. ${reasons.length ? `${reasons.slice(0, 3).join(" ")} ` : ""}Podés reintentarlas.`
        : undefined,
    };
  }

  async function importSelected() {
    setError("");
    setBusy("Importando…");
    const out: Imported[] = [];
    for (const l of listings.filter((x) => x.state === "ready" && x.picks.size > 0)) out.push(await importListing(l));
    const files = chosenFiles.map((u) => u.file);
    if (files.length) out.push(await importFiles(files, groupName.trim() || "Fotos subidas", crypto.randomUUID()));
    setImported((all) => [...out, ...all]);
    setBusy("");
    setStep("listo");
    void loadGroups();
  }

  /** Retries only what is missing: the files not sent, the photos not downloaded, or a listing never created. */
  async function retryImport(item: Imported) {
    patchImport(item.id, { status: "working", error: undefined });
    const listing = listings.find((l) => l.id === item.id);
    let next: Imported;
    if (item.files.length) next = await importFiles(item.files, item.title, item.id, item.demoId ?? undefined);
    else if (item.demoId) next = await sendPhotos(item);
    else if (listing) next = await importListing(listing);
    else next = { ...item, status: "error", error: "Volvé a elegir esas fotos y reintentá." };
    patchImport(item.id, { ...next, id: item.id });
    setBusy("");
    void loadGroups();
  }

  async function makeFicha(item: Imported) {
    if (!item.demoId) return;
    setError("");
    try {
      await api(`/api/panel/imagenes/${item.demoId}/ficha`, { method: "POST" });
      patchImport(item.id, { ficha: true });
      void loadGroups();
    } catch (e) {
      setError(message(e, "No pudimos crear la ficha. Tus fotos siguen guardadas."));
    }
  }

  async function makeGroupFicha(demoId: string) {
    setError("");
    try {
      await api(`/api/panel/imagenes/${demoId}/ficha`, { method: "POST" });
      void loadGroups();
    } catch (e) {
      setError(message(e, "No pudimos crear la ficha. Tus fotos siguen guardadas."));
    }
  }

  function startOver() {
    setListings([]);
    setUploads([]);
    setText("");
    setUrl("");
    setGroupName("");
    setImported([]);
    setError("");
    setStep("buscar");
  }

  const selection = selectionTotals([
    ...listings.filter((l) => l.state === "ready"),
    ...(chosenFiles.length ? [{ picks: new Set(chosenFiles.map((u) => u.id)) }] : []),
  ]);

  return (
    <div className="ap-img">
      <ol className="ap-img-steps" aria-label="Pasos de la importación">
        <li className={step === "buscar" ? "is-on" : "is-done"} aria-current={step === "buscar" ? "step" : undefined}>1 · Origen</li>
        <li className={step === "elegir" ? "is-on" : step === "listo" ? "is-done" : ""} aria-current={step === "elegir" ? "step" : undefined}>2 · Fotos</li>
        <li className={step === "listo" ? "is-on" : ""} aria-current={step === "listo" ? "step" : undefined}>3 · Importar</li>
      </ol>

      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {busy && (
        <p className="dm-help" role="status" aria-live="polite">
          {busy}
        </p>
      )}

      {step === "buscar" && (
        <>
          <div className="ap-img-tabs" role="tablist" aria-label="Cómo traer las fotos">
            {METHODS.map((m) => (
              <button
                key={m.id}
                ref={(el) => {
                  tabs.current[m.id] = el;
                }}
                type="button"
                role="tab"
                id={`ap-img-tab-${m.id}`}
                aria-selected={method === m.id}
                aria-controls="ap-img-panel"
                tabIndex={method === m.id ? 0 : -1}
                className={method === m.id ? "is-on" : ""}
                onClick={() => setMethod(m.id)}
                onKeyDown={(e) => onTabKey(e, m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>

          <div className="ap-img-panel" id="ap-img-panel" role="tabpanel" aria-labelledby={`ap-img-tab-${method}`}>
            {method === "url" && (
              <form
                className="ap-img-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (url.trim()) void readLinks([url.trim()]).then(() => setUrl(""));
                }}
              >
                <label htmlFor="ap-img-url">Enlace de la publicación</label>
                <div className="ap-img-row">
                  <input id="ap-img-url" type="url" inputMode="url" maxLength={500} placeholder="https://inmobiliaria.com/propiedad/..." value={url} onChange={(e) => setUrl(e.target.value)} />
                  <button className="button button-primary" disabled={!url.trim()}>
                    <ImagePlus size={17} aria-hidden="true" /> Buscar fotos
                  </button>
                </div>
              </form>
            )}

            {method === "many" && (
              <div className="ap-img-form">
                <label htmlFor="ap-img-many">Enlaces de propiedades, uno por línea</label>
                <textarea id="ap-img-many" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="https://inmobiliaria.com/propiedad/12345" aria-describedby="ap-img-many-count" />
                <div className="ap-img-row ap-img-meta">
                  <p id="ap-img-many-count" className={many.extra ? "ap-img-warn" : "dm-help"}>
                    {many.urls.length} de {MAX_LISTINGS} enlaces
                    {many.repeated ? ` · ${plural(many.repeated, "repetido", "repetidos")} se lee una sola vez` : ""}
                    {many.extra ? `. Hay ${many.extra} de más: quitá ${many.extra === 1 ? "uno" : plural(many.extra, "enlace", "enlaces")} o leelos en otra tanda.` : ""}
                  </p>
                  <button
                    type="button"
                    className="button button-primary"
                    disabled={!many.urls.length || many.extra > 0}
                    onClick={() => void readLinks(many.urls.slice(0, MAX_LISTINGS)).then(() => setText(""))}
                  >
                    <ImagePlus size={17} aria-hidden="true" /> Buscar fotos
                  </button>
                </div>
              </div>
            )}

            {method === "files" && (
              <div className="ap-img-form">
                <div
                  className="ap-img-drop"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    addFiles(e.dataTransfer.files);
                  }}
                >
                  <Upload size={22} aria-hidden="true" />
                  <p>Arrastrá tus fotos o elegí archivos</p>
                  <small>JPG, PNG o WebP · Hasta {MB} MB por foto</small>
                  <input
                    id="ap-img-files"
                    type="file"
                    multiple
                    accept="image/jpeg,image/png,image/webp"
                    aria-label="Elegir fotos desde el dispositivo"
                    onChange={(e) => {
                      if (e.target.files?.length) addFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </div>
                <div className="ap-img-row">
                  <label htmlFor="ap-img-group">
                    Nombre del grupo · <span className="ap-img-optional">Opcional</span>
                  </label>
                  <input id="ap-img-group" maxLength={160} placeholder="Ej.: Casa en Zona Güemes" value={groupName} onChange={(e) => setGroupName(e.target.value)} />
                </div>
                {uploads.length > 0 && (
                  <p className="dm-help">
                    {plural(uploads.length, "archivo elegido", "archivos elegidos")}
                    {uploads.length - validUploads.length ? ` · ${uploads.length - validUploads.length} no se pueden importar (ver en el paso siguiente)` : ""}
                  </p>
                )}
              </div>
            )}
          </div>

          {listings.length > 0 && (
            <section className="ap-img-results" aria-labelledby="ap-img-results-title">
              <h2 id="ap-img-results-title">Lo que encontramos</h2>
              <p className="dm-help" role="status">
                {counts.total} {counts.total === 1 ? "enlace" : "enlaces"} · {counts.ready} {counts.ready === 1 ? "lista" : "listas"} · {counts.duplicate} duplicada{counts.duplicate === 1 ? "" : "s"} · {counts.error} con error
                {counts.pending ? ` · ${counts.pending} leyendo` : ""}
              </p>
              <ul className="ap-img-list">
                {listings.map((l) => (
                  <li key={l.id} className={`is-${l.state}`}>
                    <span className="ap-img-thumb" aria-hidden="true">
                      {l.preview?.images[0] ? <img src={l.preview.images[0]} alt="" loading="lazy" /> : null}
                    </span>
                    <span className="ap-img-info">
                      <strong>{l.preview?.title ?? host(l.url)}</strong>
                      <small>
                        {host(l.url)}
                        {l.state === "ready" ? ` · ${plural(l.preview?.images.length ?? 0, "foto encontrada", "fotos encontradas")}` : ""}
                      </small>
                      <span className="ap-img-state">
                        {l.state === "waiting" && "En espera"}
                        {l.state === "reading" && "Leyendo…"}
                        {l.state === "ready" && "Lista"}
                        {l.state === "duplicate" && "Duplicada: ya está en tu panel"}
                        {l.state === "error" && (l.error ?? "No pudimos leer este enlace.")}
                      </span>
                    </span>
                    <span className="ap-img-actions">
                      {l.state === "duplicate" && l.duplicateOf && (
                        <Link href={`/panel/propiedades/${l.duplicateOf}`} className="button button-small button-outline">
                          Abrir la existente
                        </Link>
                      )}
                      {l.state === "error" && (
                        <button type="button" className="button button-small button-outline" disabled={Boolean(busy)} onClick={() => void readListing(l)}>
                          Reintentar
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="ap-img-footer">
            <p className="dm-help">Podés continuar con las listas y resolver el resto después.</p>
            <button type="button" className="button button-primary" disabled={!sources || Boolean(busy)} onClick={() => setStep("elegir")}>
              Continuar con {plural(sources, "origen listo", "orígenes listos")} →
            </button>
          </div>

          {groups && groups.length > 0 && (
            <section className="ap-img-groups" aria-labelledby="ap-img-groups-title">
              <h2 id="ap-img-groups-title">Fotos sin ficha</h2>
              <p className="dm-help">Están guardadas y se pueden editar. Crear la ficha no publica nada.</p>
              <ul className="ap-img-list">
                {groups.map((g) => (
                  <li key={g.id}>
                    <span className="ap-img-info">
                      <strong>{g.title}</strong>
                      <small>
                        {plural(g.photos, "foto", "fotos")}
                        {g.listingUrl ? ` · ${host(g.listingUrl)}` : ""}
                      </small>
                    </span>
                    <span className="ap-img-actions">
                      <Link href={`/panel/imagenes/lote?grupo=${g.id}`} className="button button-small button-primary">
                        Ambientar
                      </Link>
                      <Link href={`/panel/propiedades/${g.id}?volver=${encodeURIComponent("/panel/imagenes")}`} className="button button-small button-outline">
                        Abrir en el editor
                      </Link>
                      <button type="button" className="button button-small button-outline" onClick={() => void makeGroupFicha(g.id)}>
                        Crear ficha con estas fotos
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {groupsError && (
            <p className="inline-notice" role="status">
              {groupsError}
            </p>
          )}
        </>
      )}

      {step === "elegir" && (
        <>
          <h2 className="ap-img-title">Elegí las fotos para importar</h2>
          <p className="dm-help">Desmarcar excluye la foto de esta importación. No borra ninguna foto que ya tengas.</p>
          {listings
            .filter((l) => l.state === "ready" && l.preview)
            .map((l) => (
              <fieldset key={l.id} className="ap-img-group">
                <legend>
                  <strong>{l.preview?.title}</strong> <small>{host(l.url)}</small>
                </legend>
                <div className="ap-img-group-head">
                  <span>
                    {l.picks.size} de {l.preview?.images.length ?? 0} elegidas
                  </span>
                  <span>
                    <button type="button" className="text-link" onClick={() => patch(l.id, { picks: new Set(l.preview?.images) })}>
                      Elegir todas
                    </button>{" "}
                    |{" "}
                    <button type="button" className="text-link" onClick={() => patch(l.id, { picks: new Set() })}>
                      Ninguna
                    </button>
                  </span>
                </div>
                <div className="ap-photo-grid">
                  {(l.preview?.images ?? []).map((src, i) => (
                    <label key={src} className={l.picks.has(src) ? "is-on" : ""}>
                      <input
                        type="checkbox"
                        checked={l.picks.has(src)}
                        onChange={(e) => {
                          const next = new Set(l.picks);
                          if (e.target.checked) next.add(src);
                          else next.delete(src);
                          patch(l.id, { picks: next });
                        }}
                      />
                      <img src={src} alt={`Foto ${i + 1} de ${l.preview?.title ?? "la publicación"}`} loading="lazy" />
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          {validUploads.length > 0 && (
            <fieldset className="ap-img-group">
              <legend>
                <strong>{groupName.trim() || "Fotos subidas"}</strong> <small>Archivos del dispositivo</small>
              </legend>
              <div className="ap-img-group-head">
                <span>
                  {validUploads.filter((u) => u.picked).length} de {validUploads.length} elegidas
                </span>
                <span>
                  <button type="button" className="text-link" onClick={() => setUploads((all) => all.map((u) => (fileProblem(u.file) ? u : { ...u, picked: true })))}>
                    Elegir todas
                  </button>{" "}
                  |{" "}
                  <button type="button" className="text-link" onClick={() => setUploads((all) => all.map((u) => ({ ...u, picked: false })))}>
                    Ninguna
                  </button>
                </span>
              </div>
              <div className="ap-photo-grid">
                {validUploads.map((u) => (
                  <label key={u.id} className={u.picked ? "is-on" : ""}>
                    <input type="checkbox" checked={u.picked} onChange={(e) => setUploads((all) => all.map((x) => (x.id === u.id ? { ...x, picked: e.target.checked } : x)))} />
                    <img src={previewOf(u.file)} alt={`Archivo ${u.file.name}`} loading="lazy" />
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {uploads.some((u) => fileProblem(u.file)) && (
            <ul className="dm-warnings" aria-label="Archivos que no se pueden importar">
              {uploads
                .filter((u) => fileProblem(u.file))
                .map((u) => (
                  <li key={u.id}>
                    <strong>{u.file.name}:</strong> {fileProblem(u.file)}
                  </li>
                ))}
            </ul>
          )}

          <div className="ap-img-bar" role="region" aria-label="Resumen de la importación">
            <p>
              <strong>
                {plural(selection.photos, "foto", "fotos")} · {plural(selection.groups, "propiedad", "propiedades")}
              </strong>
              <small>Las fotos quedan agrupadas por origen. No se publica ninguna ficha.</small>
            </p>
            <div className="ap-img-row">
              <button type="button" className="button button-outline" onClick={() => setStep("buscar")}>
                Volver
              </button>
              <button type="button" className="button button-primary" disabled={!selection.photos || Boolean(busy)} onClick={() => void importSelected()}>
                {busy ? "Importando…" : `Importar ${selection.photos} ${selection.photos === 1 ? "foto" : "fotos"}`}
              </button>
            </div>
          </div>
        </>
      )}

      {step === "listo" && (
        <>
          <h2 className="ap-img-title">Fotos importadas</h2>
          <p className="dm-help">Importar no generó imágenes ni usó créditos. Los originales se conservan y no se publicó ninguna ficha.</p>
          <ul className="ap-img-list">
            {imported.map((item) => (
              <li key={item.id} className={`is-${item.status}`}>
                <span className="ap-img-info">
                  <strong>{item.title}</strong>
                  <small>
                    {item.status === "working" && "Importando…"}
                    {item.status === "done" && `Importada: ${plural(item.done, "foto", "fotos")}`}
                    {item.status === "partial" && `Importada parcialmente: ${item.done} de ${item.total} fotos`}
                    {item.status === "error" && "No se importó"}
                    {item.ficha && " · ficha en borrador"}
                  </small>
                  {item.error && <span className="ap-img-state">{item.error}</span>}
                  {item.duplicateOf && (
                    <Link href={`/panel/propiedades/${item.duplicateOf}`} className="text-link">
                      Abrir la existente
                    </Link>
                  )}
                </span>
                <span className="ap-img-actions">
                  {item.demoId && (
                    <Link href={`/panel/propiedades/${item.demoId}?volver=${encodeURIComponent("/panel/imagenes")}`} className="button button-small button-outline">
                      Abrir en el editor
                    </Link>
                  )}
                  {item.demoId && !item.ficha && (
                    <button type="button" className="button button-small button-outline" disabled={Boolean(busy)} onClick={() => void makeFicha(item)}>
                      Crear ficha con estas fotos
                    </button>
                  )}
                  {(item.pending.length > 0 || item.files.length > 0) && (
                    <button type="button" className="button button-small" disabled={Boolean(busy)} onClick={() => void retryImport(item)}>
                      Reintentar {item.files.length || item.pending.length} {item.files.length || item.pending.length === 1 ? "foto" : "fotos"}
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <div className="ap-img-footer">
            <p className="dm-help">Las listas con error no bloquearon a las demás: podés reintentarlas.</p>
            <span className="ap-img-row">
              <button type="button" className="button button-outline" onClick={startOver}>
                Importar más
              </button>
              {imported.some((i) => i.demoId && i.done > 0) && (
                <Link href={`/panel/imagenes/lote?grupo=${imported.find((i) => i.demoId && i.done > 0)?.demoId}`} className="button button-primary">
                  Ambientar estas fotos →
                </Link>
              )}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
