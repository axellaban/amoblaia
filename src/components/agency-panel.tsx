"use client";
// The agency's panel: home, properties, AI credits and its own website.
// Everything goes through /api/panel and the property routes, which check
// the agency membership on every request.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CreditCard,
  ExternalLink,
  Globe,
  Home,
  ImagePlus,
  LayoutGrid,
  Link2,
  Pencil,
  Search,
  Share2,
  Sparkles,
  Trash2,
} from "lucide-react";
import { api, publicLink } from "./admin-demos";
import { ImportPreview, exceptions, syncPhotos } from "./demo-import";
import { track } from "@/lib/analytics";
import { agencyPropertyPath, agencySitePath, type PanelProperty, type PanelSummary } from "@/lib/agency/shared";
import type { ImportedDemo } from "@/lib/demos/import";
import { adminPhotoUrl } from "@/lib/demos/shared";

type Section = "inicio" | "propiedades" | "creditos" | "sitio";
const SECTIONS: { id: Section; href: string; label: string; icon: typeof Home }[] = [
  { id: "inicio", href: "/panel", label: "Inicio", icon: Home },
  { id: "propiedades", href: "/panel/propiedades", label: "Mis propiedades", icon: LayoutGrid },
  { id: "creditos", href: "/panel/creditos", label: "Créditos IA", icon: CreditCard },
  { id: "sitio", href: "/panel/sitio", label: "Mi sitio web", icon: Globe },
];

export function PanelNav({ section, agencyName }: { section: Section; agencyName?: string }) {
  return (
    <div className="ap-nav-wrap">
      <nav className="container ap-nav" aria-label="Panel de la inmobiliaria">
        {agencyName && <strong className="ap-nav-name">{agencyName}</strong>}
        <div className="ap-nav-links">
          {SECTIONS.map(({ id, href, label, icon: Icon }) => (
            <Link key={id} href={href} className={id === section ? "is-on" : ""} aria-current={id === section ? "page" : undefined}>
              <Icon size={16} aria-hidden="true" /> {label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}

export function AgencyPanel({ section }: { section: Section }) {
  const [data, setData] = useState<PanelSummary | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(
    () =>
      api<PanelSummary>("/api/panel")
        .then(setData)
        .catch((e) => setError(e instanceof Error ? e.message : "No pudimos cargar el panel.")),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <>
      <PanelNav section={section} agencyName={data?.agency.name} />
      <div className="account-page container ap-page">
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        {!data ? (
          !error && <p>Cargando tu panel…</p>
        ) : section === "inicio" ? (
          <PanelHome data={data} reload={load} />
        ) : section === "propiedades" ? (
          <PropertiesSection data={data} reload={load} />
        ) : section === "creditos" ? (
          <CreditsSection credits={data.credits} />
        ) : (
          <SiteSection data={data} reload={load} setData={setData} />
        )}
      </div>
    </>
  );
}

function PanelHome({ data, reload }: { data: PanelSummary; reload: () => Promise<unknown> }) {
  const staged = data.properties.filter((p) => p.staged > 0).length;
  const failed = data.imports.filter((i) => i.status === "failed");
  return (
    <>
      <div className="ap-head">
        <div>
          <span className="eyebrow">Tu inmobiliaria</span>
          <h1>{data.agency.name}</h1>
        </div>
        {data.agency.slug && (
          <Link href={agencySitePath(data.agency.slug)} className="button button-outline" target="_blank">
            <Globe size={17} aria-hidden="true" /> Ver mi sitio
          </Link>
        )}
      </div>
      <section className="ap-import-hero" aria-labelledby="ap-import-title">
        <h2 id="ap-import-title">
          <ImagePlus size={22} aria-hidden="true" /> Agregar propiedad
        </h2>
        <ImportProperty onDone={reload} />
      </section>
      <dl className="ap-stats">
        <div>
          <dt>Propiedades</dt>
          <dd>{data.properties.length}</dd>
        </div>
        <div>
          <dt>Con imágenes IA</dt>
          <dd>{staged}</dd>
        </div>
        <div>
          <dt>Créditos IA</dt>
          <dd>
            {data.credits} <Link href="/panel/creditos">Ver</Link>
          </dd>
        </div>
      </dl>
      {failed.length > 0 && (
        <section className="account-panel">
          <h2>Importaciones con error</h2>
          <ul className="ap-failed">
            {failed.slice(0, 5).map((i) => (
              <li key={i.id}>
                <span>
                  <strong>{shortUrl(i.url)}</strong>
                  <small>{i.error}</small>
                </span>
                <RetryImport url={i.url} onDone={reload} />
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <div className="ap-section-head">
          <h2>Últimas propiedades</h2>
          <Link href="/panel/propiedades" className="text-link">
            Ver todas
          </Link>
        </div>
        {data.properties.length ? (
          <div className="ap-grid">
            {data.properties.slice(0, 6).map((p) => (
              <PropertyCard key={p.id} property={p} slug={data.agency.slug} reload={reload} canDelete={data.role === "owner"} />
            ))}
          </div>
        ) : (
          <p className="ap-empty">Todavía no cargaste propiedades. Pegá el enlace de una publicación para empezar.</p>
        )}
      </section>
    </>
  );
}

const shortUrl = (url: string) => {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.length > 40 ? `${u.pathname.slice(0, 40)}…` : u.pathname}`;
  } catch {
    return url.slice(0, 60);
  }
};

function RetryImport({ url, onDone }: { url: string; onDone: () => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  return open ? (
    <div className="ap-retry">
      <ImportProperty initialUrl={url} onDone={onDone} />
    </div>
  ) : (
    <button type="button" className="button button-small button-outline" onClick={() => setOpen(true)}>
      Reintentar
    </button>
  );
}

function PropertiesSection({ data, reload }: { data: PanelSummary; reload: () => Promise<unknown> }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"" | "draft" | "published">("");
  const [operation, setOperation] = useState("");
  const [adding, setAdding] = useState(false);
  const operations = useMemo(
    () => [...new Set(data.properties.map((p) => p.operation).filter((o): o is string => Boolean(o)))],
    [data.properties],
  );
  const shown = data.properties.filter(
    (p) =>
      (!status || p.status === status) &&
      (!operation || p.operation === operation) &&
      (!query.trim() ||
        `${p.title} ${p.location ?? ""}`.toLowerCase().includes(query.trim().toLowerCase())),
  );
  return (
    <>
      <div className="ap-head">
        <div>
          <span className="eyebrow">{data.agency.name}</span>
          <h1>Mis propiedades</h1>
        </div>
        <button type="button" className="button button-primary" onClick={() => setAdding((a) => !a)}>
          + Agregar propiedad
        </button>
      </div>
      {adding && (
        <section className="ap-import-hero">
          <ImportProperty onDone={reload} />
        </section>
      )}
      <div className="ap-filters" role="search">
        <label className="ap-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            placeholder="Buscar por título o ubicación"
            aria-label="Buscar propiedades"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select aria-label="Estado" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="">Todos los estados</option>
          <option value="published">Publicadas</option>
          <option value="draft">Borradores</option>
        </select>
        {operations.length > 1 && (
          <select aria-label="Operación" value={operation} onChange={(e) => setOperation(e.target.value)}>
            <option value="">Todas las operaciones</option>
            {operations.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        )}
      </div>
      {shown.length ? (
        <div className="ap-grid">
          {shown.map((p) => (
            <PropertyCard key={p.id} property={p} slug={data.agency.slug} reload={reload} canDelete={data.role === "owner"} />
          ))}
        </div>
      ) : (
        <p className="ap-empty">
          {data.properties.length ? "Ninguna propiedad coincide con la búsqueda." : "Todavía no cargaste propiedades."}
        </p>
      )}
    </>
  );
}

function PropertyCard({
  property: p,
  slug,
  reload,
  canDelete,
}: {
  property: PanelProperty;
  slug: string | null;
  reload: () => Promise<unknown>;
  canDelete: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const live = p.status === "published";
  const link = slug ? `${window.location.origin}${agencyPropertyPath(slug, p.token)}` : publicLink(p.token);
  const act = async (task: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setMessage("");
    try {
      await task();
      if (done) setMessage(done);
      await reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "No pudimos completar la acción.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="ap-card">
      <Link href={`/panel/propiedades/${p.id}`} className="ap-card-photo">
        {p.coverPhotoId ? (
          <img src={adminPhotoUrl(p.coverPhotoId, null, 480)} alt="" loading="lazy" />
        ) : (
          <span>Sin fotos</span>
        )}
        <span className={`ap-badge ${live ? "is-live" : ""}`}>{live ? "Publicada" : "Borrador"}</span>
      </Link>
      <div className="ap-card-body">
        <h3>
          <Link href={`/panel/propiedades/${p.id}`}>{p.title}</Link>
        </h3>
        {p.location && <p className="ap-card-location">{p.location}</p>}
        <p className="ap-card-price">
          {p.operation && <span className="ap-chip">{p.operation}</span>}
          {p.price ?? "Precio a consultar"}
        </p>
        <p className="ap-card-meta">
          {p.photos} {p.photos === 1 ? "foto" : "fotos"} · <Sparkles size={13} aria-hidden="true" /> {p.staged} con IA
        </p>
        <div className="ap-card-actions">
          <Link href={`/panel/propiedades/${p.id}`} className="button button-small button-outline" title="Editar información">
            <Pencil size={14} aria-hidden="true" /> Editar
          </Link>
          <Link href={`/panel/propiedades/${p.id}#fotos`} className="button button-small button-outline" title="Generar imágenes IA">
            <Sparkles size={14} aria-hidden="true" /> IA
          </Link>
          {live ? (
            <a href={link} target="_blank" rel="noopener noreferrer" className="button button-small button-outline" title="Ver ficha">
              <ExternalLink size={14} aria-hidden="true" /> Ver
            </a>
          ) : (
            <Link href={`/panel/propiedades/${p.id}/vista-previa`} className="button button-small button-outline" title="Ver ficha">
              <ExternalLink size={14} aria-hidden="true" /> Ver
            </Link>
          )}
          {live && (
            <button
              type="button"
              className="button button-small button-outline"
              title="Compartir"
              onClick={async () => {
                track("property_shared", { property_id: p.id, channel: "copy" });
                const shared =
                  typeof navigator.share === "function"
                    ? await navigator.share({ title: p.title, url: link }).then(() => true, () => false)
                    : false;
                if (!shared) {
                  await navigator.clipboard?.writeText(link).catch(() => null);
                  setMessage("Enlace copiado.");
                }
              }}
            >
              <Share2 size={14} aria-hidden="true" /> Compartir
            </button>
          )}
        </div>
        <div className="ap-card-actions">
          <button
            type="button"
            className={`button button-small ${live ? "button-outline" : "button-primary"}`}
            disabled={busy}
            onClick={() => {
              if (!live) track("property_published", { property_id: p.id, photos: p.photos, staged: p.staged });
              void act(
                () => api(`/api/admin/demos/${p.id}`, { method: "PATCH", body: JSON.stringify({ action: live ? "unpublish" : "publish" }) }),
                live ? "Despublicada." : "Publicada.",
              );
            }}
          >
            {live ? "Despublicar" : "Publicar"}
          </button>
          {canDelete && (
            <button
              type="button"
              className="button button-small button-outline ap-danger"
              disabled={busy}
              onClick={() =>
                window.confirm(
                  `¿Eliminar "${p.title}"? Se borran sus fotos y sus imágenes con IA, y su enlace deja de funcionar. No se puede deshacer.`,
                ) && void act(() => api(`/api/admin/demos/${p.id}`, { method: "DELETE" }))
              }
            >
              <Trash2 size={14} aria-hidden="true" /> Eliminar
            </button>
          )}
        </div>
        {message && (
          <p className="ap-card-message" role="status">
            {message}
          </p>
        )}
      </div>
    </article>
  );
}

type Preview = ImportedDemo & { listingUrl: string; duplicateOf: string | null };

/**
 * Paste a listing URL → its data is read (nothing is asked that was found)
 * → every field can be corrected and each photo kept or left out → the
 * property is created as a draft and its photos imported in order. No
 * staging starts and no credit is used. "Varias URLs" does the same for up
 * to 10 listings, one after another, after reviewing what was found.
 */
export function ImportProperty({ initialUrl = "", onDone }: { initialUrl?: string; onDone?: () => Promise<unknown> }) {
  const router = useRouter();
  const [many, setMany] = useState(false);
  const [url, setUrl] = useState(initialUrl);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [fields, setFields] = useState({ title: "", location: "", price: "", operation: "", description: "" });
  const [keep, setKeep] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const busy = Boolean(status);

  async function read(e?: React.FormEvent) {
    e?.preventDefault();
    setError("");
    setPreview(null);
    setStatus("Leyendo la publicación…");
    track("property_import_started", { source: hostOf(url), mode: "single" });
    try {
      const data = await api<Preview>("/api/panel/importar", { method: "POST", body: JSON.stringify({ url, preview: true }) });
      setPreview(data);
      setFields({
        title: data.title,
        location: data.location ?? "",
        price: data.priceConflict ? "" : (data.price ?? ""),
        operation: data.operation ?? "",
        description: data.description ?? "",
      });
      setKeep(new Set(data.images));
    } catch (err) {
      const message = err instanceof Error ? err.message : "No pudimos leer la publicación.";
      setError(message);
      track("property_import_failed", { source: hostOf(url), status: "preview" });
    } finally {
      setStatus("");
    }
  }

  async function create() {
    if (!preview) return;
    setError("");
    setStatus("Creando la propiedad…");
    try {
      const made = await api<{ id: string; title: string; images: string[] }>("/api/panel/importar", {
        method: "POST",
        body: JSON.stringify({
          url: preview.listingUrl,
          overrides: fields,
          images: preview.images.filter((src) => keep.has(src)),
        }),
      });
      const { failed } = await syncPhotos(`/api/admin/demos/${made.id}`, made.images, (t) => setStatus(`${made.title}. ${t}`));
      track("property_import_completed", {
        source: hostOf(preview.listingUrl),
        photos: made.images.length - failed,
        failed_photos: failed,
        mode: "single",
      });
      await onDone?.();
      router.push(`/panel/propiedades/${made.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos crear la propiedad.");
      track("property_import_failed", { source: hostOf(preview.listingUrl), status: "create" });
      setStatus("");
    }
  }

  if (many) return <ImportMany onDone={onDone} onSingle={() => setMany(false)} />;
  const pending = preview ? exceptions(preview.report).filter((r) => r.field !== "Precio" || !fields.price) : [];
  return (
    <div className="ap-import">
      <form className="ap-import-row" onSubmit={read}>
        <label className="ap-import-label" htmlFor="ap-import-url">
          Pegá el enlace de una propiedad
        </label>
        <div className="ap-import-inputs">
          <input
            id="ap-import-url"
            required
            type="text"
            inputMode="url"
            maxLength={500}
            placeholder="https://inmobiliaria.com/propiedad/..."
            value={url}
            disabled={busy}
            onChange={(e) => {
              setUrl(e.target.value);
              setPreview(null);
            }}
          />
          <button className="button button-primary" disabled={busy || !url.trim()}>
            {status && !preview ? "Leyendo…" : preview ? "Volver a leer" : "Importar propiedad"}
          </button>
        </div>
        <button type="button" className="text-link ap-many-link" onClick={() => setMany(true)}>
          <Link2 size={14} aria-hidden="true" /> Tengo varias URLs
        </button>
      </form>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {status && (
        <p className="dm-help" role="status" aria-live="polite">
          {status}
        </p>
      )}
      {preview && (
        <div className="ap-import-result">
          {preview.duplicateOf ? (
            <p className="inline-notice">
              Esta propiedad ya está en tu panel.{" "}
              <Link href={`/panel/propiedades/${preview.duplicateOf}`}>Abrirla</Link>
            </p>
          ) : null}
          <ImportPreview data={{ ...preview, images: preview.images.filter((src) => keep.has(src)) }} />
          <div className="ap-fields">
            <label>
              Título
              <input value={fields.title} maxLength={160} onChange={(e) => setFields({ ...fields, title: e.target.value })} />
            </label>
            <label>
              Ubicación
              <input value={fields.location} maxLength={160} onChange={(e) => setFields({ ...fields, location: e.target.value })} />
            </label>
            <label>
              Operación
              <input value={fields.operation} maxLength={40} placeholder="Venta, Alquiler…" onChange={(e) => setFields({ ...fields, operation: e.target.value })} />
            </label>
            <label>
              Precio
              <input
                value={fields.price}
                maxLength={40}
                placeholder={preview.priceConflict ? `Elegí: ${preview.priceOptions.join(" o ")}` : "Ej.: USD 120.000"}
                onChange={(e) => setFields({ ...fields, price: e.target.value })}
              />
            </label>
            <label className="ap-fields-wide">
              Descripción
              <textarea rows={5} maxLength={6000} value={fields.description} onChange={(e) => setFields({ ...fields, description: e.target.value })} />
            </label>
          </div>
          {pending.length > 0 && (
            <ul className="dm-warnings">
              {pending.map((r) => (
                <li key={r.field}>
                  <strong>{r.field}:</strong> {r.note}
                </li>
              ))}
            </ul>
          )}
          {preview.images.length > 0 && (
            <fieldset className="ap-photos">
              <legend>
                Fotos ({keep.size} de {preview.images.length}){" "}
                <button type="button" className="text-link" onClick={() => setKeep(keep.size ? new Set() : new Set(preview.images))}>
                  {keep.size ? "Quitar todas" : "Elegir todas"}
                </button>
              </legend>
              <div className="ap-photo-grid">
                {preview.images.map((src, i) => (
                  <label key={src} className={keep.has(src) ? "is-on" : ""}>
                    <input
                      type="checkbox"
                      checked={keep.has(src)}
                      onChange={(e) => {
                        const next = new Set(keep);
                        if (e.target.checked) next.add(src);
                        else next.delete(src);
                        setKeep(next);
                      }}
                    />
                    <img src={src} alt={`Foto ${i + 1}`} loading="lazy" />
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <p className="dm-help">Se guarda como borrador: no se publica ni se usan créditos hasta que lo decidas.</p>
          <button
            type="button"
            className="button button-primary"
            disabled={busy || Boolean(preview.duplicateOf) || !fields.title.trim()}
            onClick={() => void create()}
          >
            {busy ? "Importando…" : `Importar con ${keep.size} ${keep.size === 1 ? "foto" : "fotos"}`}
          </button>
        </div>
      )}
    </div>
  );
}

const hostOf = (url: string) => {
  try {
    return new URL(/^https?:/i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return "invalida";
  }
};

const MAX_BATCH = 10;
type Row = { url: string; state: "waiting" | "reading" | "ready" | "duplicate" | "error" | "importing" | "done"; data?: Preview; error?: string; pick: boolean };

/** Up to 10 listings: read one by one, reviewed, then imported one by one. */
function ImportMany({ onDone, onSingle }: { onDone?: () => Promise<unknown>; onSingle: () => void }) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const update = (i: number, patch: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const urls = [...new Set(text.split(/\s+/).map((u) => u.trim()).filter(Boolean))];

  async function readAll() {
    const list = urls.slice(0, MAX_BATCH).map((url) => ({ url, state: "waiting" as const, pick: true }));
    setRows(list);
    setRunning(true);
    for (const [i, row] of list.entries()) {
      update(i, { state: "reading" });
      track("property_import_started", { source: hostOf(row.url), mode: "batch" });
      try {
        const data = await api<Preview>("/api/panel/importar", { method: "POST", body: JSON.stringify({ url: row.url, preview: true }) });
        update(i, { state: data.duplicateOf ? "duplicate" : "ready", data, pick: !data.duplicateOf });
      } catch (e) {
        update(i, { state: "error", error: e instanceof Error ? e.message : "No pudimos leerla.", pick: false });
        track("property_import_failed", { source: hostOf(row.url), status: "preview", mode: "batch" });
      }
    }
    setRunning(false);
  }

  async function importPicked() {
    setRunning(true);
    for (const [i, row] of rows.entries()) {
      if (!row.pick || row.state !== "ready" || !row.data) continue;
      update(i, { state: "importing" });
      try {
        const made = await api<{ id: string; images: string[] }>("/api/panel/importar", {
          method: "POST",
          body: JSON.stringify({ url: row.data.listingUrl }),
        });
        const { failed } = await syncPhotos(`/api/admin/demos/${made.id}`, made.images, () => null);
        update(i, { state: "done" });
        track("property_import_completed", { source: hostOf(row.url), photos: made.images.length - failed, mode: "batch" });
      } catch (e) {
        update(i, { state: "error", error: e instanceof Error ? e.message : "No pudimos importarla." });
        track("property_import_failed", { source: hostOf(row.url), status: "create", mode: "batch" });
      }
    }
    setRunning(false);
    await onDone?.();
  }

  const LABEL: Record<Row["state"], string> = {
    waiting: "En espera",
    reading: "Leyendo…",
    ready: "Lista",
    duplicate: "Ya está en tu panel",
    error: "Con error",
    importing: "Importando…",
    done: "Importada",
  };
  return (
    <div className="ap-import">
      <label className="ap-import-label" htmlFor="ap-many">
        Pegá hasta {MAX_BATCH} enlaces de propiedades, uno por línea
      </label>
      <textarea id="ap-many" rows={5} value={text} disabled={running} onChange={(e) => setText(e.target.value)} placeholder="https://inmobiliaria.com/propiedad/..." />
      {urls.length > MAX_BATCH && <p className="dm-help">Se leen las primeras {MAX_BATCH}.</p>}
      <div className="ap-import-inputs">
        <button type="button" className="button button-primary" disabled={running || !urls.length} onClick={() => void readAll()}>
          Leer {Math.min(urls.length, MAX_BATCH) || ""} {urls.length === 1 ? "propiedad" : "propiedades"}
        </button>
        <button type="button" className="text-link" onClick={onSingle} disabled={running}>
          Volver a una sola URL
        </button>
      </div>
      {rows.length > 0 && (
        <>
          <ul className="ap-batch">
            {rows.map((r, i) => (
              <li key={r.url} className={`is-${r.state}`}>
                <input
                  type="checkbox"
                  aria-label={`Importar ${r.url}`}
                  checked={r.pick}
                  disabled={running || r.state !== "ready"}
                  onChange={(e) => update(i, { pick: e.target.checked })}
                />
                <span>
                  <strong>{r.data?.title ?? shortUrl(r.url)}</strong>
                  <small>
                    {LABEL[r.state]}
                    {r.data && r.state === "ready" ? ` · ${r.data.images.length} fotos · ${r.data.price ?? "sin precio"}` : ""}
                    {r.error ? ` · ${r.error}` : ""}
                  </small>
                </span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="button button-primary"
            disabled={running || !rows.some((r) => r.pick && r.state === "ready")}
            onClick={() => void importPicked()}
          >
            Importar {rows.filter((r) => r.pick && r.state === "ready").length} como borradores
          </button>
        </>
      )}
    </div>
  );
}

type AccountInfo = {
  credits: number;
  free: boolean;
  grants: { id: string; remaining: number; total: number; expires_at: string | null; source_key: string; revoked: boolean }[] | null;
};

/** The same credits as the rest of habita: one balance, bought from Precios. */
function CreditsSection({ credits }: { credits: number }) {
  const [account, setAccount] = useState<AccountInfo | null>(null);
  useEffect(() => {
    api<AccountInfo>("/api/account").then(setAccount).catch(() => null);
  }, []);
  const grants = (account?.grants ?? []).filter((g) => !g.revoked && !g.source_key.startsWith("demo:"));
  const used = grants.reduce((n, g) => n + (g.total - g.remaining), 0);
  return (
    <>
      <div className="ap-head">
        <div>
          <span className="eyebrow">Créditos IA</span>
          <h1>{credits} {credits === 1 ? "crédito disponible" : "créditos disponibles"}</h1>
        </div>
        <Link href="/precios" className="button button-primary">
          Comprar créditos
        </Link>
      </div>
      <section className="account-panel">
        <h2>Cómo se usan</h2>
        <p>
          Cada foto que transformás con IA usa 1 crédito la primera vez. Las demás versiones y estilos de esa misma foto
          no consumen créditos mientras tu plan esté vigente. Si una generación falla por un problema técnico, el
          crédito vuelve solo. Importar propiedades, publicarlas y compartirlas no usa créditos.
        </p>
      </section>
      <section className="account-panel">
        <h2>Consumo</h2>
        {grants.length ? (
          <>
            <p>
              Usaste {used} de {grants.reduce((n, g) => n + g.total, 0)} créditos de tus planes y packs.
            </p>
            <ul className="ap-grants">
              {grants.map((g) => (
                <li key={g.id}>
                  <span>
                    {g.remaining} de {g.total} disponibles
                  </span>
                  <small>{g.expires_at ? `Vence el ${new Date(g.expires_at).toLocaleDateString("es-AR")}` : "Sin vencimiento"}</small>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p>Todavía no tenés créditos. Elegí un plan o un pack para transformar las fotos de tus propiedades.</p>
        )}
        <Link href="/cuenta" className="text-link">
          Ver pagos y suscripciones
        </Link>
      </section>
    </>
  );
}

/** "Mi sitio web": identity, contact, color, logo and what is public. */
function SiteSection({
  data,
  reload,
  setData,
}: {
  data: PanelSummary;
  reload: () => Promise<unknown>;
  setData: (d: PanelSummary) => void;
}) {
  const a = data.agency;
  const [form, setForm] = useState({
    name: a.name,
    slug: a.slug ?? "",
    website: a.website ?? "",
    whatsapp: a.whatsapp ?? "",
    primary: a.primary ?? "#24382e",
  });
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const owner = data.role === "owner";
  const published = data.properties.filter((p) => p.status === "published").length;
  async function save(body: Record<string, unknown>, done: string) {
    setError("");
    setStatus("");
    try {
      setData(await api<PanelSummary>("/api/panel", { method: "PATCH", body: JSON.stringify(body) }));
      setStatus(done);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos guardar.");
    }
  }
  return (
    <>
      <div className="ap-head">
        <div>
          <span className="eyebrow">Mi sitio web</span>
          <h1>Tu catálogo en habita</h1>
        </div>
        {a.slug && (
          <Link href={agencySitePath(a.slug)} target="_blank" className="button button-outline">
            <ExternalLink size={16} aria-hidden="true" /> Ver mi sitio
          </Link>
        )}
      </div>
      {!owner && <p className="inline-notice">Solo el dueño de la inmobiliaria puede cambiar el sitio.</p>}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {status && (
        <p className="inline-notice" role="status">
          {status}
        </p>
      )}
      <section className="account-panel ap-site-state">
        <div>
          <h2>{a.sitePublished ? "Tu sitio está publicado" : "Tu sitio no está publicado"}</h2>
          <p>
            {a.slug ? `${typeof window === "undefined" ? "" : window.location.host}${agencySitePath(a.slug)}` : "Elegí la dirección de tu sitio."} ·{" "}
            {published} {published === 1 ? "propiedad publicada" : "propiedades publicadas"}. Solo se muestran las propiedades
            publicadas.
          </p>
        </div>
        <button
          type="button"
          className={`button ${a.sitePublished ? "button-outline" : "button-primary"}`}
          disabled={!owner || !a.slug}
          onClick={() => void save({ sitePublished: !a.sitePublished }, a.sitePublished ? "Sitio despublicado." : "Sitio publicado.")}
        >
          {a.sitePublished ? "Despublicar sitio" : "Publicar sitio"}
        </button>
      </section>
      <form
        className="account-panel ap-site-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save(
            {
              name: form.name,
              slug: form.slug,
              website: form.website,
              primary: form.primary,
              contactKind: "whatsapp",
              contactValue: form.whatsapp,
            },
            "Datos guardados.",
          );
        }}
      >
        <h2>Marca y contacto</h2>
        <div className="ap-fields">
          <label>
            Nombre comercial
            <input required maxLength={120} disabled={!owner} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label>
            Dirección del sitio
            <span className="ap-slug">
              <span>/inmobiliaria/</span>
              <input
                required
                maxLength={42}
                pattern="[a-z0-9][a-z0-9-]{1,40}[a-z0-9]"
                disabled={!owner}
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })}
              />
            </span>
          </label>
          <label>
            WhatsApp para consultas
            <input
              inputMode="tel"
              maxLength={30}
              placeholder="+54 9 223 555-1234"
              disabled={!owner}
              value={form.whatsapp}
              onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
            />
          </label>
          <label>
            Tu sitio actual (opcional)
            <input maxLength={300} placeholder="inmobiliaria.com.ar" disabled={!owner} value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
          </label>
          <label>
            Color principal
            <span className="ap-color">
              <input type="color" disabled={!owner} value={form.primary} onChange={(e) => setForm({ ...form, primary: e.target.value })} />
              <code>{form.primary}</code>
            </span>
          </label>
        </div>
        <button className="button button-primary" disabled={!owner}>
          Guardar
        </button>
      </form>
      <section className="account-panel">
        <h2>Logo</h2>
        <div className="dm-logo">
          {a.logo ? (
              <img src={a.logo} alt={`Logo de ${a.name}`} />
          ) : (
            <span className="dm-logo-empty">Sin logo: se muestra el nombre</span>
          )}
          {owner && (
            <div className="dm-logo-actions">
              <label className="button button-small button-outline">
                {a.logo ? "Cambiar logo" : "Subir logo"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  className="dm-hidden-input"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const body = new FormData();
                    body.set("logo", file);
                    await api("/api/panel/logo", { method: "POST", body })
                      .then(() => reload())
                      .then(() => setStatus("Logo guardado."))
                      .catch((err) => setError(err instanceof Error ? err.message : "No pudimos guardar el logo."));
                  }}
                />
              </label>
              {a.logo && (
                <button type="button" className="text-link" onClick={() => void api("/api/panel/logo", { method: "DELETE" }).then(() => reload())}>
                  Quitar
                </button>
              )}
            </div>
          )}
        </div>
      </section>
      <section className="account-panel">
        <h2>Propiedades en el sitio</h2>
        <p>Publicá o despublicá cada propiedad desde «Mis propiedades». Las publicadas aparecen en tu sitio.</p>
        <ul className="ap-site-list">
          {data.properties.map((p) => (
            <li key={p.id}>
              <span>{p.title}</span>
              <span className={`ap-badge ${p.status === "published" ? "is-live" : ""}`}>{p.status === "published" ? "Publicada" : "Borrador"}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

/**
 * The first step: create the agency, or take over the demos the team
 * prepared for it with the one-time code it received. From a demo, its
 * public listing can be imported right away.
 */
export function AgencyOnboarding({
  signedIn,
  hasAgency,
  code,
  demo,
}: {
  signedIn: boolean;
  hasAgency: boolean;
  code: string | null;
  demo: { token: string; id: string; agencyName: string; title: string; listingUrl: string | null } | null;
}) {
  const router = useRouter();
  const [name, setName] = useState(demo?.agencyName ?? "");
  const claim = code ?? "";
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(false);
  const here = `/panel/empezar${demo || code ? `?${new URLSearchParams({ ...(demo ? { demo: demo.token } : {}), ...(code ? { codigo: code } : {}) })}` : ""}`;
  const origin = demo ? "demo" : "direct";
  useEffect(() => {
    if (!signedIn) track("agency_signup_started", { origin, ...(demo ? { demo_id: demo.id } : {}) });
  }, [signedIn, origin, demo]);

  if (!signedIn)
    return (
      <div className="account-page container ap-start">
        <span className="eyebrow">habita para inmobiliarias</span>
        <h1>Creá tu inmobiliaria gratis</h1>
        <p>
          Importá tus propiedades desde sus publicaciones, transformalas con IA y compartí fichas interactivas.
          Sin tarjeta de crédito.
        </p>
        <div className="ap-start-actions">
          <Link href={`/acceso?modo=registro&next=${encodeURIComponent(here)}`} className="button button-primary button-large">
            Crear mi cuenta
          </Link>
          <Link href={`/acceso?next=${encodeURIComponent(here)}`} className="button button-outline button-large">
            Ya tengo cuenta
          </Link>
        </div>
      </div>
    );

  if (hasAgency && !created)
    return (
      <div className="account-page container ap-start">
        <h1>Ya tenés tu inmobiliaria</h1>
        {code && <p>Tu cuenta ya tiene una inmobiliaria, así que ese código no se puede usar con ella.</p>}
        <Link href="/panel" className="button button-primary">
          Ir a mi panel
        </Link>
      </div>
    );

  async function run(task: () => Promise<unknown>, event: string) {
    setBusy(true);
    setError("");
    try {
      await task();
      track(event, { origin, ...(demo ? { demo_id: demo.id } : {}) });
      if (demo) track("demo_to_agency_signup_completed", { demo_id: demo.id, claimed: event === "agency_claimed" });
      setCreated(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos crear tu inmobiliaria.");
    } finally {
      setBusy(false);
    }
  }

  if (created)
    return (
      <div className="account-page container ap-start">
        <span className="eyebrow">Listo</span>
        <h1>Tu inmobiliaria ya está en habita</h1>
        {demo?.listingUrl ? (
          <>
            <p>Sumá ahora la propiedad de la demo: la leemos de su publicación original.</p>
            <section className="ap-import-hero">
              <ImportProperty initialUrl={demo.listingUrl} />
            </section>
          </>
        ) : (
          <section className="ap-import-hero">
            <h2>Agregá tu primera propiedad</h2>
            <ImportProperty />
          </section>
        )}
        <Link href="/panel" className="text-link">
          Ir a mi panel
        </Link>
      </div>
    );

  return (
    <div className="account-page container ap-start">
      <span className="eyebrow">habita para inmobiliarias</span>
      <h1>Creá tu inmobiliaria</h1>
      {demo && (
        <p>
          Viste la demo de <strong>{demo.title}</strong>. En tu panel podés traer todas tus propiedades y transformarlas así.
        </p>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {code ? (
        <form
          className="account-panel ap-start-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => api("/api/panel/reclamar", { method: "POST", body: JSON.stringify({ code: claim }) }), "agency_claimed");
          }}
        >
          <h2>Quedate con tus demos</h2>
          <p>El equipo de habita te envió este enlace para que tus demos, con sus ambientaciones, pasen a tu cuenta.</p>
          <button className="button button-primary" disabled={busy}>
            {busy ? "Un momento…" : "Pasar las demos a mi cuenta"}
          </button>
        </form>
      ) : (
        <form
          className="account-panel ap-start-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => api("/api/panel", { method: "POST", body: JSON.stringify({ name }) }), "agency_created");
          }}
        >
          <label>
            Nombre de tu inmobiliaria
            <input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </label>
          <button className="button button-primary button-large" disabled={busy || !name.trim()}>
            {busy ? "Creando…" : "Crear mi inmobiliaria"}
          </button>
          <p className="dm-help">Sin tarjeta de crédito. Podés cambiar el nombre después.</p>
        </form>
      )}
    </div>
  );
}
