"use client";
// "Editar inmobiliaria": the team's workspace on one agency, inside its edit
// context. Properties first (each with one next step), then its data and
// brand, its credits and what the team did on it. Every write goes through
// the admin API with this tab's context; the server checks it on each call.
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ImageIcon, Plus, Search } from "lucide-react";
import { ApiError, api } from "./admin-demos";
import { AdminEditBanner, useAgencyEdit, type AgencyEdit } from "./admin-edit-context";
import { AgencyCredits } from "./admin-agencies";
import { ORIGIN_LABEL, nextStep, safeReturn, type PanelProperty } from "@/lib/agency/shared";
import type { AdminAgencyDetail } from "@/lib/agency/stage";
import { adminPhotoUrl } from "@/lib/demos/shared";

type Tab = "propiedades" | "marca" | "creditos" | "actividad";
const TABS: { id: Tab; label: string }[] = [
  { id: "propiedades", label: "Propiedades" },
  { id: "marca", label: "Datos y marca" },
  { id: "creditos", label: "Créditos" },
  { id: "actividad", label: "Actividad del equipo" },
];
const isTab = (v: string | null): v is Tab => TABS.some((t) => t.id === v);

export type WorkspaceAgency = {
  id: string;
  name: string;
  hasOwner: boolean;
  stage: string;
  counts: AdminAgencyDetail["counts"];
  credits: AdminAgencyDetail["credits"];
};

/** The way back to the list as it was left (search, page, open row), from ?volver=. */
export function useListReturn(agencyId: string) {
  const params = useSearchParams();
  return safeReturn(params.get("volver"), `/admin/inmobiliarias?abierta=${agencyId}`);
}

export function AgencyWorkspace({ agency }: { agency: WorkspaceAgency }) {
  const edit = useAgencyEdit(agency.id);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab: Tab = isTab(params.get("pestana")) ? (params.get("pestana") as Tab) : "propiedades";
  const listReturn = useListReturn(agency.id);
  const here = `${pathname}${params.toString() ? `?${params}` : ""}`;
  const setTab = (t: Tab) => {
    const next = new URLSearchParams(params.toString());
    if (t === "propiedades") next.delete("pestana");
    else next.set("pestana", t);
    router.replace(`${pathname}${next.toString() ? `?${next}` : ""}`, { scroll: false });
  };
  // Keyboard: arrows move between tabs (WAI-ARIA tabs pattern).
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const onTabKey = (e: React.KeyboardEvent, i: number) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const n = (i + step + TABS.length) % TABS.length;
    setTab(TABS[n].id);
    tabRefs.current[n]?.focus();
  };
  const addHref = `/admin/inmobiliarias/${agency.id}/propiedades/nueva?${new URLSearchParams({ volver: here })}`;

  return (
    <div className="account-page container dm-page ae-page">
      <AdminEditBanner agencyName={agency.name} edit={edit} exitHref={listReturn} />
      <div className="dm-heading">
        <div>
          <span className="eyebrow">{agency.name}</span>
          <h1>
            Propiedades<span className="accent">.</span>
          </h1>
          <p>
            Elegí qué querés continuar: la próxima acción está en cada ficha. <span className="dm-status">{agency.stage}</span>{" "}
            <Link href={`/admin/inmobiliarias/${agency.id}`} className="text-link ae-inline-link">
              Cuenta e invitaciones
            </Link>
          </p>
        </div>
        <div className="dm-heading-actions">
          <Link href={addHref} className="button button-primary" aria-disabled={!edit.ready} onClick={(e) => !edit.ready && e.preventDefault()}>
            <Plus size={17} /> Agregar propiedad
          </Link>
        </div>
      </div>

      <div className="ae-tabs" role="tablist" aria-label="Secciones de la inmobiliaria">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`ae-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`ae-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => onTabKey(e, i)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`ae-panel-${tab}`} aria-labelledby={`ae-tab-${tab}`} className="ae-panel">
        {tab === "propiedades" && <PropertiesTab agency={agency} backTo={here} />}
        {tab === "marca" && <BrandTab agencyId={agency.id} edit={edit} />}
        {tab === "creditos" && (
          <>
            <p className="dm-help">
              Agregar créditos es una acción aparte de editar: un regalo o ajuste con motivo, auditado y que se aplica una sola vez. Editar la inmobiliaria
              nunca gasta su saldo.
            </p>
            <AgencyCredits agency={{ id: agency.id, name: agency.name, hasOwner: agency.hasOwner }} credits={agency.credits} />
          </>
        )}
        {tab === "actividad" && <ActivityTab agencyId={agency.id} />}
      </div>
    </div>
  );
}

const STATUS_FILTERS = [
  { id: "", label: "Todas" },
  { id: "draft", label: "Borradores" },
  { id: "published", label: "Publicadas" },
] as const;

/** The agency's properties as cards: cover, state, origin, real counts and one primary next step. */
function PropertiesTab({ agency, backTo }: { agency: WorkspaceAgency; backTo: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const page = Math.max(1, Number(params.get("pagina")) || 1);
  const q = params.get("q") ?? "";
  const estado = params.get("estado") ?? "";
  const [text, setText] = useState(q);
  const [data, setData] = useState<{ items: PanelProperty[]; total: number } | null>(null);
  const [error, setError] = useState("");
  const seq = useRef(0);
  const PER = 12;
  const load = useCallback(async () => {
    const n = ++seq.current;
    setError("");
    try {
      const qs = new URLSearchParams({ pagina: String(page), por: String(PER), ...(q ? { q } : {}), ...(estado ? { estado } : {}) });
      const d = await api<{ items: PanelProperty[]; total: number }>(`/api/admin/inmobiliarias/${agency.id}/propiedades?${qs}`);
      if (n === seq.current) setData(d);
    } catch (e) {
      if (n === seq.current) setError(e instanceof Error ? e.message : "No pudimos cargar las propiedades.");
    }
  }, [agency.id, page, q, estado]);
  useEffect(() => {
    void load();
  }, [load]);
  const go = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) if (v) next.set(k, v);
    else next.delete(k);
    router.replace(`${pathname}${next.toString() ? `?${next}` : ""}`, { scroll: false });
  };
  const counts = { "": agency.counts.total, draft: agency.counts.total - agency.counts.published, published: agency.counts.published };
  const open = (id: string, section: string) =>
    `/admin/inmobiliarias/${agency.id}/propiedades/${id}?${new URLSearchParams({ seccion: section, volver: backTo })}`;
  const pages = data ? Math.max(1, Math.ceil(data.total / PER)) : 1;
  return (
    <>
      <div className="ae-toolbar">
        <form
          className="dm-search ae-search"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            go({ q: text.trim() || null, pagina: null });
          }}
        >
          <Search size={17} aria-hidden="true" />
          <input type="search" value={text} placeholder="Buscar por título o ubicación" aria-label="Buscar propiedad" onChange={(e) => setText(e.target.value)} />
        </form>
        <div className="ae-chips" role="group" aria-label="Filtrar por estado">
          {STATUS_FILTERS.map((f) => (
            <button key={f.id} type="button" className="ae-chip" aria-pressed={estado === f.id} onClick={() => go({ estado: f.id || null, pagina: null })}>
              {f.label} · {counts[f.id]}
            </button>
          ))}
        </div>
      </div>
      {error ? (
        <div className="ap-retry-row" role="alert">
          <span>{error}</span>
          <button type="button" className="button button-small button-outline" onClick={() => void load()}>
            Reintentar
          </button>
        </div>
      ) : !data ? (
        <p role="status">Cargando propiedades…</p>
      ) : !data.items.length ? (
        <div className="account-panel ae-empty">
          <h2>{q || estado ? "No hay propiedades que coincidan" : "Todavía no tiene propiedades"}</h2>
          <p>{q || estado ? "Probá con otra búsqueda o filtro." : "Agregá la primera: pegá el enlace de la publicación o cargala a mano."}</p>
        </div>
      ) : (
        <ul className="ae-cards">
          {data.items.map((p) => {
            const step = nextStep(p);
            return (
              <li key={p.id} className="ae-card">
                <Link href={open(p.id, "fotos")} className="ae-card-cover" tabIndex={-1} aria-hidden="true">
                  {p.coverPhotoId ? <img src={adminPhotoUrl(p.coverPhotoId, null, 960)} alt="" loading="lazy" /> : <ImageIcon size={28} />}
                </Link>
                <div className="ae-card-body">
                  <p className="ae-card-tags">
                    <span className={`dm-status ${p.status === "published" ? "is-live" : ""}`}>{p.status === "published" ? "Publicada" : "Borrador"}</span>
                    <span>{ORIGIN_LABEL[p.origin]}</span>
                    {p.listingUrl && <span>Desde publicación</span>}
                  </p>
                  <h2>{p.title}</h2>
                  <p className="ae-card-facts">
                    {[
                      p.reference ? `Ref. ${p.reference}` : null,
                      p.spaces ? `${p.spaces} ${p.spaces === 1 ? "espacio" : "espacios"}` : null,
                      `${p.photos} ${p.photos === 1 ? "foto" : "fotos"}`,
                      `${p.versions.ready} ${p.versions.ready === 1 ? "versión creada" : "versiones creadas"}`,
                      p.versions.active ? `${p.versions.active} en curso` : null,
                      p.versions.issues ? `${p.versions.issues} para revisar` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <div className="ae-next">
                    <strong>{step.title}</strong>
                    <span>{step.help}</span>
                  </div>
                  <Link href={open(p.id, step.section)} className={`button ${step.primary ? "button-primary" : "button-outline"} ae-card-cta`}>
                    {step.cta} →
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {data && pages > 1 && (
        <nav className="ap-pages" aria-label="Páginas de propiedades">
          <button type="button" className="button button-small button-outline" disabled={page <= 1} onClick={() => go({ pagina: page > 2 ? String(page - 1) : null })}>
            Anterior
          </button>
          <span>
            {page} de {pages} · {data.total} propiedades
          </span>
          <button type="button" className="button button-small button-outline" disabled={page >= pages} onClick={() => go({ pagina: String(page + 1) })}>
            Siguiente
          </button>
        </nav>
      )}
    </>
  );
}

type Record_ = {
  agency: { id: string; name: string; website: string | null; contact_name: string | null; contact_email: string | null; notes: string | null; hasOwner: boolean };
  branding: {
    primary: string | null;
    accent: string | null;
    titleFont: "sans" | "serif";
    contactKind: "whatsapp" | "url" | "phone" | "email" | null;
    contactValue: string | null;
    visitUrl: string | null;
    logo: string | null;
  };
  emailReady: boolean;
};
const dataForm = (r: Record_) => ({
  name: r.agency.name,
  website: r.agency.website ?? "",
  contact_name: r.agency.contact_name ?? "",
  contact_email: r.agency.contact_email ?? "",
  notes: r.agency.notes ?? "",
});
const brandForm = (r: Record_) => ({
  primary: r.branding.primary ?? "",
  accent: r.branding.accent ?? "",
  titleFont: r.branding.titleFont,
  contactKind: r.branding.contactKind ?? ("whatsapp" as const),
  contactValue: r.branding.contactValue ?? "",
  visitUrl: r.branding.visitUrl ?? "",
});
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const CONTACT = { whatsapp: "WhatsApp", url: "Página de contacto", phone: "Teléfono", email: "Email" } as const;

/** The agency's data (private fields marked) and its brand, each saved on its own; nothing is saved implicitly. */
function BrandTab({ agencyId, edit }: { agencyId: string; edit: AgencyEdit }) {
  const uid = useId();
  const [record, setRecord] = useState<Record_ | null>(null);
  const [data, setData] = useState<ReturnType<typeof dataForm> | null>(null);
  const [brand, setBrand] = useState<ReturnType<typeof brandForm> | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState<"" | "data" | "brand" | "logo">("");
  const load = useCallback(async () => {
    setError("");
    try {
      const r = await api<Record_>(`/api/admin/inmobiliarias/${agencyId}?datos=1`);
      setRecord(r);
      // Drafts are set once; later loads (after a save) only refresh the form that was saved.
      setData((d) => d ?? dataForm(r));
      setBrand((b) => b ?? brandForm(r));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos cargar los datos.");
    }
  }, [agencyId]);
  useEffect(() => {
    void load();
  }, [load]);
  const dirtyData = useMemo(() => Boolean(record && data && !same(data, dataForm(record))), [record, data]);
  const dirtyBrand = useMemo(() => Boolean(record && brand && !same(brand, brandForm(record))), [record, brand]);
  useEffect(() => {
    if (!dirtyData && !dirtyBrand) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirtyData, dirtyBrand]);

  async function save(kind: "data" | "brand") {
    if (!data || !brand) return;
    setSaving(kind);
    setError("");
    setNotice("");
    try {
      const r = await api<Record_>(`/api/admin/inmobiliarias/${agencyId}`, {
        method: "PATCH",
        body: JSON.stringify(kind === "data" ? { action: "agency", agency: data } : { action: "branding", branding: brand }),
      });
      setRecord(r);
      if (kind === "data") setData(dataForm(r));
      else setBrand(brandForm(r));
      setNotice(kind === "data" ? "Datos guardados." : "Marca y contacto guardados.");
    } catch (e) {
      // The draft stays as typed.
      setError(e instanceof Error ? e.message : "No pudimos guardar.");
    } finally {
      setSaving("");
    }
  }
  async function logo(file: File | null) {
    setSaving("logo");
    setError("");
    setNotice("");
    try {
      if (file) {
        const form = new FormData();
        form.set("logo", file);
        await api(`/api/admin/inmobiliarias/${agencyId}/logo`, { method: "POST", body: form });
      } else await api(`/api/admin/inmobiliarias/${agencyId}/logo`, { method: "DELETE" });
      const r = await api<Record_>(`/api/admin/inmobiliarias/${agencyId}?datos=1`);
      setRecord(r);
      setNotice(file ? "Logo guardado." : "Logo quitado.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos guardar el logo.");
    } finally {
      setSaving("");
    }
  }

  if (!record || !data || !brand)
    return error ? (
      <div className="ap-retry-row" role="alert">
        <span>{error}</span>
        <button type="button" className="button button-small button-outline" onClick={() => void load()}>
          Reintentar
        </button>
      </div>
    ) : (
      <p role="status">Cargando los datos…</p>
    );
  const disabled = !edit.ready || Boolean(saving);
  const set = (k: keyof typeof data) => (e: { target: { value: string } }) => setData({ ...data, [k]: e.target.value });
  return (
    <div className="ae-brand">
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
      <form
        className="account-panel aa-section"
        aria-labelledby={`${uid}-data`}
        onSubmit={(e) => {
          e.preventDefault();
          void save("data");
        }}
      >
        <div className="aa-section-head">
          <h2 id={`${uid}-data`}>Datos de la inmobiliaria</h2>
          <span className="ae-save-state" role="status">
            {saving === "data" ? "Guardando…" : dirtyData ? "Cambios sin guardar" : "Guardado"}
          </span>
        </div>
        <div className="dm-fields">
          <label>
            Nombre comercial *
            <input required maxLength={120} value={data.name} onChange={set("name")} />
          </label>
          <label>
            Sitio web <small>(visible: el logo enlaza ahí)</small>
            <input maxLength={300} inputMode="url" placeholder="inmobiliaria.com.ar" value={data.website} onChange={set("website")} />
          </label>
          <label>
            Nombre de contacto <small>(interno)</small>
            <input maxLength={120} value={data.contact_name} onChange={set("contact_name")} />
          </label>
          <label>
            Email de contacto <small>(interno)</small>
            <input
              type="email"
              maxLength={200}
              value={data.contact_email}
              disabled={!record.emailReady}
              title={record.emailReady ? undefined : "Falta aplicar la migración 202611010001_admin_editing.sql"}
              onChange={set("contact_email")}
            />
          </label>
          <label className="dm-wide">
            Notas internas <small>(nunca se muestran a la inmobiliaria ni en las fichas)</small>
            <textarea rows={3} maxLength={4000} value={data.notes} onChange={set("notes")} />
          </label>
        </div>
        <p className="dm-help">La cuenta del dueño (email, contraseña), sus compras y su saldo no se editan acá.</p>
        <button className="button button-small" disabled={disabled || !dirtyData}>
          Guardar datos
        </button>
      </form>

      <form
        className="account-panel aa-section"
        aria-labelledby={`${uid}-brand`}
        onSubmit={(e) => {
          e.preventDefault();
          void save("brand");
        }}
      >
        <div className="aa-section-head">
          <h2 id={`${uid}-brand`}>Marca y contacto para compradores</h2>
          <span className="ae-save-state" role="status">
            {saving === "brand" ? "Guardando…" : dirtyBrand ? "Cambios sin guardar" : "Guardado"}
          </span>
        </div>
        <div className="dm-logo">
          {record.branding.logo ? <img src={record.branding.logo} alt={`Logo de ${record.agency.name}`} /> : <span className="dm-logo-empty">Sin logo: se muestra el nombre</span>}
          <div className="dm-logo-actions">
            <label className={`button button-small button-outline ${disabled ? "is-disabled" : ""}`}>
              {record.branding.logo ? "Cambiar logo" : "Subir logo"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="dm-hidden-input"
                disabled={disabled}
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  e.target.value = "";
                  if (file) void logo(file);
                }}
              />
            </label>
            {record.branding.logo && (
              <button type="button" className="text-link" disabled={disabled} onClick={() => void logo(null)}>
                Quitar
              </button>
            )}
          </div>
        </div>
        <div className="dm-fields">
          <label>
            Color principal <small>(botones)</small>
            <span className="dm-color">
              <input type="color" value={brand.primary || "#1f3a5f"} onChange={(e) => setBrand({ ...brand, primary: e.target.value })} aria-label="Color principal" />
              <input value={brand.primary} placeholder="#1f3a5f" maxLength={7} onChange={(e) => setBrand({ ...brand, primary: e.target.value })} />
            </span>
          </label>
          <label>
            Color secundario
            <span className="dm-color">
              <input type="color" value={brand.accent || "#6f8f5a"} onChange={(e) => setBrand({ ...brand, accent: e.target.value })} aria-label="Color secundario" />
              <input value={brand.accent} placeholder="#6f8f5a" maxLength={7} onChange={(e) => setBrand({ ...brand, accent: e.target.value })} />
            </span>
          </label>
          <label>
            Tipografía de títulos
            <select value={brand.titleFont} onChange={(e) => setBrand({ ...brand, titleFont: e.target.value as "sans" | "serif" })}>
              <option value="sans">Sin serif (moderna)</option>
              <option value="serif">Con serif (clásica)</option>
            </select>
          </label>
          <label>
            Cómo la contactan los compradores
            <select value={brand.contactKind} onChange={(e) => setBrand({ ...brand, contactKind: e.target.value as typeof brand.contactKind })}>
              {(Object.keys(CONTACT) as (keyof typeof CONTACT)[]).map((k) => (
                <option key={k} value={k}>
                  {CONTACT[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="dm-wide">
            {CONTACT[brand.contactKind]} <small>(vacío: sin botón de consulta)</small>
            <input value={brand.contactValue} maxLength={300} onChange={(e) => setBrand({ ...brand, contactValue: e.target.value })} />
          </label>
          <label className="dm-wide">
            Enlace para coordinar visitas <small>(opcional)</small>
            <input value={brand.visitUrl} maxLength={300} inputMode="url" placeholder="https://…" onChange={(e) => setBrand({ ...brand, visitUrl: e.target.value })} />
          </label>
        </div>
        <button className="button button-small" disabled={disabled || !dirtyBrand}>
          Guardar marca y contacto
        </button>
      </form>
    </div>
  );
}

const ACTION_LABEL: Record<string, string> = {
  agency_create: "Creó la ficha de la inmobiliaria",
  agency_edit_start: "Entró a editar la inmobiliaria",
  agency_edit_renew: "Renovó la edición",
  agency_edit_end: "Salió de la edición",
  agency_support_view: "Abrió la vista de soporte (solo lectura)",
  agency_support_end: "Cerró la vista de soporte",
  agency_claim_link: "Creó una invitación",
  agency_claim_revoke: "Revocó una invitación",
  agency_claim: "La inmobiliaria reclamó su cuenta",
};
const OPERATION_LABEL: Record<string, string> = {
  agency_data: "cambió los datos",
  agency_branding: "cambió la marca y el contacto",
  logo_set: "cambió el logo",
  logo_remove: "quitó el logo",
  property_create: "creó una propiedad a mano",
  property_import: "importó una propiedad",
  publish: "publicó una propiedad",
  unpublish: "despublicó una propiedad",
  token: "generó un enlace nuevo",
  delete: "eliminó una propiedad",
  property: "editó una propiedad",
  settings: "editó datos de una propiedad",
  demo: "cambió el título de una propiedad",
  cover: "cambió una portada",
  order: "reordenó fotos",
  photo_add: "agregó una foto",
  photo_update: "editó una foto",
  photo_delete: "eliminó una foto",
  photo_assign: "movió fotos de espacio",
  space_create: "creó un espacio",
  space_update: "editó un espacio",
  space_order: "reordenó espacios",
  space_delete: "eliminó un espacio",
  version_create: "creó una versión (demo del equipo)",
  listing_sync: "completó datos desde la publicación",
  "main-style": "cambió el estilo principal",
  "hide-style": "quitó un estilo de la ficha",
  agency: "cambió los datos de la inmobiliaria",
  branding: "cambió la marca",
};
function activityText(a: { action: string; details: Record<string, unknown> }) {
  if (a.action === "agency_edit") {
    const op = String(a.details.operation ?? "");
    return `${OPERATION_LABEL[op] ? OPERATION_LABEL[op][0].toUpperCase() + OPERATION_LABEL[op].slice(1) : `Cambio: ${op}`}${a.details.via === "admin_demo" ? " (desde Demos)" : ""}`;
  }
  return ACTION_LABEL[a.action] ?? a.action;
}

function ActivityTab({ agencyId }: { agencyId: string }) {
  const [items, setItems] = useState<{ id: number; action: string; createdAt: string; actor: string; details: Record<string, unknown> }[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setError("");
    try {
      setItems((await api<{ items: NonNullable<typeof items> }>(`/api/admin/inmobiliarias/${agencyId}/actividad`)).items);
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : "No pudimos cargar la actividad.");
    }
  }, [agencyId]);
  useEffect(() => {
    void load();
  }, [load]);
  if (error)
    return (
      <div className="ap-retry-row" role="alert">
        <span>{error}</span>
        <button type="button" className="button button-small button-outline" onClick={() => void load()}>
          Reintentar
        </button>
      </div>
    );
  if (!items) return <p role="status">Cargando la actividad…</p>;
  if (!items.length) return <p className="aa-empty">Todavía no hay actividad del equipo registrada.</p>;
  return (
    <ol className="ae-activity">
      {items.map((a) => (
        <li key={a.id}>
          <time dateTime={a.createdAt}>{new Date(a.createdAt).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}</time>
          <span>{activityText(a)}</span>
          <small>{a.actor}</small>
        </li>
      ))}
    </ol>
  );
}
