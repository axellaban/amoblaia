"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Copy,
  ImageIcon,
  MessageCircle,
  Plus,
  Search,
} from "lucide-react";
import { ImportFromListing } from "./demo-import";
import { CreditsDialog, type CreditTarget } from "./admin-agencies";
import { EDIT_HEADER } from "@/lib/agency/edit-scope";
import {
  ACTIVITY_LABELS,
  adminPhotoUrl,
  demoUrl,
  whatsappShareUrl,
  type AgencyRow,
  type DemoActivity,
  type DemoSummary,
} from "@/lib/demos/shared";

/**
 * The edit context of this tab ("Editar inmobiliaria"), sent with every
 * call to the admin API while it is set. It lives in this page's memory
 * only, so another tab editing another agency never sends it.
 */
let editContext: string | null = null;
export function setEditContext(token: string | null) {
  editContext = token;
}
export const EDIT_EXPIRED_EVENT = "habita:edicion-vencida";

/** fetch for the admin API: JSON in and out, the server's message on errors. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const json = typeof init.body === "string";
  const headers = new Headers(init.headers);
  if (json && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (editContext && path.startsWith("/api/admin/") && !headers.has(EDIT_HEADER)) headers.set(EDIT_HEADER, editContext);
  const r = await fetch(path, {
    cache: "no-store",
    ...init,
    headers,
  });
  const payload = await r.json().catch(() => ({}));
  if (r.status === 401) {
    window.location.assign(`/acceso?next=${encodeURIComponent(window.location.pathname)}`);
    throw new Error("Tu sesión venció. Volvé a ingresar.");
  }
  // The edit context ran out: the banner offers to renew it; nothing was saved and drafts stay.
  if (r.status === 412 && editContext) window.dispatchEvent(new Event(EDIT_EXPIRED_EVENT));
  if (!r.ok) throw new ApiError(payload.error || "No pudimos completar la operación.", r.status, payload);
  return payload as T;
}
/** A failed request, with its status and the server's answer (e.g. the new preview of a changed listing). */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: Record<string, unknown>,
  ) {
    super(message);
  }
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

/**
 * The agency's link to its demo. While the agency has no account, the link
 * carries a fresh one-time code, so the demo opens its panel for it; once
 * claimed, the plain presentation link does.
 */
async function agencyLink(demo: Pick<DemoSummary, "id" | "token" | "agencyClaimed">) {
  // With its account, the agency sees the demo inside its own panel.
  if (demo.agencyClaimed === true) return `${window.location.origin}/panel/propiedades/${demo.id}`;
  const claim = await api<{ presentationUrl: string | null }>(`/api/admin/demos/${demo.id}/reclamo`, { method: "POST" });
  return claim.presentationUrl ?? publicLink(demo.token, true);
}

/** A text action that copies one of the demo's links (the agency's or the buyers'). */
export function LinkCopy({ demo, which }: { demo: Pick<DemoSummary, "id" | "token" | "status" | "agencyClaimed">; which: "agency" | "buyer" }) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const live = demo.status === "published";
  async function copy() {
    setBusy(true);
    setError("");
    try {
      const link = which === "agency" ? await agencyLink(demo) : publicLink(demo.token);
      if (await copyText(link)) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos crear el enlace.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button type="button" className="dm-text" disabled={!live || busy} title={live ? undefined : "Publicá la demo para compartirla"} onClick={copy}>
        {copied ? "Copiado" : "Copiar link"}
      </button>
      {error && (
        <span className="inline-error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}

/**
 * "Ver": the agency's view (the same link as Copiar link) or the buyers' page.
 * A draft has no public page yet, so the buyers' view opens the team's preview.
 */
export function ViewLink({ demo, which }: { demo: Pick<DemoSummary, "id" | "token" | "status" | "agencyClaimed">; which: "agency" | "buyer" }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function open() {
    setBusy(true);
    setError("");
    // Opened now, while the click still counts, so the browser does not block it.
    const tab = window.open("about:blank", "_blank");
    try {
      const url =
        which === "agency"
          ? await agencyLink(demo)
          : demo.status === "published"
            ? publicLink(demo.token)
            : `${window.location.origin}/admin/demos/${demo.id}/vista-previa`;
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else window.open(url, "_blank", "noopener");
    } catch (e) {
      tab?.close();
      setError(e instanceof Error ? e.message : "No pudimos abrir la vista.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button type="button" className="dm-text" disabled={busy} onClick={open}>
        Ver
      </button>
      {error && (
        <span className="inline-error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}

/** WhatsApp with only the agency's link: no text of ours. */
export function WhatsappText({ demo }: { demo: Pick<DemoSummary, "id" | "token" | "agencyClaimed"> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function send() {
    setBusy(true);
    setError("");
    // Opened now, while the click still counts, so the browser does not block it.
    const tab = window.open("about:blank", "_blank");
    try {
      const url = whatsappShareUrl(await agencyLink(demo));
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else window.location.href = url;
    } catch (e) {
      tab?.close();
      setError(e instanceof Error ? e.message : "No pudimos crear el enlace.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button type="button" className="dm-text dm-text-wa" disabled={busy} onClick={send}>
        WhatsApp
      </button>
      {error && (
        <span className="inline-error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}

/** One way to share a demo: the same view every time, copied or sent on WhatsApp. */
function ShareCard({
  title,
  hint,
  shown,
  live,
  resolve,
}: {
  title: string;
  hint: string;
  shown: string;
  live: boolean;
  resolve: () => Promise<string>;
}) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function copy() {
    setBusy(true);
    setError("");
    try {
      if (await copyText(await resolve())) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos crear el enlace.");
    } finally {
      setBusy(false);
    }
  }
  async function whatsapp() {
    setBusy(true);
    setError("");
    // Opened now, while the click still counts, so the browser does not block it.
    const tab = window.open("about:blank", "_blank");
    try {
      const url = whatsappShareUrl(await resolve());
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else window.location.href = url;
    } catch (e) {
      tab?.close();
      setError(e instanceof Error ? e.message : "No pudimos crear el enlace.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="dm-share-card">
      <strong>{title}</strong>
      <span className="dm-help">{hint}</span>
      <code className="dm-share-url">{live ? shown : "Se activa al publicar la demo"}</code>
      <div className="dm-share-buttons">
        <button type="button" className="button button-small button-outline" disabled={!live || busy} onClick={copy}>
          {copied ? <Check size={15} /> : <Copy size={15} />}
          {copied ? "Enlace copiado" : "Copiar enlace"}
        </button>
        <button type="button" className="button button-small dm-whatsapp" disabled={!live || busy} onClick={whatsapp}>
          <MessageCircle size={15} /> WhatsApp
        </button>
      </div>
      {error && (
        <span className="inline-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

/**
 * The two ways to share a demo, always the same: to the agency (its
 * presentation, as from its panel) and to the buyers (the clean ficha).
 * No step to create a link first.
 */
export function ShareCards({ demo }: { demo: Pick<DemoSummary, "id" | "token" | "status" | "agencyClaimed"> }) {
  const live = demo.status === "published";
  return (
    <div className="dm-share-cards">
      <ShareCard
        title="Enviar a la inmobiliaria"
        hint="Siempre entra a la vista de presentación, como desde su panel."
        shown={publicLink(demo.token, true)}
        live={live}
        resolve={() => agencyLink(demo)}
      />
      <ShareCard
        title="Enviar al comprador"
        hint="Siempre la ficha limpia, sin franja ni acceso al panel."
        shown={publicLink(demo.token)}
        live={live}
        resolve={async () => publicLink(demo.token)}
      />
    </div>
  );
}

/**
 * The agency's credits in the demo's row: its available balance and the ones
 * reserved until it accepts the invitation. The same dialog as Inmobiliarias.
 */
export function DemoCredits({ demo, onDone }: { demo: DemoSummary; onDone: (text: string) => void }) {
  const [target, setTarget] = useState<CreditTarget | null>(null);
  const show = (n: number | null) => (n === null ? "—" : String(n));
  // With an account: its balance. Without one: what waits for it.
  const shown = demo.agencyClaimed ? show(demo.credits.available) : show(demo.credits.reserved);
  return (
    <div className="dm-credits">
      <span className="dm-credits-label">{demo.agencyClaimed ? "Créditos" : "Créditos reservados"}</span>
      <div className="dm-credits-nums">
        <b>{shown}</b>
        <button
          type="button"
          className="dm-text"
          onClick={() =>
            setTarget({
              id: demo.agencyId,
              name: demo.agencyName,
              hasOwner: demo.agencyClaimed === true,
              available: demo.credits.available,
              reserved: demo.credits.reserved,
            })
          }
        >
          Cargar
        </button>
      </div>
      <CreditsDialog
        target={target}
        onClose={() => setTarget(null)}
        onDone={(text) => {
          setTarget(null);
          onDone(text);
        }}
      />
    </div>
  );
}

/** How long ago something happened, for the team's list. */
function agoText(iso: string) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "recién";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.round(hours / 24)} d`;
}

/**
 * What the demo's visitors and its agency did, at a glance: the highest of
 * the five steps reached, how many people came and when last. Team only.
 */
export function ActivityStatus({ activity }: { activity: DemoActivity }) {
  const label = ACTIVITY_LABELS[activity.level];
  const people = `${activity.visitors} ${activity.visitors === 1 ? "persona" : "personas"}`;
  return (
    <div className="dm-activity" aria-label={`Actividad: ${label}`}>
      <span className="dm-activity-label">Actividad</span>
      <strong>{activity.level ? `${activity.level} · ${label}` : label}</strong>
      <span className="dm-activity-dots" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((step) => (
          <i key={step} className={step <= activity.level ? "on" : undefined} />
        ))}
      </span>
      <span className="dm-activity-foot">
        {activity.at ? `${people} · última ${agoText(activity.at)}` : "Sin visitas todavía"}
      </span>
    </div>
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
              <Link href={`/admin/inmobiliarias/${d.agencyId}`} className="dm-agency">
                {d.agencyName}
                {d.agencyClaimed && <span className="dm-claimed"> · ya tiene su panel</span>}
              </Link>
              <strong>{d.propertyTitle}</strong>
              <span className="dm-meta">
                {d.photos} {d.photos === 1 ? "foto" : "fotos"} · {d.staged}{" "}
                {d.staged === 1 ? "ambientada" : "ambientadas"} · creada el{" "}
                {new Date(d.createdAt).toLocaleDateString("es-AR")}
              </span>
            </div>
            <StatusChip status={d.status} />
            <div className="dm-links">
              <span className="dm-who">Inmobiliaria</span>
              <ViewLink demo={d} which="agency" />
              <LinkCopy demo={d} which="agency" />
              <span className="dm-sep">·</span>
              <span className="dm-who">Comprador</span>
              <ViewLink demo={d} which="buyer" />
              <LinkCopy demo={d} which="buyer" />
              {d.status === "published" && (
                <>
                  <span className="dm-sep">·</span>
                  <WhatsappText demo={d} />
                </>
              )}
            </div>
            <div className="dm-bottom">
              <div className="dm-facts">
                <DemoCredits demo={d} onDone={(text) => { setNotice(text); void load(); }} />
                <ActivityStatus activity={d.activity} />
              </div>
              <div className="dm-actions">
                <Link href={`/admin/demos/${d.id}`} className="dm-text">
                  Editar
                </Link>
                <span className="dm-sep">·</span>
                <button
                  type="button"
                  className={`dm-text ${d.status === "published" ? "" : "dm-text-primary"}`}
                  disabled={busy === d.id}
                  onClick={() => act(d, d.status === "published" ? "unpublish" : "publish")}
                >
                  {d.status === "published" ? "Despublicar" : "Publicar"}
                </button>
                <span className="dm-sep">·</span>
                <button
                  type="button"
                  className="dm-text dm-danger"
                  aria-label={`Eliminar ${d.title}`}
                  disabled={busy === d.id}
                  onClick={() => act(d, "delete")}
                >
                  Eliminar
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      <p className="dm-footer-link">
        <Link href="/admin/inmobiliarias" className="text-link">
          Ver inmobiliarias
        </Link>
        {" · "}
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
export function NewDemoForm({ agencyId: fixedAgency = null }: { agencyId?: string | null } = {}) {
  const router = useRouter();
  const [agencies, setAgencies] = useState<AgencyRow[] | null>(null);
  const [mode, setMode] = useState<"existing" | "new">(fixedAgency ? "existing" : "new");
  const [agencyId, setAgencyId] = useState(fixedAgency ?? "");
  const [agency, setAgency] = useState(emptyAgency);
  const [property, setProperty] = useState(emptyProperty);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ agencies: AgencyRow[] }>("/api/admin/demos")
      .then((d) => {
        setAgencies(d.agencies);
        if (d.agencies.length) setMode("existing");
        if (fixedAgency && !d.agencies.some((a) => a.id === fixedAgency)) setError("No encontramos esa inmobiliaria. Elegila de la lista.");
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
      <Link href={fixedAgency ? `/admin/inmobiliarias/${fixedAgency}` : "/admin/inmobiliarias"} className="text-link">
        ← {fixedAgency ? "Volver a la inmobiliaria" : "Inmobiliarias"}
      </Link>
      <h1>
        {fixedAgency ? "Agregar propiedad" : "Nueva demo"}
        <span className="accent">.</span>
      </h1>
      {fixedAgency && agencies && (
        <p className="inline-notice">
          Se agrega a <strong>{agencies.find((a) => a.id === fixedAgency)?.name ?? "la inmobiliaria elegida"}</strong>.
        </p>
      )}
      <p>Pegá la URL de la ficha y la armamos sola, o cargá los datos a mano.</p>
      <ImportFromListing agencyId={fixedAgency} />
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
