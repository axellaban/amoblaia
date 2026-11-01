"use client";
// The agency's panel: home, properties, AI credits and its own website.
// Everything goes through /api/panel and the property routes, which check
// the agency membership on every request. States say what really happened:
// a failed lookup is "not available", never zero or "create an agency".
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CreditCard,
  ExternalLink,
  Globe,
  Home,
  ImagePlus,
  LayoutGrid,
  LayoutList,
  Link2,
  MoreHorizontal,
  Search,
  Share2,
  Sparkles,
  Users,
} from "lucide-react";
import { ApiError, api } from "./admin-demos";
import { ImportPreview, MapReview, exceptions, initialMapChoice, mapOverride, syncPhotos, type MapChoice } from "./demo-import";
import { track, trackMilestone } from "@/lib/analytics";
import { cta } from "@/lib/interaction-tracking";
import { registerAgency, useSignupTracking } from "@/lib/signup-tracking";
import { shareLink } from "@/lib/agency/share";
import {
  agencySitePath,
  canEdit,
  canManage,
  nextAction,
  propertyLink,
  ROLE_LABEL,
  type AgencyRole,
  type PanelImport,
  type PanelProperty,
  type PanelSummary,
} from "@/lib/agency/shared";
import type { ImportedDemo } from "@/lib/demos/import";
import { importErrorCode, importEventProps } from "@/lib/listings/events";
import { adminPhotoUrl } from "@/lib/demos/shared";
import { leadFromDemoRef } from "@/lib/leads/client";

type Section = "inicio" | "propiedades" | "creditos" | "sitio" | "usuarios";
const SECTIONS: { id: Section; href: string; label: string; icon: typeof Home; managers?: boolean }[] = [
  { id: "inicio", href: "/panel", label: "Inicio", icon: Home },
  { id: "propiedades", href: "/panel/propiedades", label: "Mis propiedades", icon: LayoutGrid },
  { id: "creditos", href: "/panel/creditos", label: "Créditos IA", icon: CreditCard },
  { id: "sitio", href: "/panel/sitio", label: "Mi sitio web", icon: Globe, managers: true },
  { id: "usuarios", href: "/panel/usuarios", label: "Usuarios", icon: Users, managers: true },
];

/** The panel's sections; the site and users only for the owner and administrators. */
export function PanelNav({ section, agencyName, role }: { section: Section; agencyName?: string; role?: AgencyRole }) {
  return (
    <div className="ap-nav-wrap">
      <nav className="container ap-nav" aria-label="Panel de la inmobiliaria">
        {agencyName && <strong className="ap-nav-name">{agencyName}</strong>}
        <div className="ap-nav-links">
          {SECTIONS.filter((s) => !s.managers || (role && canManage(role))).map(({ id, href, label, icon: Icon }) => (
            <Link
              key={id}
              href={href}
              className={id === section ? "is-on" : ""}
              aria-current={id === section ? "page" : undefined}
              {...cta(`panel_nav_${id}`, "panel_nav", `panel_${id}`, "navigation")}
            >
              <Icon size={16} aria-hidden="true" /> {label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}

const message = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

function RetryRow({ error, onRetry, busy = false }: { error: string; onRetry: () => void; busy?: boolean }) {
  return (
    <div className="inline-error ap-retry-row" role="alert">
      <span>{error}</span>
      <button type="button" className="button button-small button-outline" disabled={busy} onClick={onRetry}>
        {busy ? "Reintentando…" : "Reintentar"}
      </button>
    </div>
  );
}

export function AgencyPanel({ section }: { section: Section }) {
  const [data, setData] = useState<PanelSummary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const summary = await api<PanelSummary>("/api/panel");
      setData(summary);
      registerAgency(summary.agency.id);
      setError("");
    } catch (e) {
      setError(message(e, "No pudimos cargar el panel."));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <>
      <PanelNav section={section} agencyName={data?.agency.name} role={data?.role} />
      <div className="account-page container ap-page">
        {error && <RetryRow error={error} busy={loading} onRetry={() => void load()} />}
        {!data ? (
          !error && <p role="status">Cargando tu panel…</p>
        ) : section === "inicio" ? (
          <PanelHome data={data} reload={load} />
        ) : section === "propiedades" ? (
          <PropertiesSection data={data} reload={load} />
        ) : section === "creditos" ? (
          <CreditsSection />
        ) : (
          <SiteSection data={data} setData={setData} reload={load} />
        )}
      </div>
    </>
  );
}

/** New properties and imports: not viewers, nor users limited to some properties. */
const canCreate = (d: PanelSummary) => canEdit(d.role) && !d.scope;

/** The one thing to do next, from the agency's real state. */
function nextStep(d: PanelSummary): { text: string; href: string; action: string } | null {
  if (d.counts.total === 0) return null;
  if (d.counts.published === 0)
    return {
      text: "Revisá los datos y las fotos de tu propiedad y publicá su ficha.",
      href: d.properties[0] ? `/panel/propiedades/${d.properties[0].id}` : "/panel/propiedades",
      action: "Revisar y publicar",
    };
  if (d.counts.review > 0)
    return {
      text: `${d.counts.review} ${d.counts.review === 1 ? "propiedad tiene" : "propiedades tienen"} ambientaciones para revisar.`,
      href: "/panel/propiedades",
      action: "Ver propiedades",
    };
  if (!d.agency.sitePublished) return { text: "Tus fichas ya se pueden compartir. Cuando quieras, publicá tu catálogo.", href: "/panel/sitio", action: "Ver mi sitio" };
  return null;
}

function PanelHome({ data, reload }: { data: PanelSummary; reload: () => Promise<unknown> }) {
  const editor = canEdit(data.role);
  const creator = canCreate(data);
  const step = editor ? nextStep(data) : null;
  const firstSteps = creator && data.counts.published === 0;
  return (
    <>
      <div className="ap-head">
        <div>
          <span className="eyebrow">
            Tu inmobiliaria{data.role !== "owner" ? ` · ${ROLE_LABEL[data.role]}` : ""}
          </span>
          <h1>{data.agency.name}</h1>
        </div>
        <SiteLink agency={data.agency} />
      </div>
      {(!editor || data.scope) && (
        <p className="inline-notice" role="note">
          {!editor
            ? "Tu usuario es de solo vista: podés ver las propiedades y compartir sus enlaces."
            : "Tu usuario trabaja en las propiedades que te asignaron."}
        </p>
      )}
      {step && (
        <section className="ap-next" aria-label="Siguiente paso">
          <p>{step.text}</p>
          <Link href={step.href} className="button button-primary" {...cta("panel_next_step", "panel_home", "property_editor")}>
            {step.action}
          </Link>
        </section>
      )}
      {creator && (
      <div className="ap-entries">
        <section className="ap-import-hero" aria-labelledby="ap-import-title">
          <h2 id="ap-import-title">Crear demostraciones</h2>
          <p className="ap-entry-sub">o fichas de propiedades</p>
          <ImportProperty onDone={reload} />
        </section>
        <section className="ap-entry" aria-labelledby="ap-images-title">
          <h2 id="ap-images-title">
            <ImagePlus size={22} aria-hidden="true" /> Importar imágenes
          </h2>
          <p className="ap-entry-sub">Para ambientar y descargar tus fotos.</p>
          <ul className="ap-entry-methods" aria-label="Formas de traer las fotos">
            <li>
              <Link href="/panel/imagenes?metodo=url" {...cta("import_images_url", "panel_home", "image_import_url")}>
                Desde URL
              </Link>
            </li>
            <li>
              <Link href="/panel/imagenes?metodo=many" {...cta("import_images_many", "panel_home", "image_import_many")}>
                Varias URLs
              </Link>
            </li>
            <li>
              <Link href="/panel/imagenes?metodo=files" {...cta("import_images_files", "panel_home", "image_upload")}>
                Subir fotos
              </Link>
            </li>
          </ul>
          <Link href="/panel/imagenes?metodo=url" className="button button-outline" {...cta("import_images_search", "panel_home", "image_import_url")}>
            Buscar fotos
          </Link>
          <Link href="/panel/imagenes/lote" className="text-link" {...cta("imported_images", "panel_home", "image_batch", "navigation")}>
            Ver fotos importadas
          </Link>
          <p className="dm-help">Importar no genera imágenes ni usa créditos. Publicar la ficha es una acción aparte.</p>
        </section>
      </div>
      )}
      {firstSteps && (
        <ol className="ap-steps" aria-label="Primeros pasos">
          <li className={data.counts.total ? "is-done" : ""}>Agregá una propiedad pegando su enlace</li>
          <li>Revisá datos y fotos</li>
          <li>Ambientá con IA, si querés (es opcional y usa créditos)</li>
          <li>Publicá la ficha y compartila: importar y publicar no usan créditos</li>
        </ol>
      )}
      <dl className="ap-stats">
        <div>
          <dt>Propiedades</dt>
          <dd>{data.counts.total}</dd>
        </div>
        <div>
          <dt>Publicadas</dt>
          <dd>{data.counts.published}</dd>
        </div>
        <div>
          <dt>Borradores</dt>
          <dd>{data.counts.drafts}</dd>
        </div>
        <div>
          <dt>Con imágenes IA</dt>
          <dd>{data.counts.staged}</dd>
        </div>
        <div>
          <dt>Créditos IA</dt>
          <dd>
            {data.credits === null ? <span className="ap-unknown">No disponible</span> : data.credits} <Link href="/panel/creditos" {...cta("panel_credits", "panel_summary", "panel_credits")}>
              Ver
            </Link>
          </dd>
        </div>
      </dl>
      {creator && data.imports.length > 0 && (
        <section className="account-panel" aria-labelledby="ap-imports-title">
          <h2 id="ap-imports-title">Importaciones pendientes</h2>
          <ul className="ap-failed">
            {data.imports.map((i) => (
              <ImportIssue key={i.id} item={i} onDone={reload} />
            ))}
          </ul>
        </section>
      )}
      <section>
        <div className="ap-section-head">
          <h2>Últimas propiedades</h2>
          <Link href="/panel/propiedades" className="text-link">
            Ver todas ({data.counts.total})
          </Link>
        </div>
        {data.properties.length ? (
          <div className="ap-grid">
            {data.properties.map((p) => (
              <PropertyCard key={p.id} property={p} agency={data.agency} reload={reload} canDelete={canManage(data.role)} canPublish={canEdit(data.role)} backTo="/panel" />
            ))}
          </div>
        ) : (
          <p className="ap-empty">
            {data.scope ? "Todavía no te asignaron propiedades." : creator ? "Todavía no cargaste propiedades. Pegá el enlace de una publicación para empezar." : "Todavía no hay propiedades cargadas."}
          </p>
        )}
      </section>
    </>
  );
}

/** "Ver mi sitio": the public catalog when published, its private preview otherwise. */
function SiteLink({ agency }: { agency: PanelSummary["agency"] }) {
  if (!agency.slug) return null;
  return agency.sitePublished ? (
    <Link href={agencySitePath(agency.slug)} className="button button-outline" target="_blank">
      <Globe size={17} aria-hidden="true" /> Ver mi sitio
    </Link>
  ) : (
    <Link href="/panel/sitio/vista-previa" className="button button-outline" title="Tu catálogo todavía no es público">
      <Globe size={17} aria-hidden="true" /> Vista previa de mi sitio
    </Link>
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

/** A partial or failed import, with the retry of only what is missing. */
function ImportIssue({ item, onDone }: { item: PanelImport; onDone: () => Promise<unknown> }) {
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [retryUrl, setRetryUrl] = useState(false);
  async function retryPhotos() {
    if (!item.propertyId) return;
    setError("");
    try {
      const sync = await syncPhotos(`/api/admin/demos/${item.propertyId}`, item.pendingImages, setStatus);
      await api("/api/panel/importar", { method: "PATCH", body: JSON.stringify({ importId: item.id, done: sync.done, failed: sync.failedUrls }) });
      await onDone();
    } catch (e) {
      setError(message(e, "No pudimos reintentar."));
    } finally {
      setStatus("");
    }
  }
  return (
    <li>
      <span>
        <strong>{shortUrl(item.url)}</strong>
        <small>
          {item.status === "partial"
            ? `Importada parcialmente: ${item.photosDone} de ${item.photosTotal} fotos${item.settingsSaved ? "" : " y faltan los datos de la ficha"}.`
            : (item.error ?? "No se pudo importar.")}
        </small>
        {status && <small role="status">{status}</small>}
        {error && <small className="ap-error-text">{error}</small>}
      </span>
      <span className="ap-issue-actions">
        {item.propertyId && (
          <Link href={`/panel/propiedades/${item.propertyId}${item.settingsSaved ? "" : "?completar=1"}`} className="button button-small button-outline">
            {item.settingsSaved ? "Abrir propiedad" : "Completar datos"}
          </Link>
        )}
        {item.status === "partial" && item.pendingImages.length > 0 && (
          <button type="button" className="button button-small" disabled={Boolean(status)} onClick={() => void retryPhotos()}>
            Reintentar {item.pendingImages.length} {item.pendingImages.length === 1 ? "foto" : "fotos"}
          </button>
        )}
        {item.status === "failed" && !item.propertyId && !retryUrl && (
          <button type="button" className="button button-small button-outline" onClick={() => setRetryUrl(true)}>
            Reintentar
          </button>
        )}
      </span>
      {retryUrl && (
        <div className="ap-retry">
          <ImportProperty initialUrl={item.url} onDone={onDone} />
        </div>
      )}
    </li>
  );
}

const PER_PAGE = 24;

/**
 * "Mis propiedades": paged and filtered on the server with the real total;
 * the filters live in the URL, so they are kept when coming back from a
 * property. Cards for a few properties, a compact table for many.
 */
function PropertiesSection({ data, reload }: { data: PanelSummary; reload: () => Promise<unknown> }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const q = params.get("q") ?? "";
  const status = params.get("estado") ?? "";
  const operation = params.get("operacion") ?? "";
  const page = Math.max(1, Number(params.get("pagina")) || 1);
  const [text, setText] = useState(q);
  const [result, setResult] = useState<{ items: PanelProperty[]; total: number } | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const view = params.get("vista") ?? ((result?.total ?? 0) > 12 ? "tabla" : "tarjetas");

  const setParams = useCallback(
    (patch: Record<string, string>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      if (!("pagina" in patch)) next.delete("pagina");
      const qs = next.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [params, pathname, router],
  );
  // Each request has a number: an older answer that arrives late is ignored and its fetch cancelled.
  const seq = useRef(0);
  const inflight = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    const query = new URLSearchParams({ pagina: String(page), por: String(PER_PAGE) });
    if (q) query.set("q", q);
    if (status) query.set("estado", status);
    if (operation) query.set("operacion", operation);
    const n = ++seq.current;
    inflight.current?.abort();
    const ctrl = new AbortController();
    inflight.current = ctrl;
    try {
      const data = await api<{ items: PanelProperty[]; total: number }>(`/api/panel/propiedades?${query}`, { signal: ctrl.signal });
      if (n !== seq.current) return;
      setResult(data);
      setError("");
    } catch (e) {
      if (n !== seq.current || ctrl.signal.aborted) return;
      setError(message(e, "No pudimos cargar tus propiedades."));
    }
  }, [page, q, status, operation]);
  useEffect(() => {
    void load();
    return () => inflight.current?.abort();
  }, [load]);
  // The search box follows the URL (back/forward, links), unless it is what was just typed.
  const sent = useRef(q);
  useEffect(() => {
    if (q !== sent.current) {
      sent.current = q;
      setText(q);
    }
  }, [q]);
  // Typing filters after a short pause, without one request per key.
  useEffect(() => {
    if (text.trim() === q) return;
    const t = setTimeout(() => {
      sent.current = text.trim();
      setParams({ q: text.trim() });
    }, 350);
    return () => clearTimeout(t);
  }, [text, q, setParams]);
  // While versions are being created, the list refreshes on its own.
  const active = result?.items.some((p) => p.versions.active > 0) ?? false;
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void load(), 15000);
    return () => clearInterval(t);
  }, [active, load]);
  const refresh = async () => {
    await Promise.all([load(), reload()]);
  };
  const pages = result ? Math.max(1, Math.ceil(result.total / PER_PAGE)) : 1;
  const backHere = `${pathname}${params.toString() ? `?${params}` : ""}`;
  return (
    <>
      <div className="ap-head">
        <div>
          <span className="eyebrow">{data.agency.name}</span>
          <h1>Mis propiedades</h1>
        </div>
        {canCreate(data) && (
          <button type="button" className="button button-primary" aria-expanded={adding} onClick={() => setAdding((a) => !a)}>
            + Agregar propiedad
          </button>
        )}
      </div>
      {adding && (
        <section className="ap-import-hero">
          <ImportProperty onDone={refresh} />
        </section>
      )}
      <div className="ap-filters" role="search">
        <label className="ap-search">
          <Search size={16} aria-hidden="true" />
          <input type="search" placeholder="Buscar por título o ubicación" aria-label="Buscar propiedades" value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <select aria-label="Estado" value={status} onChange={(e) => setParams({ estado: e.target.value })}>
          <option value="">Todos los estados</option>
          <option value="published">Publicadas</option>
          <option value="draft">Borradores</option>
        </select>
        {data.counts.operations.length > 1 && (
          <select aria-label="Operación" value={operation} onChange={(e) => setParams({ operacion: e.target.value })}>
            <option value="">Todas las operaciones</option>
            {data.counts.operations.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        )}
        <div className="ap-view" role="group" aria-label="Vista">
          <button type="button" aria-pressed={view === "tarjetas"} onClick={() => setParams({ vista: "tarjetas" })} title="Tarjetas">
            <LayoutGrid size={16} aria-hidden="true" />
            <span className="dv2-sr">Tarjetas</span>
          </button>
          <button type="button" aria-pressed={view === "tabla"} onClick={() => setParams({ vista: "tabla" })} title="Tabla">
            <LayoutList size={16} aria-hidden="true" />
            <span className="dv2-sr">Tabla</span>
          </button>
        </div>
      </div>
      {error && <RetryRow error={error} onRetry={() => void load()} />}
      {!result ? (
        !error && <p role="status">Cargando propiedades…</p>
      ) : result.items.length ? (
        <>
          <p className="ap-count" role="status">
            {result.total} {result.total === 1 ? "propiedad" : "propiedades"}
            {q || status || operation ? " con estos filtros" : ""}
          </p>
          {view === "tabla" ? (
            <PropertyTable items={result.items} agency={data.agency} reload={refresh} canDelete={canManage(data.role)} canPublish={canEdit(data.role)} backTo={backHere} />
          ) : (
            <div className="ap-grid">
              {result.items.map((p) => (
                <PropertyCard key={p.id} property={p} agency={data.agency} reload={refresh} canDelete={canManage(data.role)} canPublish={canEdit(data.role)} backTo={backHere} />
              ))}
            </div>
          )}
          {pages > 1 && (
            <nav className="ap-pages" aria-label="Páginas">
              <button type="button" className="button button-small button-outline" disabled={page <= 1} onClick={() => setParams({ pagina: String(page - 1) })}>
                Anterior
              </button>
              <span>
                Página {page} de {pages}
              </span>
              <button type="button" className="button button-small button-outline" disabled={page >= pages} onClick={() => setParams({ pagina: String(page + 1) })}>
                Siguiente
              </button>
            </nav>
          )}
        </>
      ) : (
        <p className="ap-empty">
          {data.counts.total ? "Ninguna propiedad coincide con la búsqueda." : data.scope ? "Todavía no te asignaron propiedades." : "Todavía no cargaste propiedades."}
        </p>
      )}
    </>
  );
}

type Note = { text: string; link?: string; error?: boolean } | null;

/** The editor at one section, with the way back to this exact list (filters, page, view). */
const editorLink = (id: string, section: "fotos" | "publicacion" | "datos", backTo: string) =>
  `/panel/propiedades/${id}?${new URLSearchParams({ seccion: section, volver: backTo })}`;

/** Photos, spaces and versions by their real state (ready is "created", never "approved"). */
function ProgressLine({ p }: { p: PanelProperty }) {
  return (
    <>
      {p.photos} {p.photos === 1 ? "foto" : "fotos"}
      {p.spaces ? ` · ${p.spaces} ${p.spaces === 1 ? "espacio" : "espacios"}` : ""} · <Sparkles size={13} aria-hidden="true" /> {p.versions.ready}{" "}
      {p.versions.ready === 1 ? "versión lista" : "versiones listas"}
      {p.versions.active ? ` · ${p.versions.active} en curso` : ""}
      {p.versions.issues ? <span className="ap-issue"> · {p.versions.issues} con problemas</span> : null}
    </>
  );
}

/** Publish/unpublish, share and delete of one property, with outcomes that match the server's. */
function usePropertyActions(p: PanelProperty, agency: PanelSummary["agency"], reload: () => Promise<unknown>) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const live = p.status === "published";
  const link = typeof window === "undefined" ? "" : propertyLink(window.location.origin, p, agency);
  async function publish() {
    setBusy(true);
    setNote(null);
    try {
      await api(`/api/admin/demos/${p.id}`, { method: "PATCH", body: JSON.stringify({ action: live ? "unpublish" : "publish" }) });
      // Counted only after the server confirmed it.
      track(live ? "property_unpublished" : "property_published", { property_id: p.id, photos: p.photos, staged: p.staged });
      setNote({ text: live ? "Ficha despublicada: su enlace dejó de funcionar." : "Ficha publicada. Ya podés compartirla." });
      await reload();
    } catch (e) {
      track("property_publish_failed", { property_id: p.id });
      setNote({ text: message(e, "No pudimos cambiar la publicación."), error: true });
    } finally {
      setBusy(false);
    }
  }
  async function share() {
    const outcome = await shareLink(link, p.title, p.id);
    if (outcome === "copied") setNote({ text: "Enlace copiado." });
    else if (outcome === "failed") setNote({ text: "No pudimos copiar el enlace. Copialo desde acá:", link, error: true });
    else setNote(null);
  }
  async function remove() {
    if (!window.confirm(`¿Eliminar "${p.title}"? Se borran sus fotos y sus imágenes con IA, y su enlace deja de funcionar. No se puede deshacer.`)) return;
    setBusy(true);
    try {
      await api(`/api/admin/demos/${p.id}`, { method: "DELETE" });
      await reload();
    } catch (e) {
      setNote({ text: message(e, "No pudimos eliminarla."), error: true });
      setBusy(false);
    }
  }
  return { busy, note, live, link, publish, share, remove };
}

function ActionNote({ note }: { note: Note }) {
  if (!note) return null;
  return (
    <p className={`ap-card-message ${note.error ? "ap-error-text" : ""}`} role={note.error ? "alert" : "status"}>
      {note.text}
      {note.link && <input className="dm-link" readOnly value={note.link} onFocus={(e) => e.target.select()} aria-label="Enlace de la ficha" />}
    </p>
  );
}

/** The secondary actions of a property, in an accessible menu (details/summary). */
function MoreMenu({
  p,
  actions,
  canDelete,
  canPublish,
  backTo,
}: {
  p: PanelProperty;
  actions: ReturnType<typeof usePropertyActions>;
  canDelete: boolean;
  canPublish: boolean;
  backTo: string;
}) {
  return (
    <details className="ap-menu">
      <summary aria-label={`Más acciones de ${p.title}`}>
        <MoreHorizontal size={16} aria-hidden="true" /> Más
      </summary>
      <div className="ap-menu-list">
        <Link href={editorLink(p.id, "fotos", backTo)}>
          <Sparkles size={14} aria-hidden="true" /> Fotos y espacios
        </Link>
        {canPublish && <Link href={editorLink(p.id, "datos", backTo)}>Editar datos</Link>}
        {actions.live ? (
          <a href={actions.link} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={14} aria-hidden="true" /> Ver ficha
          </a>
        ) : (
          <Link href={`/panel/propiedades/${p.id}/vista-previa`}>
            <ExternalLink size={14} aria-hidden="true" /> Vista previa
          </Link>
        )}
        {canPublish && (
          <button type="button" disabled={actions.busy} onClick={() => void actions.publish()}>
            {actions.live ? "Despublicar ficha" : "Publicar ficha"}
          </button>
        )}
        {canDelete && (
          <button type="button" className="ap-danger" disabled={actions.busy} onClick={() => void actions.remove()}>
            Eliminar
          </button>
        )}
      </div>
    </details>
  );
}

function PropertyCard({
  property: p,
  agency,
  reload,
  canDelete,
  canPublish,
  backTo,
}: {
  property: PanelProperty;
  agency: PanelSummary["agency"];
  reload: () => Promise<unknown>;
  canDelete: boolean;
  canPublish: boolean;
  backTo: string;
}) {
  const actions = usePropertyActions(p, agency, reload);
  const next = nextAction(p);
  return (
    <article className="ap-card">
      <Link href={editorLink(p.id, "fotos", backTo)} className="ap-card-photo" aria-label={`Fotos y espacios de ${p.title}`}>
        {p.coverPhotoId ? <img src={adminPhotoUrl(p.coverPhotoId, null, 480)} alt="" loading="lazy" /> : <span>Sin fotos</span>}
        <span className={`ap-badge ${actions.live ? "is-live" : ""}`}>{actions.live ? "Publicada" : "Borrador"}</span>
      </Link>
      <div className="ap-card-body">
        <h3>
          <Link href={editorLink(p.id, "fotos", backTo)}>{p.title}</Link>
        </h3>
        {(p.location || p.reference) && (
          <p className="ap-card-location">
            {p.location}
            {p.reference ? `${p.location ? " · " : ""}Ref. ${p.reference}` : ""}
          </p>
        )}
        <p className="ap-card-price">
          {p.operation && <span className="ap-chip">{p.operation}</span>}
          {p.price ?? "Precio a consultar"}
        </p>
        <p className="ap-card-meta">
          <ProgressLine p={p} />
        </p>
        <div className="ap-card-actions">
          {next.label === "Compartir" ? (
            <button type="button" className="button button-small button-primary" onClick={() => void actions.share()}>
              <Share2 size={14} aria-hidden="true" /> Compartir
            </button>
          ) : (
            <Link href={editorLink(p.id, next.section, backTo)} className="button button-small button-primary">
              {next.label}
            </Link>
          )}
          <MoreMenu p={p} actions={actions} canDelete={canDelete} canPublish={canPublish} backTo={backTo} />
        </div>
        <ActionNote note={actions.note} />
      </div>
    </article>
  );
}

function PropertyTable({
  items,
  agency,
  reload,
  canDelete,
  canPublish,
  backTo,
}: {
  items: PanelProperty[];
  agency: PanelSummary["agency"];
  reload: () => Promise<unknown>;
  canDelete: boolean;
  canPublish: boolean;
  backTo: string;
}) {
  return (
    <div className="ap-table-wrap">
      <table className="ap-table">
        <thead>
          <tr>
            <th scope="col">
              <span className="dv2-sr">Portada</span>
            </th>
            <th scope="col">Propiedad</th>
            <th scope="col">Fotos y versiones</th>
            <th scope="col">Estado</th>
            <th scope="col">
              <span className="dv2-sr">Acciones</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((p) => (
            <PropertyRow key={p.id} p={p} agency={agency} reload={reload} canDelete={canDelete} canPublish={canPublish} backTo={backTo} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PropertyRow({
  p,
  agency,
  reload,
  canDelete,
  canPublish,
  backTo,
}: {
  p: PanelProperty;
  agency: PanelSummary["agency"];
  reload: () => Promise<unknown>;
  canDelete: boolean;
  canPublish: boolean;
  backTo: string;
}) {
  const actions = usePropertyActions(p, agency, reload);
  const next = nextAction(p);
  return (
    <tr>
      <td className="ap-table-cover">
        {p.coverPhotoId ? <img src={adminPhotoUrl(p.coverPhotoId, null, 480)} alt="" loading="lazy" /> : <span>—</span>}
      </td>
      <th scope="row">
        <Link href={editorLink(p.id, "fotos", backTo)}>{p.title}</Link>
        <small>
          {[p.location, p.reference ? `Ref. ${p.reference}` : null, p.operation, p.price].filter(Boolean).join(" · ") || "Sin datos"}
        </small>
        <ActionNote note={actions.note} />
      </th>
      <td>
        <ProgressLine p={p} />
      </td>
      <td>
        <span className={`ap-badge ${actions.live ? "is-live" : ""}`}>{actions.live ? "Publicada" : "Borrador"}</span>
      </td>
      <td className="ap-table-actions">
        {next.label === "Compartir" ? (
          <button type="button" className="button button-small" onClick={() => void actions.share()}>
            Compartir
          </button>
        ) : (
          <Link href={editorLink(p.id, next.section, backTo)} className="button button-small">
            {next.label}
          </Link>
        )}
        <MoreMenu p={p} actions={actions} canDelete={canDelete} canPublish={canPublish} backTo={backTo} />
      </td>
    </tr>
  );
}

type Preview = ImportedDemo & { listingUrl: string; duplicateOf: string | null; snapshot: string };
type Created = {
  importId: string;
  id: string | null;
  title?: string;
  status: string;
  settingsSaved: boolean;
  photosTotal: number;
  photosDone: number;
  images: string[];
};

/** Downloads the photos of a created import and reports them: what it says is what happened. */
async function finishPhotos(made: Created, onStatus: (t: string) => void, endpoint = "/api/panel/importar") {
  if (!made.id) return made;
  const sync = await syncPhotos(`/api/admin/demos/${made.id}`, made.images, onStatus);
  return api<Created>(endpoint, {
    method: "PATCH",
    body: JSON.stringify({ importId: made.importId, done: sync.done, failed: sync.failedUrls }),
  });
}

const hostOf = (url: string) => {
  try {
    return new URL(/^https?:/i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return "invalida";
  }
};

/**
 * Paste a listing URL → its data is read (nothing is asked that was found)
 * → every field can be corrected, each photo kept or left out, the map
 * confirmed → the property is created once (a request key), as a draft,
 * and its photos imported; the result says if anything is missing. No
 * staging starts and no credit is used.
 */
export function ImportProperty({
  initialUrl = "",
  onDone,
  endpoint = "/api/panel/importar",
  openPath = (id: string) => `/panel/propiedades/${id}`,
  allowMany = true,
  where = "tu panel",
  onStep,
}: {
  initialUrl?: string;
  onDone?: () => Promise<unknown>;
  /** Where the import goes: the agency's own panel, or the agency the team is editing. */
  endpoint?: string;
  openPath?: (id: string) => string;
  allowMany?: boolean;
  /** "tu panel" or "esta inmobiliaria", for the duplicate notice. */
  where?: string;
  /** 1: bring the listing, 2: review its data and photos, 3: saving the draft. */
  onStep?: (step: 1 | 2 | 3) => void;
}) {
  const router = useRouter();
  const [many, setMany] = useState(false);
  const [url, setUrl] = useState(initialUrl);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [fields, setFields] = useState({ title: "", location: "", price: "", operation: "", description: "" });
  const [keep, setKeep] = useState<Set<string>>(new Set());
  const [mapChoice, setMapChoice] = useState<MapChoice | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [partial, setPartial] = useState<Created | null>(null);
  // One key per confirmed preview: sending it twice creates one property.
  const key = useRef("");
  const busy = Boolean(status);
  const step: 1 | 2 | 3 = preview && busy ? 3 : preview ? 2 : 1;
  useEffect(() => onStep?.(step), [onStep, step]);

  const show = (data: Preview) => {
    setPreview(data);
    setFields({
      title: data.title,
      location: data.location ?? "",
      price: data.priceConflict ? "" : (data.price ?? ""),
      operation: data.operation ?? "",
      description: data.description ?? "",
    });
    setKeep(new Set(data.images));
    setMapChoice(initialMapChoice(data));
    key.current = crypto.randomUUID();
  };

  async function read(e?: React.FormEvent) {
    e?.preventDefault();
    setError("");
    setNotice("");
    setPartial(null);
    setPreview(null);
    setStatus("Leyendo la publicación…");
    track("property_import_started", { source: hostOf(url), mode: "single" });
    track("listing_import_preview_started", { source: hostOf(url), mode: "single" });
    leadFromDemoRef("demo_property_import_started");
    trackMilestone("first_import_started", { source: hostOf(url), mode: "single" });
    const started = Date.now();
    try {
      const data = await api<Preview>(endpoint, { method: "POST", body: JSON.stringify({ url, preview: true }) });
      show(data);
      track("listing_import_preview_completed", importEventProps(data.diagnostics, { source: hostOf(url), mode: "single", client_ms: Date.now() - started, duplicate: Boolean(data.duplicateOf) }));
    } catch (err) {
      setError(message(err, "No pudimos leer la publicación."));
      track("property_import_failed", { source: hostOf(url), status: "preview" });
      const api_ = err instanceof ApiError ? err : null;
      track("listing_import_preview_failed", { source: hostOf(url), mode: "single", error_code: importErrorCode(api_?.status, api_?.body), client_ms: Date.now() - started });
    } finally {
      setStatus("");
    }
  }

  async function create() {
    if (!preview) return;
    setError("");
    setNotice("");
    setStatus("Creando la propiedad…");
    track("listing_import_confirmed", importEventProps(preview.diagnostics, { source: hostOf(preview.listingUrl), mode: "single", photos_kept: keep.size }));
    let made: Created;
    try {
      made = await api<Created>(endpoint, {
        method: "POST",
        body: JSON.stringify({
          url: preview.listingUrl,
          key: key.current,
          snapshot: preview.snapshot,
          overrides: { ...fields, map: mapChoice ? mapOverride(preview, mapChoice) : undefined },
          images: preview.images.filter((src) => keep.has(src)),
        }),
      });
    } catch (err) {
      const body = err instanceof ApiError ? err.body : null;
      if (body?.changed && body.preview) {
        show(body.preview as Preview);
        setNotice("La publicación cambió desde que la revisaste: estos son los datos actuales. Revisalos y volvé a confirmar.");
      } else if (body?.duplicateOf) {
        setPreview({ ...preview, duplicateOf: String(body.duplicateOf) });
      } else setError(message(err, "No pudimos crear la propiedad."));
      track("property_import_failed", { source: hostOf(preview.listingUrl), status: "create" });
      track("listing_import_failed", importEventProps(preview.diagnostics, { source: hostOf(preview.listingUrl), mode: "single", stage: "create", error_code: importErrorCode(err instanceof ApiError ? err.status : undefined, err instanceof ApiError ? err.body : null) }));
      setStatus("");
      return;
    }
    try {
      const done = await finishPhotos(made, (t) => setStatus(`${made.title ?? "Propiedad"}. ${t}`), endpoint);
      track("property_import_completed", { source: hostOf(preview.listingUrl), photos: done.photosDone, mode: "single", status: done.status });
      track(done.status === "completed" ? "listing_import_completed" : "listing_import_partial", importEventProps(preview.diagnostics, { source: hostOf(preview.listingUrl), mode: "single", photos_done: done.photosDone, photos_total: done.photosTotal }));
      if (done.photosDone > 0) leadFromDemoRef("demo_property_import_completed");
      trackMilestone("first_import_completed", { source: hostOf(preview.listingUrl), photos: done.photosDone, mode: "single", status: done.status });
      await onDone?.();
      if (done.status === "completed") {
        router.push(openPath(made.id!));
        return;
      }
      setPartial(done);
      setPreview(null);
    } catch (err) {
      // The property exists: the panel's home lists what is missing.
      setError(`${message(err, "No pudimos terminar de importar las fotos.")} La propiedad quedó como borrador; podés reintentar desde el inicio.`);
    } finally {
      setStatus("");
    }
  }

  async function retryPartial() {
    if (!partial) return;
    setStatus("Reintentando fotos…");
    try {
      const done = await finishPhotos(partial, setStatus, endpoint);
      if (done.status === "completed") router.push(openPath(partial.id!));
      else setPartial(done);
    } catch (err) {
      setError(message(err, "No pudimos reintentar."));
    } finally {
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
        <p className="ap-import-help">Importar y publicar no usan créditos. Ambientar con IA es opcional.</p>
        {allowMany && (
          <button type="button" className="text-link ap-many-link" {...cta("import_many_urls", "import_form", "property_import_many")} onClick={() => setMany(true)}>
            <Link2 size={14} aria-hidden="true" /> Tengo varias URLs
          </button>
        )}
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
      {partial && (
        <div className="ap-import-result" role="status">
          <p>
            <strong>Importada parcialmente:</strong> {partial.photosDone} de {partial.photosTotal} fotos
            {partial.settingsSaved ? "" : ", y faltan los datos de la ficha"}. La propiedad quedó como borrador.
          </p>
          <div className="ap-card-actions">
            <Link href={`${openPath(partial.id!)}${partial.settingsSaved ? "" : `${openPath(partial.id!).includes("?") ? "&" : "?"}completar=1`}`} className="button button-small button-primary">
              Abrir la propiedad
            </Link>
            {partial.images.length > 0 && (
              <button type="button" className="button button-small" disabled={busy} onClick={() => void retryPartial()}>
                Reintentar {partial.images.length} {partial.images.length === 1 ? "foto" : "fotos"}
              </button>
            )}
          </div>
        </div>
      )}
      {preview && (
        <div className="ap-import-result">
          {notice && (
            <p className="inline-notice" role="status">
              {notice}
            </p>
          )}
          {preview.duplicateOf ? (
            <p className="inline-notice">
              Esta propiedad ya está en {where}. <Link href={openPath(preview.duplicateOf)}>Abrirla</Link>
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
          {mapChoice && <MapReview data={preview} value={mapChoice} onChange={setMapChoice} />}
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

const MAX_BATCH = 10;
type Row = {
  url: string;
  state: "waiting" | "reading" | "ready" | "duplicate" | "error" | "importing" | "done" | "partial";
  data?: Preview;
  error?: string;
  pick: boolean;
  key: string;
  result?: Created;
};

/** Up to 10 listings: read one by one, reviewed, then imported one by one, each saying what it got. */
function ImportMany({ onDone, onSingle }: { onDone?: () => Promise<unknown>; onSingle: () => void }) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const update = (i: number, patch: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const urls = [...new Set(text.split(/\s+/).map((u) => u.trim()).filter(Boolean))];

  async function readAll() {
    const list: Row[] = urls.slice(0, MAX_BATCH).map((url) => ({ url, state: "waiting", pick: true, key: crypto.randomUUID() }));
    setRows(list);
    setRunning(true);
    for (const [i, row] of list.entries()) {
      update(i, { state: "reading" });
      track("property_import_started", { source: hostOf(row.url), mode: "batch" });
      leadFromDemoRef("demo_property_import_started");
      trackMilestone("first_import_started", { source: hostOf(row.url), mode: "batch" });
      try {
        const data = await api<Preview>("/api/panel/importar", { method: "POST", body: JSON.stringify({ url: row.url, preview: true }) });
        update(i, { state: data.duplicateOf ? "duplicate" : "ready", data, pick: !data.duplicateOf });
        track("listing_import_preview_completed", importEventProps(data.diagnostics, { source: hostOf(row.url), mode: "batch", duplicate: Boolean(data.duplicateOf) }));
      } catch (e) {
        update(i, { state: "error", error: message(e, "No pudimos leerla."), pick: false });
        track("property_import_failed", { source: hostOf(row.url), status: "preview", mode: "batch" });
        track("listing_import_preview_failed", { source: hostOf(row.url), mode: "batch", error_code: importErrorCode(e instanceof ApiError ? e.status : undefined, e instanceof ApiError ? e.body : null) });
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
        // A doubtful map is not saved without a person looking at it.
        const made = await api<Created>("/api/panel/importar", {
          method: "POST",
          body: JSON.stringify({ url: row.data.listingUrl, key: row.key, snapshot: row.data.snapshot }),
        });
        const done = await finishPhotos(made, () => null);
        update(i, { state: done.status === "completed" ? "done" : "partial", result: done });
        track("property_import_completed", { source: hostOf(row.url), photos: done.photosDone, mode: "batch", status: done.status });
        track(done.status === "completed" ? "listing_import_completed" : "listing_import_partial", importEventProps(row.data.diagnostics, { source: hostOf(row.url), mode: "batch", photos_done: done.photosDone, photos_total: done.photosTotal }));
        if (done.photosDone > 0) leadFromDemoRef("demo_property_import_completed");
        trackMilestone("first_import_completed", { source: hostOf(row.url), photos: done.photosDone, mode: "batch", status: done.status });
      } catch (e) {
        update(i, { state: "error", error: message(e, "No pudimos importarla.") });
        track("property_import_failed", { source: hostOf(row.url), status: "create", mode: "batch" });
        track("listing_import_failed", importEventProps(row.data.diagnostics, { source: hostOf(row.url), mode: "batch", stage: "create", error_code: importErrorCode(e instanceof ApiError ? e.status : undefined, e instanceof ApiError ? e.body : null) }));
      }
    }
    setRunning(false);
    await onDone?.();
  }

  const label = (r: Row) =>
    ({
      waiting: "En espera",
      reading: "Leyendo…",
      ready: "Lista",
      duplicate: "Ya está en tu panel",
      error: "Con error",
      importing: "Importando…",
      done: `Importada: ${r.result?.photosDone ?? 0} fotos`,
      partial: `Importada parcialmente: ${r.result?.photosDone ?? 0} de ${r.result?.photosTotal ?? 0} fotos`,
    })[r.state];
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
                    {label(r)}
                    {r.data && r.state === "ready" ? ` · ${r.data.images.length} fotos · ${r.data.price ?? "sin precio"}` : ""}
                    {r.data && r.state === "ready" && r.data.mapStatus === "review" ? " · mapa para revisar después" : ""}
                    {r.error ? ` · ${r.error}` : ""}
                  </small>
                  {r.result?.id && (
                    <Link href={`/panel/propiedades/${r.result.id}`} className="text-link">
                      Abrir
                    </Link>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {/* Once everything readable was imported, nothing is left to import. */}
          {(running || rows.some((r) => r.state === "ready")) && (
            <button
              type="button"
              className="button button-primary"
              disabled={running || !rows.some((r) => r.pick && r.state === "ready")}
              onClick={() => void importPicked()}
            >
              Importar {rows.filter((r) => r.pick && r.state === "ready").length} como borradores
            </button>
          )}
        </>
      )}
    </div>
  );
}

type CreditsInfo = {
  role: AgencyRole;
  /** The team in the agency's panel: it never buys for the agency. */
  support?: boolean;
  payer: { agency: string; isYou: boolean };
  credits: number | null;
  creditsError: boolean;
  grants?: { id: string; remaining: number; total: number; expires_at: string | null; source_key: string; revoked: boolean }[];
  ledger?: { delta: number; reason: string; created_at: string }[];
};
const REASONS: Record<string, string> = {
  photo_reserved: "Foto ambientada",
  technical_failure: "Devolución por falla técnica",
  payment: "Compra",
  annual_period: "Plan anual",
  // Welcome credits and the team's grants share this reason.
  admin_adjustment: "Créditos de habita",
  trial: "Prueba",
};

/** The agency's credits: one balance, its owner's; the owner manages plans and purchases. */
function CreditsSection() {
  const [info, setInfo] = useState<CreditsInfo | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setInfo(await api<CreditsInfo>("/api/panel/creditos"));
      setError("");
    } catch (e) {
      setError(message(e, "No pudimos consultar los créditos."));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  if (!info) return error ? <RetryRow error={error} onRetry={() => void load()} /> : <p role="status">Cargando créditos…</p>;
  const owner = info.role === "owner";
  const grants = (info.grants ?? []).filter((g) => !g.revoked);
  return (
    <>
      <div className="ap-head">
        <div>
          <span className="eyebrow">Créditos IA de {info.payer.agency}</span>
          <h1>{info.credits === null ? "Saldo no disponible" : `${info.credits} ${info.credits === 1 ? "crédito disponible" : "créditos disponibles"}`}</h1>
        </div>
        {owner && !info.support && (
          <Link href="/precios" className="button button-primary" {...cta("buy_credits", "panel_credits", "pricing")}>
            Comprar créditos
          </Link>
        )}
      </div>
      {info.creditsError && <RetryRow error="No pudimos consultar el saldo ahora. No significa que no tengas créditos." onRetry={() => void load()} />}
      <section className="account-panel">
        <h2>Quién paga</h2>
        <p>
          Las ambientaciones de las propiedades de {info.payer.agency} usan un solo saldo: el de la cuenta dueña de la inmobiliaria
          {info.payer.isYou ? " (tu cuenta)" : ""}.{" "}
          {owner ? "Lo que compres con esta cuenta suma a ese saldo." : "Para sumar créditos, pedíselo al dueño de la inmobiliaria."}
        </p>
      </section>
      <section className="account-panel">
        <h2>Cómo se usan</h2>
        <p>
          Cada foto que transformás con IA usa 1 crédito la primera vez. Las demás versiones y estilos de esa misma foto no consumen créditos
          mientras el plan esté vigente. Si una generación falla por un problema técnico, el crédito vuelve solo. Importar propiedades,
          publicarlas y compartirlas no usa créditos.
        </p>
      </section>
      {owner && (
        <section className="account-panel">
          <h2>Planes y movimientos</h2>
          {grants.length ? (
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
          ) : (
            <p>Todavía no hay planes ni packs. Elegí uno para transformar las fotos de tus propiedades.</p>
          )}
          {info.ledger && info.ledger.length > 0 && (
            <ul className="ap-grants" aria-label="Últimos movimientos">
              {info.ledger.map((l, i) => (
                <li key={i}>
                  <span>
                    {REASONS[l.reason] ?? l.reason}: {l.delta > 0 ? `+${l.delta}` : l.delta}
                  </span>
                  <small>{new Date(l.created_at).toLocaleDateString("es-AR")}</small>
                </li>
              ))}
            </ul>
          )}
          <Link href="/cuenta" className="text-link">
            Ver pagos y suscripciones
          </Link>
        </section>
      )}
    </>
  );
}

const CONTACT_KINDS = [
  ["whatsapp", "WhatsApp"],
  ["phone", "Teléfono"],
  ["email", "Email"],
  ["url", "Formulario o página de contacto"],
] as const;
type ContactKind = (typeof CONTACT_KINDS)[number][0];

/** "Mi sitio web": identity, contact, color, logo and whether the catalog is public. Saves only what changed. */
function SiteSection({ data, setData, reload }: { data: PanelSummary; setData: (d: PanelSummary) => void; reload: () => Promise<unknown> }) {
  const a = data.agency;
  const initial = {
    name: a.name,
    slug: a.slug ?? "",
    website: a.website ?? "",
    contactKind: (a.contactKind ?? "whatsapp") as ContactKind,
    contactValue: a.contactValue ?? "",
    primary: a.primary ?? "#24382e",
  };
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const owner = canManage(data.role);
  const changed = (Object.keys(initial) as (keyof typeof initial)[]).filter((k) => form[k] !== initial[k]);
  const dirty = changed.length > 0;
  // Unsaved changes are not lost by leaving the page by accident.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function save(body: Record<string, unknown>, done: string) {
    setSaving(true);
    setError("");
    setStatus("");
    try {
      const next = await api<PanelSummary>("/api/panel", { method: "PATCH", body: JSON.stringify(body) });
      setData(next);
      setStatus(done);
      return next;
    } catch (e) {
      setError(`${message(e, "No pudimos guardar.")} No se cambió nada.`);
      return null;
    } finally {
      setSaving(false);
    }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    if (
      changed.includes("slug") &&
      a.slug &&
      a.sitePublished &&
      !window.confirm("Cambiar la dirección deja sin funcionar los enlaces al catálogo anterior. Los enlaces de cada ficha (/demo/…) siguen funcionando. ¿Continuar?")
    )
      return;
    // Only what changed: a new color never touches the contact.
    const body: Record<string, unknown> = {};
    for (const k of changed) {
      if (k === "contactKind" || k === "contactValue") {
        body.contactKind = form.contactKind;
        body.contactValue = form.contactValue.trim();
      } else body[k] = form[k];
    }
    const next = await save(body, "Cambios guardados.");
    if (next)
      setForm({
        name: next.agency.name,
        slug: next.agency.slug ?? "",
        website: next.agency.website ?? "",
        contactKind: (next.agency.contactKind ?? "whatsapp") as ContactKind,
        contactValue: next.agency.contactValue ?? "",
        primary: next.agency.primary ?? "#24382e",
      });
  }
  const published = data.counts.published;
  return (
    <>
      <div className="ap-head">
        <div>
          <span className="eyebrow">Mi sitio web</span>
          <h1>Tu catálogo en habita</h1>
        </div>
        <SiteLink agency={a} />
      </div>
      {!owner && <p className="inline-notice">Solo el dueño o un administrador de la inmobiliaria pueden cambiar el sitio.</p>}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {status && !dirty && (
        <p className="inline-notice" role="status">
          {status}
        </p>
      )}
      <section className="account-panel ap-site-state">
        <div>
          <h2>{a.sitePublished ? "Tu catálogo está publicado" : "Tu catálogo no está publicado"}</h2>
          <p>
            {a.slug ? agencySitePath(a.slug) : "Elegí la dirección de tu catálogo."} · {published} {published === 1 ? "ficha publicada" : "fichas publicadas"}. El
            catálogo muestra solo las fichas publicadas; cada ficha publicada se puede compartir con su enlace aunque el catálogo no sea público.
          </p>
        </div>
        <button
          type="button"
          className={`button ${a.sitePublished ? "button-outline" : "button-primary"}`}
          disabled={!owner || !a.slug || saving}
          onClick={() => void save({ sitePublished: !a.sitePublished }, a.sitePublished ? "Catálogo despublicado." : "Catálogo publicado.")}
        >
          {a.sitePublished ? "Despublicar catálogo" : "Publicar catálogo"}
        </button>
      </section>
      <form className="account-panel ap-site-form" onSubmit={(e) => void submit(e)}>
        <h2>Marca y contacto</h2>
        <div className="ap-fields">
          <label>
            Nombre comercial
            <input required maxLength={120} disabled={!owner} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label>
            Dirección del catálogo
            <span className="ap-slug">
              <span>/inmobiliaria/</span>
              <input
                required
                maxLength={42}
                pattern="[a-z0-9][a-z0-9\-]{1,40}[a-z0-9]"
                disabled={!owner}
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })}
              />
            </span>
            {form.slug !== initial.slug && a.slug && <small className="ap-warn">Los enlaces al catálogo anterior dejarán de funcionar.</small>}
          </label>
          <label>
            Canal principal de consultas
            <select disabled={!owner} value={form.contactKind} onChange={(e) => setForm({ ...form, contactKind: e.target.value as ContactKind })}>
              {CONTACT_KINDS.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            {CONTACT_KINDS.find(([id]) => id === form.contactKind)?.[1]}
            <input
              inputMode={form.contactKind === "email" ? "email" : form.contactKind === "url" ? "url" : "tel"}
              maxLength={300}
              placeholder={
                form.contactKind === "whatsapp"
                  ? "+54 9 223 555-1234"
                  : form.contactKind === "email"
                    ? "consultas@inmobiliaria.com"
                    : form.contactKind === "url"
                      ? "inmobiliaria.com/contacto"
                      : "0223 555-1234"
              }
              disabled={!owner}
              value={form.contactValue}
              onChange={(e) => setForm({ ...form, contactValue: e.target.value })}
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
        <div className="ap-save-row">
          <button className="button button-primary" disabled={!owner || !dirty || saving}>
            {saving ? "Guardando…" : "Guardar cambios"}
          </button>
          <span className="dm-help" role="status">
            {dirty ? "Hay cambios sin guardar." : "Todo guardado."}
          </span>
        </div>
      </form>
      <section className="account-panel">
        <h2>Logo</h2>
        <div className="dm-logo">
          {a.logo ? <img src={a.logo} alt={`Logo de ${a.name}`} /> : <span className="dm-logo-empty">Sin logo: se muestra el nombre</span>}
          {owner && (
            <div className="dm-logo-actions">
              <label className="button button-small button-outline">
                {a.logo ? "Cambiar logo" : "Subir logo"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  className="dm-hidden-input"
                  disabled={saving}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const body = new FormData();
                    body.set("logo", file);
                    setSaving(true);
                    setError("");
                    await api("/api/panel/logo", { method: "POST", body })
                      .then(() => reload())
                      .then(() => setStatus("Logo guardado."))
                      .catch((err) => setError(message(err, "No pudimos guardar el logo.")))
                      .finally(() => setSaving(false));
                  }}
                />
              </label>
              {a.logo && (
                <button
                  type="button"
                  className="text-link"
                  disabled={saving}
                  onClick={() =>
                    void api("/api/panel/logo", { method: "DELETE" })
                      .then(() => reload())
                      .catch((err) => setError(message(err, "No pudimos quitar el logo.")))
                  }
                >
                  Quitar
                </button>
              )}
            </div>
          )}
        </div>
      </section>
      <section className="account-panel">
        <h2>Fichas en el catálogo</h2>
        <p>
          Publicá o despublicá cada ficha desde «Mis propiedades». Hoy hay {published} {published === 1 ? "ficha publicada" : "fichas publicadas"} de {data.counts.total}.
        </p>
        <Link href="/panel/propiedades?estado=draft" className="text-link">
          Ver borradores
        </Link>
      </section>
    </>
  );
}

/**
 * The first step: create the agency, or take over the demos the team
 * prepared for it with the one-time link it received. A takeover shows the
 * properties received (nothing to import again); a new agency coming from a
 * demo is offered to import that demo's public listing.
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
  demo: { token: string; id: string; agencyId: string; agencyName: string; title: string; listingUrl: string | null } | null;
}) {
  const router = useRouter();
  const [name, setName] = useState(demo?.agencyName ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ kind: "created" | "claimed"; summary: PanelSummary } | null>(null);
  const here = `/panel/empezar${demo || code ? `?${new URLSearchParams({ ...(demo ? { demo: demo.token } : {}), ...(code ? { codigo: code } : {}) })}` : ""}`;
  const origin = demo ? "demo" : "direct";
  // Legacy name kept for the current funnels: it fires when this screen is seen, not when a form is begun.
  useEffect(() => {
    if (!signedIn) track("agency_signup_started", { origin, ...(demo ? { demo_id: demo.id } : {}) });
  }, [signedIn, origin, demo]);
  const flow = !signedIn ? "agency_start" : code ? "agency_claim" : "agency_create";
  const form = useSignupTracking(flow, { origin, has_invite: Boolean(code), ...(demo ? { demo_id: demo.id, agency_id: demo.agencyId } : {}) }, !hasAgency || Boolean(done));

  if (!signedIn)
    return (
      <div className="account-page container ap-start">
        <span className="eyebrow">habita para inmobiliarias</span>
        <h1>{code ? "Quedate con tus demos" : "Creá tu inmobiliaria gratis"}</h1>
        <p>
          {code
            ? "Creá tu cuenta (o entrá) para que las demos que preparamos para tu inmobiliaria pasen a tu panel."
            : "Importá tus propiedades desde sus publicaciones, transformalas con IA y compartí fichas interactivas. Sin tarjeta de crédito."}
        </p>
        <div className="ap-start-actions">
          <Link
            href={`/acceso?modo=registro&next=${encodeURIComponent(here)}`}
            className="button button-primary button-large"
            {...cta("signup_create_account", "agency_start", "auth_signup")}
          >
            Crear mi cuenta
          </Link>
          <Link href={`/acceso?next=${encodeURIComponent(here)}`} className="button button-outline button-large" {...cta("signup_have_account", "agency_start", "auth_login")}>
            Ya tengo cuenta
          </Link>
        </div>
      </div>
    );

  if (hasAgency && !done)
    return (
      <div className="account-page container ap-start">
        <h1>Ya tenés tu inmobiliaria</h1>
        {code && <p>Tu cuenta ya tiene una inmobiliaria, así que ese enlace no se puede usar con ella. Pedile al equipo de habita que lo revise.</p>}
        <Link href="/panel" className="button button-primary" {...cta("go_to_panel", "agency_exists", "panel_home")}>
          Ir a mi panel
        </Link>
      </div>
    );

  async function run(kind: "created" | "claimed") {
    setBusy(true);
    setError("");
    form.submitted();
    try {
      const summary =
        kind === "claimed"
          ? await api<PanelSummary>("/api/panel/reclamar", { method: "POST", body: JSON.stringify({ code }) })
          : await api<PanelSummary>("/api/panel", { method: "POST", body: JSON.stringify({ name }) });
      registerAgency(summary.agency.id);
      track(kind === "claimed" ? "agency_claimed" : "agency_created", { origin, agency_id: summary.agency.id, ...(demo ? { demo_id: demo.id } : {}) }, true);
      // Lead score: the server only takes it once the account belongs to the demo's agency.
      if (kind === "claimed") leadFromDemoRef("demo_account_created");
      if (demo) track("demo_to_agency_signup_completed", { demo_id: demo.id, claimed: kind === "claimed" });
      // Claimed from its own demo: straight into that property, ready for a first try.
      if (kind === "claimed" && demo && summary.agency.id === demo.agencyId) {
        window.location.assign(`/panel/propiedades/${demo.id}?bienvenida=1`);
        return;
      }
      setDone({ kind, summary });
      router.refresh();
    } catch (e) {
      form.failed(e instanceof ApiError ? `api_${e.status}` : "network");
      setError(message(e, kind === "claimed" ? "No pudimos pasar las demos a tu cuenta." : "No pudimos crear tu inmobiliaria."));
    } finally {
      setBusy(false);
    }
  }

  if (done?.kind === "claimed")
    return (
      <div className="account-page container ap-start">
        <span className="eyebrow">Listo</span>
        <h1>Tus demos ya están en tu cuenta</h1>
        <p>
          Recibiste {done.summary.counts.total} {done.summary.counts.total === 1 ? "propiedad" : "propiedades"} con sus fotos y ambientaciones. Desde ahora, las
          nuevas ambientaciones usan los créditos de {done.summary.agency.name}; las que ya estaban no cuestan nada.
        </p>
        <ul className="ap-site-list">
          {done.summary.properties.map((p) => (
            <li key={p.id}>
              <span>{p.title}</span>
              <Link href={`/panel/propiedades/${p.id}`} className="button button-small">
                Abrir
              </Link>
            </li>
          ))}
        </ul>
        <Link href="/panel" className="button button-primary" {...cta("go_to_panel", "agency_claimed", "panel_home")}>
          Ir a mi panel
        </Link>
      </div>
    );

  if (done)
    return (
      <div className="account-page container ap-start">
        <span className="eyebrow">Listo</span>
        <h1>Tu inmobiliaria ya está en habita</h1>
        {demo?.listingUrl ? (
          <>
            <p>Sumá la propiedad de la demo: la leemos de su publicación original.</p>
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
        <Link href="/panel" className="text-link" {...cta("go_to_panel", "agency_created", "panel_home")}>
          Ir a mi panel
        </Link>
      </div>
    );

  return (
    <div className="account-page container ap-start">
      <span className="eyebrow">habita para inmobiliarias</span>
      <h1>{code ? "Quedate con tus demos" : "Creá tu inmobiliaria"}</h1>
      {demo && !code && (
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
            void run("claimed");
          }}
        >
          <p>
            El equipo de habita te envió este enlace para que tus demos, con sus fotos y ambientaciones, pasen a tu cuenta. Tu cuenta va a ser la
            dueña de la inmobiliaria y sus créditos pagarán las ambientaciones nuevas.
          </p>
          <button className="button button-primary" disabled={busy}>
            {busy ? "Un momento…" : "Pasar las demos a mi cuenta"}
          </button>
        </form>
      ) : (
        <form
          className="account-panel ap-start-form"
          onInputCapture={form.onInput}
          onSubmit={(e) => {
            e.preventDefault();
            void run("created");
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
