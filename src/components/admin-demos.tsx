"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Copy,
  Eye,
  ImageIcon,
  MessageCircle,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { ImportFromListing } from "./demo-import";
import {
  adminPhotoUrl,
  demoUrl,
  whatsappShareUrl,
  type AgencyRow,
  type DemoSummary,
} from "@/lib/demos/shared";

/** fetch for the admin API: JSON in and out, the server's message on errors. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const json = typeof init.body === "string";
  const r = await fetch(path, {
    cache: "no-store",
    ...init,
    headers: json ? { "Content-Type": "application/json", ...init.headers } : init.headers,
  });
  const payload = await r.json().catch(() => ({}));
  if (r.status === 401) {
    window.location.assign(`/acceso?next=${encodeURIComponent(window.location.pathname)}`);
    throw new Error("Tu sesión venció. Volvé a ingresar.");
  }
  if (!r.ok) throw new Error(payload.error || "No pudimos completar la operación.");
  return payload as T;
}

/** The buyers' link, or the one for presenting the demo to the agency (it may show the strip). */
export const publicLink = (token: string, presentation = false) =>
  demoUrl(window.location.origin, token, presentation);

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    window.prompt("Copiá el enlace:", text);
    return false;
  }
}

export function StatusChip({ status }: { status: DemoSummary["status"] }) {
  return (
    <span className={`dm-status ${status === "published" ? "is-live" : ""}`}>
      {status === "published" ? "Publicada" : "Borrador"}
    </span>
  );
}

export function ShareButtons({
  demo,
  compact = false,
}: {
  demo: Pick<DemoSummary, "token" | "status" | "agencyName" | "title">;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const live = demo.status === "published";
  return (
    <>
      <button
        type="button"
        className="button button-small button-outline"
        disabled={!live}
        title={live ? undefined : "Publicá la demo para compartirla"}
        onClick={async () => {
          if (await copyText(publicLink(demo.token, true))) {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }
        }}
      >
        {copied ? <Check size={15} /> : <Copy size={15} />}
        {compact ? (copied ? "Copiado" : "Copiar") : copied ? "Enlace copiado" : "Copiar enlace de presentación"}
      </button>
      {live ? (
        <a
          className="button button-small dm-whatsapp"
          href={whatsappShareUrl(publicLink(demo.token, true), publicLink(demo.token), demo.agencyName, demo.title)}
          target="_blank"
          rel="noopener noreferrer"
        >
          <MessageCircle size={15} /> {compact ? "WhatsApp" : "Compartir por WhatsApp"}
        </a>
      ) : (
        <button type="button" className="button button-small" disabled>
          <MessageCircle size={15} /> {compact ? "WhatsApp" : "Compartir por WhatsApp"}
        </button>
      )}
    </>
  );
}

/** How the link will look when pasted in WhatsApp (image, title, description, domain). */
export function LinkPreview({ demo, location }: { demo: DemoSummary; location?: string | null }) {
  const host = typeof window === "undefined" ? "amoblaia.vercel.app" : window.location.host;
  return (
    <div className="dm-link-preview" aria-label="Previsualización del enlace">
      {demo.cover ? (
        <img
          src={adminPhotoUrl(demo.cover.id, demo.cover.version, undefined, true)}
          alt=""
        />
      ) : (
        <div className="dm-link-preview-empty">
          <ImageIcon size={26} aria-hidden="true" /> Sin portada
        </div>
      )}
      <div>
        <strong>
          {demo.title} · {demo.agencyName}
        </strong>
        <p>
          {location ? `${location} · ` : ""}Imaginá cada espacio a tu estilo con {demo.agencyName}.
        </p>
        <span>{host}</span>
      </div>
    </div>
  );
}

export function DemoList() {
  const [demos, setDemos] = useState<DemoSummary[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | DemoSummary["status"]>("all");
  const load = useCallback(async () => {
    const data = await api<{ demos: DemoSummary[] }>("/api/admin/demos");
    setDemos(data.demos);
  }, []);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [load]);
  async function act(demo: DemoSummary, action: "publish" | "unpublish" | "delete") {
    if (
      action === "delete" &&
      !window.confirm(
        `¿Eliminar la demo "${demo.title}" de ${demo.agencyName}? El enlace deja de funcionar y se borran sus fotos. La inmobiliaria se conserva.`,
      )
    )
      return;
    setBusy(demo.id);
    setError("");
    setNotice("");
    try {
      if (action === "delete") await api(`/api/admin/demos/${demo.id}`, { method: "DELETE" });
      else
        await api(`/api/admin/demos/${demo.id}`, {
          method: "PATCH",
          body: JSON.stringify({ action }),
        });
      setNotice(
        action === "delete"
          ? "Demo eliminada."
          : action === "publish"
            ? "Demo publicada. Ya podés copiar el enlace."
            : "Demo despublicada: el enlace dejó de estar disponible.",
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos guardar.");
    } finally {
      setBusy("");
    }
  }
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (demos || []).filter(
      (d) =>
        (status === "all" || d.status === status) &&
        (!q || `${d.agencyName} ${d.propertyTitle} ${d.title}`.toLowerCase().includes(q)),
    );
  }, [demos, query, status]);
  return (
    <div className="account-page container dm-page">
      <div className="dm-heading">
        <div>
          <span className="eyebrow">Operación comercial</span>
          <h1>
            Demos comerciales<span className="accent">.</span>
          </h1>
          <p>
            Galerías con fotos reales de cada inmobiliaria, ambientadas con IA, para enviar por
            WhatsApp. Solo el equipo ve este panel.
          </p>
        </div>
        <Link href="/admin/demos/nueva" className="button button-primary button-large">
          <Plus size={18} /> Crear nueva demo
        </Link>
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="inline-notice" role="status">
          {notice}
        </p>
      )}
      <div className="dm-filters">
        <label className="dm-search">
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            placeholder="Buscar inmobiliaria o propiedad"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Buscar inmobiliaria o propiedad"
          />
        </label>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          aria-label="Filtrar por estado"
        >
          <option value="all">Todas</option>
          <option value="draft">Borradores</option>
          <option value="published">Publicadas</option>
        </select>
      </div>
      {!demos && !error && <p>Cargando demos…</p>}
      {demos && !demos.length && (
        <div className="account-panel dm-empty">
          <h2>Todavía no hay demos</h2>
          <p>Creá la primera: cargás la inmobiliaria, las fotos de una propiedad y las ambientás.</p>
        </div>
      )}
      {demos && demos.length > 0 && !shown.length && <p>No hay demos que coincidan.</p>}
      <ul className="dm-list">
        {shown.map((d) => (
          <li key={d.id} className="dm-row">
            <Link href={`/admin/demos/${d.id}`} className="dm-thumb" aria-label={`Editar ${d.title}`}>
              {d.cover ? (
                <img
                  src={adminPhotoUrl(d.cover.id, d.cover.version, 480)}
                  alt=""
                  loading="lazy"
                />
              ) : (
                <ImageIcon size={24} aria-hidden="true" />
              )}
            </Link>
            <div className="dm-row-main">
              <span className="dm-agency">{d.agencyName}</span>
              <strong>{d.propertyTitle}</strong>
              <span className="dm-meta">
                {d.photos} {d.photos === 1 ? "foto" : "fotos"} · {d.staged}{" "}
                {d.staged === 1 ? "ambientada" : "ambientadas"} · creada el{" "}
                {new Date(d.createdAt).toLocaleDateString("es-AR")}
              </span>
            </div>
            <StatusChip status={d.status} />
            <div className="dm-actions">
              <Link href={`/admin/demos/${d.id}`} className="button button-small button-outline">
                <Pencil size={15} /> Editar
              </Link>
              <Link
                href={`/admin/demos/${d.id}/vista-previa`}
                className="button button-small button-outline"
              >
                <Eye size={15} /> Vista previa
              </Link>
              <ShareButtons demo={d} compact />
              <button
                type="button"
                className="button button-small"
                disabled={busy === d.id}
                onClick={() => act(d, d.status === "published" ? "unpublish" : "publish")}
              >
                {d.status === "published" ? "Despublicar" : "Publicar"}
              </button>
              <button
                type="button"
                className="icon-button dm-danger"
                aria-label={`Eliminar ${d.title}`}
                disabled={busy === d.id}
                onClick={() => act(d, "delete")}
              >
                <Trash2 size={18} />
              </button>
            </div>
          </li>
        ))}
      </ul>
      <p className="dm-footer-link">
        <Link href="/administracion" className="text-link">
          Ir a Administración
        </Link>
      </p>
    </div>
  );
}

const emptyAgency = { name: "", website: "", contact_name: "", notes: "" };
const emptyProperty = { title: "", listing_url: "", location: "", description: "" };

export function AgencyFields({
  value,
  onChange,
}: {
  value: typeof emptyAgency;
  onChange: (v: typeof emptyAgency) => void;
}) {
  const set = (k: keyof typeof emptyAgency) => (e: { target: { value: string } }) =>
    onChange({ ...value, [k]: e.target.value });
  return (
    <div className="dm-fields">
      <label>
        Nombre de la inmobiliaria *
        <input required maxLength={120} value={value.name} onChange={set("name")} />
      </label>
      <label>
        Sitio web <small>(visible: el logo enlaza ahí)</small>
        <input
          maxLength={300}
          inputMode="url"
          placeholder="inmobiliaria.com.ar"
          value={value.website}
          onChange={set("website")}
        />
      </label>
      <label>
        Nombre de contacto
        <input maxLength={120} value={value.contact_name} onChange={set("contact_name")} />
      </label>
      <label className="dm-wide">
        Notas internas <small>(nunca se muestran en la demo)</small>
        <textarea rows={3} maxLength={4000} value={value.notes} onChange={set("notes")} />
      </label>
    </div>
  );
}

export function PropertyFields({
  value,
  onChange,
}: {
  value: typeof emptyProperty;
  onChange: (v: typeof emptyProperty) => void;
}) {
  const set = (k: keyof typeof emptyProperty) => (e: { target: { value: string } }) =>
    onChange({ ...value, [k]: e.target.value });
  return (
    <div className="dm-fields">
      <label>
        Título de la propiedad *
        <input
          required
          maxLength={160}
          placeholder="Departamento de 3 ambientes con balcón"
          value={value.title}
          onChange={set("title")}
        />
      </label>
      <label>
        Ubicación o barrio <small>(visible)</small>
        <input maxLength={160} placeholder="Palermo, CABA" value={value.location} onChange={set("location")} />
      </label>
      <label className="dm-wide">
        URL de la publicación original <small>(visible: «Ver publicación original»)</small>
        <input
          maxLength={500}
          inputMode="url"
          placeholder="https://…"
          value={value.listing_url}
          onChange={set("listing_url")}
        />
      </label>
      <label className="dm-wide">
        Descripción breve <small>(visible en la demo)</small>
        <textarea rows={3} maxLength={1000} value={value.description} onChange={set("description")} />
      </label>
    </div>
  );
}

/**
 * Creates the demo from the listing URL alone: the server reads the page and
 * returns the photos found, imported here one by one so progress is visible
 * and the order of the listing is kept.
 */
export function NewDemoForm() {
  const router = useRouter();
  const [agencies, setAgencies] = useState<AgencyRow[] | null>(null);
  const [mode, setMode] = useState<"existing" | "new">("new");
  const [agencyId, setAgencyId] = useState("");
  const [agency, setAgency] = useState(emptyAgency);
  const [property, setProperty] = useState(emptyProperty);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ agencies: AgencyRow[] }>("/api/admin/demos")
      .then((d) => {
        setAgencies(d.agencies);
        if (d.agencies.length) setMode("existing");
      })
      .catch((e) => setError(e.message));
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { id } = await api<{ id: string }>("/api/admin/demos", {
        method: "POST",
        body: JSON.stringify(
          mode === "existing" ? { agencyId, property } : { agency, property },
        ),
      });
      router.push(`/admin/demos/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos crear la demo.");
      setBusy(false);
    }
  }
  return (
    <div className="account-page container dm-page dm-narrow">
      <Link href="/admin/demos" className="text-link">
        ← Demos comerciales
      </Link>
      <h1>
        Nueva demo<span className="accent">.</span>
      </h1>
      <p>Pegá la URL de la ficha y la armamos sola, o cargá los datos a mano.</p>
      <ImportFromListing />
      <h2 className="dm-or">O a mano</h2>
      <p className="dm-help">Primero la inmobiliaria y la propiedad. Las fotos se cargan en el paso siguiente.</p>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <form onSubmit={submit}>
        <section className="account-panel">
          <h2>Inmobiliaria</h2>
          {agencies && agencies.length > 0 && (
            <div className="dm-choice" role="radiogroup" aria-label="Inmobiliaria">
              <label>
                <input
                  type="radio"
                  name="agency-mode"
                  checked={mode === "existing"}
                  onChange={() => setMode("existing")}
                />
                Una que ya cargamos
              </label>
              <label>
                <input
                  type="radio"
                  name="agency-mode"
                  checked={mode === "new"}
                  onChange={() => setMode("new")}
                />
                Nueva inmobiliaria
              </label>
            </div>
          )}
          {mode === "existing" && agencies?.length ? (
            <label className="dm-select">
              Elegí la inmobiliaria
              <select required value={agencyId} onChange={(e) => setAgencyId(e.target.value)}>
                <option value="">Elegir…</option>
                {agencies.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <AgencyFields value={agency} onChange={setAgency} />
          )}
          <p className="dm-help">No necesita tener una cuenta en habita.</p>
        </section>
        <section className="account-panel">
          <h2>Propiedad</h2>
          <PropertyFields value={property} onChange={setProperty} />
        </section>
        <button className="button button-primary button-large" disabled={busy}>
          {busy ? "Creando…" : "Crear y cargar fotos"}
        </button>
      </form>
    </div>
  );
}
