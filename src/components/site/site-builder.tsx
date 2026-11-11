"use client";
// Panel → Sitio web: the agency builds its website like in a site builder.
// Templates to start from, pages, sections from a library (drag to
// reorder), an inspector per section, design (colors, typefaces, header,
// footer), settings (contact, social, SEO, analytics), the inquiries that
// come in, and a live canvas in desktop, tablet and phone. The draft saves
// itself; «Publicar» puts it on the public site.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  GripVertical,
  Inbox,
  LayoutTemplate,
  Loader2,
  Mail,
  MessageCircle,
  Monitor,
  Paintbrush,
  Phone,
  Plus,
  Redo2,
  Settings,
  Smartphone,
  Tablet,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { api } from "@/components/admin-demos";
import type { PublicSite } from "@/lib/agency/site";
import {
  COMMON_FIELDS,
  FONTS,
  newSection,
  PAGE_PRESETS,
  PAGE_SLUG,
  SECTION_GROUPS,
  SECTION_TYPES,
  SECTIONS,
  TEMPLATE_THEMES,
  TEMPLATES,
  templateSite,
  uid,
  waNumber,
  type Field,
  type Section,
  type SectionType,
  type SiteDoc,
  type SitePage,
  type SiteSeed,
  type TemplateId,
} from "@/lib/site/schema";
import { FieldEditor, ImageField, LinkField, type FieldCtx } from "./site-builder-fields";
import { iconFor, SiteRenderer, type SectionAction } from "./site-render";
import b from "./site-builder.module.css";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
const errorText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

type EditorState = {
  ready: boolean;
  draft: SiteDoc | null;
  publishedAt: string | null;
  updatedAt: string | null;
  pending: boolean;
  seed: SiteSeed;
};
type Loaded = EditorState & {
  role: string;
  agency: { id: string; name: string; slug: string | null; sitePublished: boolean; website: string | null };
  catalog: PublicSite | null;
  unread: number;
};
type Tab = "secciones" | "paginas" | "diseno" | "ajustes" | "consultas";
type Device = "desktop" | "tablet" | "mobile";
const DEVICE_WIDTH: Record<Device, number> = { desktop: 1280, tablet: 820, mobile: 390 };

const SECTION_ICONS: Record<SectionType, string> = {
  hero: "home",
  search: "search",
  featured: "star",
  listings: "building",
  about: "users",
  services: "key",
  stats: "chart",
  steps: "file",
  testimonials: "heart",
  team: "users",
  zones: "map",
  cta: "sparkles",
  valuation: "calculator",
  contact: "phone",
  map: "map",
  faq: "file",
  text: "file",
  gallery: "camera",
  video: "camera",
  logos: "award",
  newsletter: "phone",
  staging: "sparkles",
};

const emptyCatalog = (name: string): PublicSite => ({
  agencyId: "",
  name,
  slug: "",
  logo: null,
  primary: "#24382e",
  primaryInk: "#ffffff",
  whatsapp: null,
  website: null,
  properties: [],
});

/* ───────────────── Start: templates ───────────────── */

function TemplatePicker({ seed, catalog, busy, onPick, onCancel }: { seed: SiteSeed; catalog: PublicSite; busy: TemplateId | null; onPick: (t: TemplateId) => void; onCancel?: () => void }) {
  return (
    <div className={b.templates}>
      <div className={b.templatesHead}>
        <div>
          <span className={b.eyebrow}>Sitio web</span>
          <h1>Elegí una plantilla para tu sitio</h1>
          <p>Viene armada con tus datos y tus propiedades publicadas: Inicio, Propiedades, Nosotros, Tasaciones y Contacto. Después cambiás textos, fotos, colores y secciones como quieras.</p>
        </div>
        {onCancel && (
          <button type="button" className={b.ghostBtn} onClick={onCancel}>
            <X size={16} aria-hidden="true" /> Cancelar
          </button>
        )}
      </div>
      <div className={b.templateGrid}>
        {TEMPLATES.map((t) => {
          const doc = templateSite(t.id, seed);
          return (
            <article key={t.id} className={b.templateCard}>
              <div className={b.templateThumb} aria-hidden="true">
                <div className={b.templateFrame}>
                  <SiteRenderer doc={doc} catalog={catalog} pageSlug="" mode="editor" editor={{ selected: null, onSelect: () => {}, onAction: () => {}, navigate: () => {} }} />
                </div>
              </div>
              <div className={b.templateInfo}>
                <div>
                  <h2>{t.label}</h2>
                  <p>{t.description}</p>
                  <span className={b.swatches}>
                    {[doc.theme.primary, doc.theme.accent, doc.theme.surface].map((c) => (
                      <span key={c} style={{ background: c }} />
                    ))}
                  </span>
                </div>
                <button type="button" className={b.primaryBtn} disabled={busy !== null} onClick={() => onPick(t.id)}>
                  {busy === t.id ? <Loader2 size={16} className={b.spin} aria-hidden="true" /> : null} Usar esta plantilla
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

/* ───────────────── Section library ───────────────── */

function SectionLibrary({ onAdd, onClose, page }: { onAdd: (t: SectionType) => void; onClose: () => void; page: SitePage }) {
  const [q, setQ] = useState("");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const term = q.trim().toLowerCase();
  return (
    <div className={b.modalBack} onClick={onClose}>
      <div className={b.modal} role="dialog" aria-modal="true" aria-label="Agregar sección" onClick={(e) => e.stopPropagation()}>
        <div className={b.modalHead}>
          <h2>Agregar sección</h2>
          <input autoFocus placeholder="Buscar: equipo, mapa, tasación…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button type="button" className={b.iconBtn} onClick={onClose} aria-label="Cerrar">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className={b.modalBody}>
          {SECTION_GROUPS.map((g) => {
            const types = SECTION_TYPES.filter((t) => SECTIONS[t].group === g).filter(
              (t) => !term || `${SECTIONS[t].label} ${SECTIONS[t].description}`.toLowerCase().includes(term),
            );
            if (!types.length) return null;
            return (
              <section key={g}>
                <h3>{g}</h3>
                <div className={b.libGrid}>
                  {types.map((t) => {
                    const Icon = iconFor(SECTION_ICONS[t]);
                    const taken = SECTIONS[t].single && page.sections.some((x) => x.type === t);
                    return (
                      <button key={t} type="button" className={b.libCard} disabled={taken} onClick={() => onAdd(t)}>
                        <span className={b.libIcon}>
                          <Icon size={20} aria-hidden="true" />
                        </span>
                        <strong>{SECTIONS[t].label}</strong>
                        <span>{taken ? "Ya está en esta página." : SECTIONS[t].description}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ───────────────── Panels ───────────────── */

function SectionsPanel({
  page,
  selected,
  onSelect,
  onAction,
  onMove,
  onAdd,
  readOnly,
}: {
  page: SitePage;
  selected: string | null;
  onSelect: (id: string) => void;
  onAction: (id: string, a: SectionAction) => void;
  onMove: (from: number, to: number) => void;
  onAdd: () => void;
  readOnly: boolean;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  return (
    <div className={b.panelBody}>
      <p className={b.hint}>Hacé clic en una sección (acá o en la vista) para editarla. Arrastrá para cambiar el orden.</p>
      <ul className={b.sectionList}>
        {page.sections.map((x, i) => {
          const Icon = iconFor(SECTION_ICONS[x.type]);
          return (
            <li
              key={x.id}
              draggable={!readOnly}
              onDragStart={(e) => {
                setDrag(i);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                if (drag === null) return;
                e.preventDefault();
                setOver(i);
              }}
              onDragEnd={() => {
                setDrag(null);
                setOver(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (drag !== null && drag !== i) onMove(drag, i);
                setDrag(null);
                setOver(null);
              }}
              className={cx(b.sectionRow, selected === x.id && b.on, x.hidden && b.muted, over === i && drag !== i && b.dropTarget, drag === i && b.dragging)}
            >
              <GripVertical size={16} className={b.grip} aria-hidden="true" />
              <button type="button" className={b.sectionName} onClick={() => onSelect(x.id)}>
                <Icon size={16} aria-hidden="true" />
                <span>
                  <strong>{SECTIONS[x.type].label}</strong>
                  {String(x.props.title ?? "") && <small>{String(x.props.title)}</small>}
                </span>
              </button>
              <span className={b.rowTools}>
                <button type="button" className={b.iconBtn} disabled={readOnly || i === 0} onClick={() => onAction(x.id, "up")} aria-label="Subir" title="Subir">
                  <ChevronUp size={15} aria-hidden="true" />
                </button>
                <button type="button" className={b.iconBtn} disabled={readOnly || i === page.sections.length - 1} onClick={() => onAction(x.id, "down")} aria-label="Bajar" title="Bajar">
                  <ChevronDown size={15} aria-hidden="true" />
                </button>
                <button type="button" className={b.iconBtn} disabled={readOnly} onClick={() => onAction(x.id, "hide")} aria-label={x.hidden ? "Mostrar" : "Ocultar"} title={x.hidden ? "Mostrar" : "Ocultar"}>
                  {x.hidden ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      <button type="button" className={b.addSection} disabled={readOnly} onClick={onAdd}>
        <Plus size={16} aria-hidden="true" /> Agregar sección
      </button>
    </div>
  );
}

function Inspector({ section, ctx, onChange, onBack, onAction }: { section: Section; ctx: FieldCtx; onChange: (key: string, v: unknown) => void; onBack: () => void; onAction: (a: SectionAction) => void }) {
  const [tab, setTab] = useState<"contenido" | "estilo">("contenido");
  const def = SECTIONS[section.type];
  const fields: readonly Field[] = tab === "contenido" ? def.fields : COMMON_FIELDS;
  return (
    <div className={b.panelBody}>
      <div className={b.inspectorHead}>
        <button type="button" className={b.backBtn} onClick={onBack}>
          <ChevronLeft size={16} aria-hidden="true" /> Secciones
        </button>
        <span className={b.rowTools}>
          <button type="button" className={b.iconBtn} disabled={ctx.readOnly} onClick={() => onAction("duplicate")} title="Duplicar" aria-label="Duplicar">
            <Copy size={15} aria-hidden="true" />
          </button>
          <button type="button" className={b.iconBtn} disabled={ctx.readOnly} onClick={() => onAction("hide")} title={section.hidden ? "Mostrar" : "Ocultar"} aria-label={section.hidden ? "Mostrar" : "Ocultar"}>
            {section.hidden ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
          </button>
          <button type="button" className={b.iconBtn} disabled={ctx.readOnly} onClick={() => onAction("delete")} title="Eliminar" aria-label="Eliminar">
            <Trash2 size={15} aria-hidden="true" />
          </button>
        </span>
      </div>
      <h2 className={b.panelTitle}>{def.label}</h2>
      <p className={b.hint}>{def.description}</p>
      <div className={b.segmented} role="tablist">
        <button type="button" role="tab" aria-selected={tab === "contenido"} className={cx(tab === "contenido" && b.on)} onClick={() => setTab("contenido")}>
          Contenido
        </button>
        <button type="button" role="tab" aria-selected={tab === "estilo"} className={cx(tab === "estilo" && b.on)} onClick={() => setTab("estilo")}>
          Estilo
        </button>
      </div>
      <div className={b.fields}>
        {fields.map((f) => (
          <FieldEditor key={`${section.id}-${f.key}`} field={f} value={section.props[f.key]} ctx={ctx} onChange={(v) => onChange(f.key, v)} />
        ))}
      </div>
    </div>
  );
}

function PagesPanel({
  doc,
  current,
  onOpen,
  update,
  readOnly,
}: {
  doc: SiteDoc;
  current: string;
  onOpen: (id: string) => void;
  update: (fn: (d: SiteDoc) => SiteDoc, key?: string) => void;
  readOnly: boolean;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const setPage = (id: string, patch: Partial<SitePage>, key?: string) => update((d) => ({ ...d, pages: d.pages.map((p) => (p.id === id ? { ...p, ...patch } : p)) }), key);
  const freeSlug = (base: string) => {
    let s = base.slice(0, 19);
    for (let i = 2; doc.pages.some((p) => p.slug === s); i++) s = `${base.slice(0, 16)}-${i}`;
    return s;
  };
  return (
    <div className={b.panelBody}>
      <p className={b.hint}>Las páginas marcadas con «En el menú» aparecen en el encabezado y el pie del sitio.</p>
      <ul className={b.pageList}>
        {doc.pages.map((p, i) => (
          <li key={p.id} className={cx(b.pageRow, current === p.id && b.on)}>
            <div className={b.pageRowHead}>
              <button type="button" className={b.sectionName} onClick={() => onOpen(p.id)}>
                <FileText size={16} aria-hidden="true" />
                <span>
                  <strong>{p.title}</strong>
                  <small>/{p.slug || ""}{p.slug === "" && " · inicio"}{!p.nav && " · fuera del menú"}</small>
                </span>
              </button>
              <span className={b.rowTools}>
                {p.slug !== "" && (
                  <>
                    <button
                      type="button"
                      className={b.iconBtn}
                      disabled={readOnly || i <= 1}
                      title="Subir en el menú"
                      aria-label="Subir en el menú"
                      onClick={() =>
                        update((d) => {
                          const pages = [...d.pages];
                          [pages[i - 1], pages[i]] = [pages[i]!, pages[i - 1]!];
                          return { ...d, pages };
                        })
                      }
                    >
                      <ChevronUp size={15} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className={b.iconBtn}
                      disabled={readOnly || i === doc.pages.length - 1}
                      title="Bajar en el menú"
                      aria-label="Bajar en el menú"
                      onClick={() =>
                        update((d) => {
                          const pages = [...d.pages];
                          [pages[i + 1], pages[i]] = [pages[i]!, pages[i + 1]!];
                          return { ...d, pages };
                        })
                      }
                    >
                      <ChevronDown size={15} aria-hidden="true" />
                    </button>
                  </>
                )}
                <button type="button" className={b.iconBtn} onClick={() => setEditing(editing === p.id ? null : p.id)} title="Configurar" aria-label="Configurar página">
                  <Settings size={15} aria-hidden="true" />
                </button>
              </span>
            </div>
            {editing === p.id && (
              <div className={b.itemBody}>
                <label className={b.field}>
                  <span className={b.label}>Nombre</span>
                  <input disabled={readOnly} maxLength={40} value={p.title} onChange={(e) => setPage(p.id, { title: e.target.value }, `title-${p.id}`)} />
                </label>
                {p.slug !== "" && (
                  <label className={b.field}>
                    <span className={b.label}>Dirección</span>
                    <span className={b.inline}>
                      <span className={b.prefix}>/</span>
                      <input
                        disabled={readOnly}
                        maxLength={19}
                        value={p.slug}
                        onChange={(e) =>
                          setPage(
                            p.id,
                            {
                              slug: e.target.value
                                .toLowerCase()
                                .normalize("NFD")
                                .replace(/[̀-ͯ]/g, "")
                                .replace(/[^a-z0-9-]/g, "-")
                                .slice(0, 19),
                            },
                            `slug-${p.id}`,
                          )
                        }
                      />
                    </span>
                    {!PAGE_SLUG.test(p.slug) && <small className={b.error}>Usá de 2 a 19 letras, números o guiones.</small>}
                    {doc.pages.some((o) => o.id !== p.id && o.slug === p.slug) && <small className={b.error}>Otra página ya usa esta dirección.</small>}
                  </label>
                )}
                <label className={b.toggle}>
                  <input type="checkbox" disabled={readOnly} checked={p.nav} onChange={(e) => setPage(p.id, { nav: e.target.checked })} />
                  <span className={b.switch} aria-hidden="true" />
                  <span>En el menú</span>
                </label>
                <label className={b.field}>
                  <span className={b.label}>Título para Google (opcional)</span>
                  <input disabled={readOnly} maxLength={70} value={p.seoTitle} onChange={(e) => setPage(p.id, { seoTitle: e.target.value }, `seot-${p.id}`)} />
                </label>
                <label className={b.field}>
                  <span className={b.label}>Descripción para Google (opcional)</span>
                  <textarea disabled={readOnly} maxLength={170} rows={3} value={p.seoDescription} onChange={(e) => setPage(p.id, { seoDescription: e.target.value }, `seod-${p.id}`)} />
                </label>
                <div className={b.rowActions}>
                  <button
                    type="button"
                    className={b.smallBtn}
                    disabled={readOnly || doc.pages.length >= 20}
                    onClick={() =>
                      update((d) => {
                        const copy: SitePage = {
                          ...structuredClone(p),
                          id: uid(),
                          title: `${p.title} (copia)`.slice(0, 40),
                          slug: freeSlug(p.slug ? `${p.slug.slice(0, 13)}-copia` : "inicio-copia"),
                          sections: p.sections.map((x) => ({ ...structuredClone(x), id: uid() })),
                        };
                        return { ...d, pages: [...d.pages, copy] };
                      })
                    }
                  >
                    <Copy size={14} aria-hidden="true" /> Duplicar
                  </button>
                  {p.slug !== "" && (
                    <button
                      type="button"
                      className={cx(b.smallBtn, b.danger)}
                      disabled={readOnly}
                      onClick={() => {
                        if (!window.confirm(`¿Eliminar la página «${p.title}»? Podés deshacerlo con Deshacer.`)) return;
                        update((d) => ({ ...d, pages: d.pages.filter((x) => x.id !== p.id) }));
                        if (current === p.id) onOpen(doc.pages[0]!.id);
                      }}
                    >
                      <Trash2 size={14} aria-hidden="true" /> Eliminar
                    </button>
                  )}
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      {adding ? (
        <div className={b.presetBox}>
          <div className={b.presetHead}>
            <strong>Nueva página</strong>
            <button type="button" className={b.iconBtn} onClick={() => setAdding(false)} aria-label="Cerrar">
              <X size={15} aria-hidden="true" />
            </button>
          </div>
          <div className={b.presets}>
            {PAGE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={b.smallBtn}
                onClick={() => {
                  const page: SitePage = { id: uid(), title: preset.title, slug: freeSlug(preset.slug), nav: true, seoTitle: "", seoDescription: "", sections: preset.build() };
                  update((d) => ({ ...d, pages: [...d.pages, page] }));
                  setAdding(false);
                  onOpen(page.id);
                }}
              >
                {preset.title}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <button type="button" className={b.addSection} disabled={readOnly || doc.pages.length >= 20} onClick={() => setAdding(true)}>
          <Plus size={16} aria-hidden="true" /> Agregar página
        </button>
      )}
    </div>
  );
}

const PALETTES: { name: string; primary: string; accent: string; background: string; surface: string; text: string }[] = [
  { name: "Bosque", primary: "#24382e", accent: "#b08d57", background: "#fbf8f3", surface: "#f1ebe1", text: "#22261f" },
  { name: "Océano", primary: "#1d4ed8", accent: "#0ea5e9", background: "#ffffff", surface: "#f3f6fb", text: "#0f172a" },
  { name: "Noche y oro", primary: "#111111", accent: "#c6a15b", background: "#ffffff", surface: "#f6f3ee", text: "#161616" },
  { name: "Terracota", primary: "#c2562f", accent: "#2a9d8f", background: "#fffdf8", surface: "#fdf0e6", text: "#2b2118" },
  { name: "Vino", primary: "#7a1f3d", accent: "#d4a373", background: "#fffaf7", surface: "#f7ece8", text: "#2a1a1f" },
  { name: "Petróleo", primary: "#0f4c5c", accent: "#e36414", background: "#ffffff", surface: "#eef5f6", text: "#0b2a33" },
  { name: "Grafito", primary: "#2f3437", accent: "#f2b134", background: "#ffffff", surface: "#f4f4f2", text: "#1b1d1e" },
  { name: "Azul marino", primary: "#0b2545", accent: "#13315c", background: "#ffffff", surface: "#eef4ed", text: "#0b1320" },
];
const FONT_PAIRS: { name: string; heading: SiteDoc["theme"]["headingFont"]; body: SiteDoc["theme"]["bodyFont"] }[] = [
  { name: "Elegante", heading: "playfair", body: "manrope" },
  { name: "Lujo", heading: "cormorant", body: "dmsans" },
  { name: "Moderna", heading: "montserrat", body: "inter" },
  { name: "Amigable", heading: "poppins", body: "poppins" },
  { name: "Editorial", heading: "lora", body: "inter" },
  { name: "Simple", heading: "dmsans", body: "dmsans" },
];

function DesignPanel({ doc, update, ctx }: { doc: SiteDoc; update: (fn: (d: SiteDoc) => SiteDoc, key?: string) => void; ctx: FieldCtx }) {
  const t = doc.theme;
  const setTheme = (patch: Partial<SiteDoc["theme"]>, key?: string) => update((d) => ({ ...d, theme: { ...d.theme, ...patch } }), key);
  const setHeader = (patch: Partial<SiteDoc["header"]>, key?: string) => update((d) => ({ ...d, header: { ...d.header, ...patch } }), key);
  const setFooter = (patch: Partial<SiteDoc["footer"]>, key?: string) => update((d) => ({ ...d, footer: { ...d.footer, ...patch } }), key);
  const ro = ctx.readOnly;
  const seg = <T extends string>(label: string, value: T, options: [T, string][], onPick: (v: T) => void) => (
    <div className={b.field}>
      <span className={b.label}>{label}</span>
      <div className={b.segmented}>
        {options.map(([v, l]) => (
          <button key={v} type="button" disabled={ro} className={cx(value === v && b.on)} onClick={() => onPick(v)}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
  const toggle = (label: string, checked: boolean, onSet: (v: boolean) => void) => (
    <label className={b.toggle}>
      <input type="checkbox" disabled={ro} checked={checked} onChange={(e) => onSet(e.target.checked)} />
      <span className={b.switch} aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
  return (
    <div className={b.panelBody}>
      <details className={b.group} open>
        <summary>Estilo de plantilla</summary>
        <p className={b.hint}>Cambia colores, tipografías y botones. Tus textos, fotos y páginas no se tocan.</p>
        <div className={b.styleGrid}>
          {TEMPLATES.map((tp) => {
            const th = TEMPLATE_THEMES[tp.id];
            return (
              <button
                key={tp.id}
                type="button"
                disabled={ro}
                className={cx(b.styleCard, doc.template === tp.id && b.on)}
                onClick={() =>
                  update((d) => ({
                    ...d,
                    template: tp.id,
                    theme: { ...th.theme },
                    header: { ...d.header, ...th.header },
                    footer: { ...d.footer, ...th.footer },
                  }))
                }
              >
                <span className={b.swatches}>
                  {[th.theme.primary, th.theme.accent, th.theme.surface].map((c) => (
                    <span key={c} style={{ background: c }} />
                  ))}
                </span>
                <strong>{tp.label}</strong>
              </button>
            );
          })}
        </div>
      </details>
      <details className={b.group} open>
        <summary>Colores</summary>
        <div className={b.palettes}>
          {PALETTES.map((p) => (
            <button key={p.name} type="button" disabled={ro} title={p.name} className={b.palette} onClick={() => setTheme({ primary: p.primary, accent: p.accent, background: p.background, surface: p.surface, text: p.text })}>
              <span style={{ background: p.primary }} />
              <span style={{ background: p.accent }} />
              <span style={{ background: p.surface }} />
              <small>{p.name}</small>
            </button>
          ))}
        </div>
        {(
          [
            ["primary", "Principal (marca)"],
            ["accent", "Acento"],
            ["background", "Fondo"],
            ["surface", "Fondo alternativo"],
            ["text", "Texto"],
          ] as const
        ).map(([k, l]) => (
          <label key={k} className={b.colorRow}>
            <span>{l}</span>
            <span className={b.color}>
              <input type="color" disabled={ro} value={t[k]} onChange={(e) => setTheme({ [k]: e.target.value } as Partial<SiteDoc["theme"]>, `color-${k}`)} />
              <code>{t[k]}</code>
            </span>
          </label>
        ))}
      </details>
      <details className={b.group} open>
        <summary>Tipografía</summary>
        <div className={b.presets}>
          {FONT_PAIRS.map((f) => (
            <button key={f.name} type="button" disabled={ro} className={cx(b.smallBtn, t.headingFont === f.heading && t.bodyFont === f.body && b.on)} onClick={() => setTheme({ headingFont: f.heading, bodyFont: f.body })}>
              {f.name}
            </button>
          ))}
        </div>
        <label className={b.field}>
          <span className={b.label}>Títulos</span>
          <select disabled={ro} value={t.headingFont} onChange={(e) => setTheme({ headingFont: e.target.value as typeof t.headingFont })}>
            {FONTS.map(([id, l]) => (
              <option key={id} value={id}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className={b.field}>
          <span className={b.label}>Textos</span>
          <select disabled={ro} value={t.bodyFont} onChange={(e) => setTheme({ bodyFont: e.target.value as typeof t.bodyFont })}>
            {FONTS.map(([id, l]) => (
              <option key={id} value={id}>
                {l}
              </option>
            ))}
          </select>
        </label>
        {seg("Títulos en", t.headingCase, [["normal", "Normal"], ["upper", "MAYÚSCULAS"]], (v) => setTheme({ headingCase: v }))}
      </details>
      <details className={b.group}>
        <summary>Formas y ancho</summary>
        {seg("Bordes", t.radius, [["none", "Rectos"], ["soft", "Suaves"], ["round", "Redondeados"]], (v) => setTheme({ radius: v }))}
        {seg("Botones", t.buttons, [["solid", "Rellenos"], ["outline", "Contorno"], ["pill", "Píldora"]], (v) => setTheme({ buttons: v }))}
        {seg("Ancho del contenido", t.width, [["normal", "Normal"], ["wide", "Amplio"]], (v) => setTheme({ width: v }))}
      </details>
      <details className={b.group}>
        <summary>Encabezado</summary>
        {seg("Estilo", doc.header.style, [["light", "Claro"], ["dark", "Oscuro"], ["brand", "Marca"], ["transparent", "Sobre la portada"]], (v) => setHeader({ style: v }))}
        {seg("Logo", doc.header.layout, [["left", "A la izquierda"], ["center", "Centrado"]], (v) => setHeader({ layout: v }))}
        {toggle("Fijo al hacer scroll", doc.header.sticky, (v) => setHeader({ sticky: v }))}
        {toggle("Mostrar teléfono", doc.header.showPhone, (v) => setHeader({ showPhone: v }))}
        <label className={b.field}>
          <span className={b.label}>Botón del encabezado</span>
          <input disabled={ro} maxLength={40} placeholder="Sin botón" value={doc.header.ctaLabel} onChange={(e) => setHeader({ ctaLabel: e.target.value }, "hcta")} />
        </label>
        {doc.header.ctaLabel && <LinkField label="Destino del botón" value={doc.header.ctaLink} ctx={ctx} onChange={(v) => setHeader({ ctaLink: v })} />}
      </details>
      <details className={b.group}>
        <summary>Pie de página</summary>
        {seg("Estilo", doc.footer.style, [["dark", "Oscuro"], ["light", "Claro"], ["brand", "Marca"]], (v) => setFooter({ style: v }))}
        <label className={b.field}>
          <span className={b.label}>Texto</span>
          <textarea disabled={ro} rows={3} maxLength={400} value={doc.footer.about} onChange={(e) => setFooter({ about: e.target.value }, "fabout")} />
        </label>
        {toggle("Mostrar páginas", doc.footer.showPages, (v) => setFooter({ showPages: v }))}
        {toggle("Mostrar contacto", doc.footer.showContact, (v) => setFooter({ showContact: v }))}
        {toggle("Mostrar redes", doc.footer.showSocial, (v) => setFooter({ showSocial: v }))}
        <label className={b.field}>
          <span className={b.label}>Texto legal (opcional)</span>
          <textarea disabled={ro} rows={2} maxLength={400} placeholder="Las medidas e imágenes son orientativas…" value={doc.footer.legal} onChange={(e) => setFooter({ legal: e.target.value }, "flegal")} />
        </label>
      </details>
    </div>
  );
}

function SettingsPanel({
  doc,
  update,
  ctx,
  data,
  onAgency,
  onReset,
}: {
  doc: SiteDoc;
  update: (fn: (d: SiteDoc) => SiteDoc, key?: string) => void;
  ctx: FieldCtx;
  data: Loaded;
  onAgency: (patch: Record<string, unknown>) => Promise<boolean>;
  onReset: () => void;
}) {
  const st = doc.settings;
  const ro = ctx.readOnly;
  const set = (patch: Partial<SiteDoc["settings"]>, key?: string) => update((d) => ({ ...d, settings: { ...d.settings, ...patch } }), key);
  const text = (k: keyof SiteDoc["settings"], label: string, opts: { max?: number; placeholder?: string; help?: string; area?: boolean } = {}) => (
    <label className={b.field}>
      <span className={b.label}>{label}</span>
      {opts.area ? (
        <textarea disabled={ro} rows={3} maxLength={opts.max} placeholder={opts.placeholder} value={String(st[k] ?? "")} onChange={(e) => set({ [k]: e.target.value } as Partial<SiteDoc["settings"]>, `set-${k}`)} />
      ) : (
        <input disabled={ro} maxLength={opts.max} placeholder={opts.placeholder} value={String(st[k] ?? "")} onChange={(e) => set({ [k]: e.target.value } as Partial<SiteDoc["settings"]>, `set-${k}`)} />
      )}
      {opts.help && <small className={b.help}>{opts.help}</small>}
    </label>
  );
  const [name, setName] = useState(data.agency.name);
  const [slug, setSlug] = useState(data.agency.slug ?? "");
  const [saving, setSaving] = useState("");
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState("");
  const [logoV, setLogoV] = useState(0);
  return (
    <div className={b.panelBody}>
      <details className={b.group} open>
        <summary>Identidad y dirección</summary>
        <label className={b.field}>
          <span className={b.label}>Nombre de la inmobiliaria</span>
          <span className={b.inline}>
            <input disabled={ro} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
            {name.trim() && name !== data.agency.name && (
              <button
                type="button"
                className={b.smallBtn}
                disabled={saving === "name"}
                onClick={async () => {
                  setSaving("name");
                  await onAgency({ name: name.trim() });
                  setSaving("");
                }}
              >
                Guardar
              </button>
            )}
          </span>
        </label>
        <label className={b.field}>
          <span className={b.label}>Dirección del sitio</span>
          <span className={b.inline}>
            <span className={b.prefix}>habitaia.app/inmobiliaria/</span>
            <input disabled={ro} maxLength={42} value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} />
          </span>
          {slug !== (data.agency.slug ?? "") && (
            <span className={b.inline}>
              <small className={b.help}>{data.agency.slug && data.agency.sitePublished ? "Los enlaces a la dirección anterior dejan de funcionar." : "Letras minúsculas, números y guiones."}</small>
              <button
                type="button"
                className={b.smallBtn}
                disabled={saving === "slug" || !/^[a-z0-9]([a-z0-9-]{1,40}[a-z0-9])$/.test(slug)}
                onClick={async () => {
                  setSaving("slug");
                  await onAgency({ slug });
                  setSaving("");
                }}
              >
                Guardar
              </button>
            </span>
          )}
        </label>
        <div className={b.field}>
          <span className={b.label}>Logo</span>
          <div className={b.logoRow}>
            <span className={b.logoBox}>{data.catalog?.logo ? <img src={`${data.catalog.logo}${logoV ? `&r=${logoV}` : ""}`} alt="Logo" /> : <small>Sin logo: se muestra el nombre</small>}</span>
            <label className={cx(b.smallBtn, ro && b.disabled)}>
              {logoBusy ? "Subiendo…" : data.catalog?.logo ? "Cambiar" : "Subir logo"}
              <input
                type="file"
                hidden
                disabled={ro || logoBusy}
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const body = new FormData();
                  body.set("logo", file);
                  setLogoBusy(true);
                  setLogoError("");
                  try {
                    await api("/api/panel/logo", { method: "POST", body });
                    await onAgency({});
                    setLogoV(Date.now());
                  } catch (err) {
                    setLogoError(errorText(err, "No pudimos guardar el logo."));
                  } finally {
                    setLogoBusy(false);
                  }
                }}
              />
            </label>
          </div>
          {logoError && <small className={b.error}>{logoError}</small>}
        </div>
      </details>
      <details className={b.group} open>
        <summary>Contacto</summary>
        {text("whatsapp", "WhatsApp", { max: 40, placeholder: "+54 9 11 5555-1234" })}
        {st.whatsapp && !waNumber(st.whatsapp) && <small className={b.error}>Revisá el número: no parece un WhatsApp válido.</small>}
        {text("phone", "Teléfono", { max: 40, placeholder: "011 4555-1234" })}
        {text("email", "Email", { max: 120, placeholder: "consultas@inmobiliaria.com" })}
        {text("address", "Dirección de la oficina", { max: 200, placeholder: "Av. Santa Fe 1234, CABA", help: "Se usa en Contacto y en el mapa." })}
        {text("hours", "Horarios", { max: 120, placeholder: "Lun a vie de 9 a 18 h · Sáb de 10 a 13 h" })}
        {text("license", "Matrícula", { max: 120, placeholder: "CUCICBA Mat. 1234", help: "Aparece en el pie de cada página." })}
      </details>
      <details className={b.group}>
        <summary>Botón de WhatsApp y aviso</summary>
        <label className={b.toggle}>
          <input type="checkbox" disabled={ro} checked={st.whatsappButton} onChange={(e) => set({ whatsappButton: e.target.checked })} />
          <span className={b.switch} aria-hidden="true" />
          <span>Botón flotante de WhatsApp</span>
        </label>
        {text("whatsappMessage", "Mensaje inicial", { max: 300, area: true, placeholder: `Hola ${data.agency.name}! Vi su sitio web y quiero hacer una consulta.` })}
        {text("announcement", "Barra de aviso (arriba de todo)", { max: 160, placeholder: "Nuevo: tasaciones sin cargo en 48 h" })}
        {st.announcement && <LinkField label="Enlace del aviso" value={st.announcementLink} ctx={ctx} onChange={(v) => set({ announcementLink: v })} />}
      </details>
      <details className={b.group}>
        <summary>Redes sociales</summary>
        {text("instagram", "Instagram", { placeholder: "https://instagram.com/tuinmobiliaria" })}
        {text("facebook", "Facebook", { placeholder: "https://facebook.com/tuinmobiliaria" })}
        {text("linkedin", "LinkedIn", { placeholder: "https://linkedin.com/company/…" })}
        {text("youtube", "YouTube", { placeholder: "https://youtube.com/@…" })}
        {text("tiktok", "TikTok", { placeholder: "https://tiktok.com/@…" })}
      </details>
      <details className={b.group}>
        <summary>Google y redes (SEO)</summary>
        {text("seoTitle", "Título del sitio", { max: 70, help: `${st.seoTitle.length}/70 · Lo que aparece en Google y en la pestaña.` })}
        {text("seoDescription", "Descripción", { max: 170, area: true, help: `${st.seoDescription.length}/170` })}
        <ImageField label="Imagen al compartir (WhatsApp, redes)" value={st.shareImage} ctx={ctx} onChange={(v) => set({ shareImage: v })} />
        <label className={b.toggle}>
          <input type="checkbox" disabled={ro} checked={st.indexable} onChange={(e) => set({ indexable: e.target.checked })} />
          <span className={b.switch} aria-hidden="true" />
          <span>Que Google pueda mostrar el sitio</span>
        </label>
        <div className={b.serp} aria-label="Así se vería en Google">
          <small>habitaia.app › inmobiliaria › {data.agency.slug ?? "tu-inmobiliaria"}</small>
          <strong>{st.seoTitle || data.agency.name}</strong>
          <span>{st.seoDescription || `Propiedades en venta y alquiler de ${data.agency.name}.`}</span>
        </div>
      </details>
      <details className={b.group}>
        <summary>Estadísticas</summary>
        {text("ga4", "Google Analytics 4 (ID)", { max: 20, placeholder: "G-XXXXXXXXXX" })}
        {st.ga4 && !/^G-[A-Z0-9]{4,14}$/.test(st.ga4) && <small className={b.error}>El ID empieza con G- (por ejemplo G-AB12CD34EF).</small>}
        {text("metaPixel", "Píxel de Meta (ID)", { max: 20, placeholder: "123456789012345" })}
        {st.metaPixel && !/^\d{6,20}$/.test(st.metaPixel) && <small className={b.error}>El ID del píxel son solo números.</small>}
      </details>
      <details className={b.group}>
        <summary>Avanzado</summary>
        <p className={b.hint}>
          {data.agency.sitePublished ? "Tu sitio está publicado." : "Tu sitio no está publicado."} Despublicarlo lo oculta para tus clientes; las fichas de cada propiedad siguen funcionando con su enlace.
        </p>
        <div className={b.rowActions}>
          {data.agency.sitePublished && (
            <button type="button" className={b.smallBtn} disabled={ro} onClick={() => window.confirm("¿Despublicar tu sitio? Tus clientes dejarán de verlo.") && void onAgency({ sitePublished: false })}>
              Despublicar sitio
            </button>
          )}
          <button type="button" className={cx(b.smallBtn, b.danger)} disabled={ro} onClick={onReset}>
            Empezar de nuevo con otra plantilla
          </button>
        </div>
      </details>
    </div>
  );
}

type Inquiry = {
  id: string;
  kind: "contacto" | "tasacion" | "propiedad" | "newsletter";
  name: string | null;
  email: string | null;
  phone: string | null;
  message: string | null;
  property_token: string | null;
  page: string | null;
  details: Record<string, string>;
  created_at: string;
  read_at: string | null;
};
const KIND_LABEL: Record<Inquiry["kind"], string> = { contacto: "Contacto", tasacion: "Tasación", propiedad: "Propiedad", newsletter: "Suscripción" };
const DETAIL_LABEL: Record<string, string> = { operacion: "Operación", tipo: "Tipo", direccion: "Dirección", ambientes: "Ambientes", superficie: "Superficie (m²)" };

function InquiriesPanel({ onUnread, readOnly }: { onUnread: (n: number) => void; readOnly: boolean }) {
  const [items, setItems] = useState<Inquiry[] | null>(null);
  const [ready, setReady] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<"" | Inquiry["kind"]>("");
  const apply = useCallback(
    (r: { ready: boolean; items: Inquiry[]; unread: number }) => {
      setItems(r.items);
      setReady(r.ready);
      onUnread(r.unread);
    },
    [onUnread],
  );
  useEffect(() => {
    api<{ ready: boolean; items: Inquiry[]; unread: number }>("/api/panel/sitio/consultas")
      .then(apply)
      .catch((e) => setError(errorText(e, "No pudimos cargar las consultas.")));
  }, [apply]);
  const mark = (ids: string[], read: boolean) =>
    api<{ ready: boolean; items: Inquiry[]; unread: number }>("/api/panel/sitio/consultas", { method: "PATCH", body: JSON.stringify({ ids, read }) })
      .then(apply)
      .catch((e) => setError(errorText(e, "No pudimos actualizar.")));
  const csv = () => {
    const rows = [["Fecha", "Tipo", "Nombre", "Email", "Teléfono", "Mensaje", "Detalles"]];
    for (const i of items ?? [])
      rows.push([
        new Date(i.created_at).toLocaleString("es-AR"),
        KIND_LABEL[i.kind],
        i.name ?? "",
        i.email ?? "",
        i.phone ?? "",
        i.message ?? "",
        Object.entries(i.details)
          .map(([k, v]) => `${DETAIL_LABEL[k] ?? k}: ${v}`)
          .join(" · "),
      ]);
    const text = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob(["﻿", text], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "consultas-sitio.csv";
    a.click();
    URL.revokeObjectURL(url);
  };
  if (error) return <p className={cx(b.panelBody, b.error)}>{error}</p>;
  if (!items) return <p className={b.panelBody}>Cargando consultas…</p>;
  if (!ready) return <p className={cx(b.panelBody, b.hint)}>Las consultas se guardan cuando se aplica la migración del sitio en Supabase.</p>;
  const shown = items.filter((i) => !filter || i.kind === filter);
  return (
    <div className={b.panelBody}>
      <p className={b.hint}>Lo que te escriben desde los formularios de tu sitio: contacto, tasaciones y suscripciones.</p>
      <div className={b.presets}>
        {(["", "contacto", "tasacion", "newsletter"] as const).map((k) => (
          <button key={k} type="button" className={cx(b.smallBtn, filter === k && b.on)} onClick={() => setFilter(k)}>
            {k ? KIND_LABEL[k] : "Todas"} ({k ? items.filter((i) => i.kind === k).length : items.length})
          </button>
        ))}
      </div>
      {items.length > 0 && (
        <div className={b.rowActions}>
          <button type="button" className={b.smallBtn} disabled={readOnly || !items.some((i) => !i.read_at)} onClick={() => void mark(items.filter((i) => !i.read_at).map((i) => i.id), true)}>
            <Check size={14} aria-hidden="true" /> Marcar todas leídas
          </button>
          <button type="button" className={b.smallBtn} onClick={csv}>
            Descargar CSV
          </button>
        </div>
      )}
      {shown.length === 0 ? (
        <p className={b.emptyBox}>
          <Inbox size={22} aria-hidden="true" />
          Todavía no llegaron consultas{filter ? " de este tipo" : ""}. Cuando publiques el sitio, las vas a ver acá.
        </p>
      ) : (
        <ul className={b.inbox}>
          {shown.map((i) => {
            const wa = i.phone ? waNumber(i.phone) : null;
            return (
              <li key={i.id} className={cx(b.inboxItem, !i.read_at && b.unread)}>
                <button
                  type="button"
                  className={b.inboxHead}
                  onClick={() => {
                    setOpen(open === i.id ? null : i.id);
                    if (!i.read_at && !readOnly) void mark([i.id], true);
                  }}
                >
                  <span className={b.badge}>{KIND_LABEL[i.kind]}</span>
                  <strong>{i.name || i.email || i.phone || "Sin nombre"}</strong>
                  <small>{new Date(i.created_at).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}</small>
                </button>
                {open === i.id && (
                  <div className={b.inboxBody}>
                    {i.message && <p>{i.message}</p>}
                    {Object.keys(i.details).length > 0 && (
                      <dl>
                        {Object.entries(i.details).map(([k, v]) => (
                          <div key={k}>
                            <dt>{DETAIL_LABEL[k] ?? k}</dt>
                            <dd>{v}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                    <div className={b.rowActions}>
                      {wa && (
                        <a className={b.smallBtn} href={`https://wa.me/${wa}?text=${encodeURIComponent(`Hola ${i.name ?? ""}! Te escribo por tu consulta en nuestro sitio.`)}`} target="_blank" rel="noopener noreferrer">
                          <MessageCircle size={14} aria-hidden="true" /> WhatsApp
                        </a>
                      )}
                      {i.phone && (
                        <a className={b.smallBtn} href={`tel:${i.phone.replace(/[^\d+]/g, "")}`}>
                          <Phone size={14} aria-hidden="true" /> {i.phone}
                        </a>
                      )}
                      {i.email && (
                        <a className={b.smallBtn} href={`mailto:${i.email}`}>
                          <Mail size={14} aria-hidden="true" /> {i.email}
                        </a>
                      )}
                      <button type="button" className={b.smallBtn} disabled={readOnly} onClick={() => void mark([i.id], false)}>
                        Marcar no leída
                      </button>
                      <button
                        type="button"
                        className={cx(b.smallBtn, b.danger)}
                        disabled={readOnly}
                        onClick={() =>
                          window.confirm("¿Borrar esta consulta?") &&
                          void api<{ ready: boolean; items: Inquiry[]; unread: number }>("/api/panel/sitio/consultas", { method: "DELETE", body: JSON.stringify({ id: i.id }) })
                            .then(apply)
                            .catch((e) => setError(errorText(e, "No pudimos borrar.")))
                        }
                      >
                        <Trash2 size={14} aria-hidden="true" /> Borrar
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ───────────────── Editor ───────────────── */

type SaveState = "saved" | "dirty" | "saving" | "error";
const HISTORY = 80;

function Editor({ data, initial, setData, onReset }: { data: Loaded; initial: SiteDoc; setData: (d: Loaded) => void; onReset: () => void }) {
  const readOnly = !["owner", "admin"].includes(data.role);
  const [doc, setDoc] = useState<SiteDoc>(initial);
  const [past, setPast] = useState<SiteDoc[]>([]);
  const [future, setFuture] = useState<SiteDoc[]>([]);
  const lastKey = useRef<{ key: string; at: number } | null>(null);
  const [pageId, setPageId] = useState(initial.pages[0]!.id);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("secciones");
  const [device, setDevice] = useState<Device>("desktop");
  const [library, setLibrary] = useState<{ at: number } | null>(null);
  const [query, setQuery] = useState("");
  const [save, setSave] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [notice, setNotice] = useState("");
  const [mobileView, setMobileView] = useState<"edit" | "preview">("preview");
  const canvas = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const version = useRef(0);
  const savedVersion = useRef(0);

  const page = doc.pages.find((p) => p.id === pageId) ?? doc.pages[0]!;
  const section = page.sections.find((x) => x.id === selected) ?? null;
  const catalog = useMemo(() => data.catalog ?? emptyCatalog(data.agency.name), [data.catalog, data.agency.name]);
  const fieldCtx: FieldCtx = useMemo(() => ({ doc, covers: catalog.properties.map((p) => p.cover).filter((c): c is string => Boolean(c)), readOnly }), [doc, catalog, readOnly]);

  // The latest values, for handlers that run between renders.
  const docRef = useRef(doc);
  const pastRef = useRef(past);
  const futureRef = useRef(future);
  pastRef.current = past;
  futureRef.current = future;
  const commit = useCallback((next: SiteDoc) => {
    docRef.current = next;
    version.current++;
    setDoc(next);
    setSave("dirty");
  }, []);

  /** Every change goes through here: undo history (typing in one field counts once) and autosave. */
  const update = useCallback(
    (fn: (d: SiteDoc) => SiteDoc, key?: string) => {
      if (readOnly) return;
      const prev = docRef.current;
      const next = fn(prev);
      if (next === prev) return;
      const now = Date.now();
      const coalesce = key && lastKey.current?.key === key && now - lastKey.current.at < 1200;
      lastKey.current = key ? { key, at: now } : null;
      if (!coalesce) setPast((p) => [...p.slice(-HISTORY + 1), prev]);
      setFuture([]);
      commit(next);
    },
    [readOnly, commit],
  );
  const undo = useCallback(() => {
    const p = pastRef.current;
    if (!p.length) return;
    setPast(p.slice(0, -1));
    setFuture([docRef.current, ...futureRef.current].slice(0, HISTORY));
    lastKey.current = null;
    commit(p[p.length - 1]!);
  }, [commit]);
  const redo = useCallback(() => {
    const f = futureRef.current;
    if (!f.length) return;
    setFuture(f.slice(1));
    setPast([...pastRef.current, docRef.current].slice(-HISTORY));
    lastKey.current = null;
    commit(f[0]!);
  }, [commit]);

  // Autosave: a moment after the last change.
  const flush = useCallback(async () => {
    if (readOnly) return true;
    const v = version.current;
    if (v === savedVersion.current) return true;
    setSave("saving");
    try {
      const r = await api<EditorState>("/api/panel/sitio", { method: "PUT", body: JSON.stringify({ site: docRef.current }) });
      savedVersion.current = Math.max(savedVersion.current, v);
      setData({ ...data, ...r, draft: r.draft });
      setSave(version.current === v ? "saved" : "dirty");
      setSaveError("");
      return true;
    } catch (e) {
      setSave("error");
      setSaveError(errorText(e, "No pudimos guardar los cambios."));
      return false;
    }
  }, [data, readOnly, setData]);
  useEffect(() => {
    if (save !== "dirty") return;
    const t = window.setTimeout(() => void flush(), 1200);
    return () => window.clearTimeout(t);
  }, [doc, save, flush]);
  useEffect(() => {
    if (save === "saved") return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [save]);

  // Keyboard: undo, redo, Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest?.("input, textarea, select");
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !typing) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y" && !typing) {
        e.preventDefault();
        redo();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void flush();
      } else if (e.key === "Escape" && !library && !typing) setSelected(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [undo, redo, flush, library]);

  // The desktop view is laid out at 1280 px and zoomed to fit.
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const measure = () => setScale(Math.min(1, (el.clientWidth - 48) / DEVICE_WIDTH[device]));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [device]);

  const setPage = (fn: (p: SitePage) => SitePage, key?: string) => update((d) => ({ ...d, pages: d.pages.map((p) => (p.id === page.id ? fn(p) : p)) }), key);

  function scrollTo(id: string) {
    window.requestAnimationFrame(() => canvas.current?.querySelector(`[data-section-id="${id}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
  const select = (id: string) => {
    setSelected(id);
    setTab("secciones");
  };
  const action = (id: string, a: SectionAction) => {
    const i = page.sections.findIndex((x) => x.id === id);
    if (a === "add") {
      setLibrary({ at: i < 0 ? page.sections.length : i + 1 });
      return;
    }
    if (i < 0) return;
    if (a === "up" || a === "down") {
      const j = a === "up" ? i - 1 : i + 1;
      if (j < 0 || j >= page.sections.length) return;
      setPage((p) => {
        const sections = [...p.sections];
        [sections[i], sections[j]] = [sections[j]!, sections[i]!];
        return { ...p, sections };
      });
      scrollTo(id);
    } else if (a === "duplicate") {
      const copy = { ...structuredClone(page.sections[i]!), id: uid() };
      if (SECTIONS[copy.type].single) {
        setNotice("Esta sección va una sola vez por página.");
        return;
      }
      setPage((p) => ({ ...p, sections: [...p.sections.slice(0, i + 1), copy, ...p.sections.slice(i + 1)] }));
      setSelected(copy.id);
      scrollTo(copy.id);
    } else if (a === "hide") {
      setPage((p) => ({ ...p, sections: p.sections.map((x) => (x.id === id ? { ...x, hidden: !x.hidden || undefined } : x)) }));
    } else if (a === "delete") {
      setPage((p) => ({ ...p, sections: p.sections.filter((x) => x.id !== id) }));
      if (selected === id) setSelected(null);
      setNotice("Sección eliminada. Podés recuperarla con Deshacer.");
    }
  };
  const addSection = (type: SectionType) => {
    const at = library?.at ?? page.sections.length;
    const x = newSection(type);
    setPage((p) => ({ ...p, sections: [...p.sections.slice(0, at), x, ...p.sections.slice(at)] }));
    setLibrary(null);
    setSelected(x.id);
    setTab("secciones");
    scrollTo(x.id);
  };
  const navigate = (slug: string, q = "") => {
    const target = doc.pages.find((p) => p.slug === slug);
    if (!target) return;
    setPageId(target.id);
    setSelected(null);
    setQuery(q);
    canvas.current?.scrollTo({ top: 0 });
  };

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(t);
  }, [notice]);

  async function patchAgency(patch: Record<string, unknown>) {
    try {
      if (Object.keys(patch).length) await api("/api/panel", { method: "PATCH", body: JSON.stringify(patch) });
      const fresh = await api<Loaded>("/api/panel/sitio");
      setData({ ...fresh, draft: data.draft });
      setNotice(patch.sitePublished === false ? "Sitio despublicado." : "Guardado.");
      return true;
    } catch (e) {
      setNotice(errorText(e, "No pudimos guardar."));
      return false;
    }
  }

  async function publish() {
    setPublishing(true);
    try {
      if (!(await flush())) return;
      if (!data.agency.slug) {
        setTab("ajustes");
        setNotice("Elegí la dirección de tu sitio en Ajustes → Identidad para publicarlo.");
        return;
      }
      const r = await api<EditorState & { sitePublished: boolean }>("/api/panel/sitio", { method: "POST", body: JSON.stringify({ action: "publish" }) });
      setData({ ...data, ...r, agency: { ...data.agency, sitePublished: true } });
      setNotice("¡Tu sitio está publicado!");
    } catch (e) {
      setNotice(errorText(e, "No pudimos publicar."));
    } finally {
      setPublishing(false);
    }
  }
  async function discard() {
    if (!window.confirm("¿Descartar los cambios sin publicar y volver a la versión publicada?")) return;
    try {
      const r = await api<EditorState>("/api/panel/sitio", { method: "POST", body: JSON.stringify({ action: "discard" }) });
      setData({ ...data, ...r });
      if (r.draft) {
        docRef.current = r.draft;
        setDoc(r.draft);
        setPast([]);
        setFuture([]);
        version.current = savedVersion.current;
        setSave("saved");
        setPageId(r.draft.pages[0]!.id);
        setSelected(null);
      }
      setNotice("Volviste a la versión publicada.");
    } catch (e) {
      setNotice(errorText(e, "No pudimos descartar."));
    }
  }

  const liveUrl = data.agency.slug ? `/inmobiliaria/${data.agency.slug}${page.slug ? `/${page.slug}` : ""}` : null;
  const pending = data.pending || save !== "saved";
  const width = DEVICE_WIDTH[device];
  const zoom = scale;

  const tabs: [Tab, string, typeof LayoutTemplate][] = [
    ["secciones", "Secciones", LayoutTemplate],
    ["paginas", "Páginas", FileText],
    ["diseno", "Diseño", Paintbrush],
    ["ajustes", "Ajustes", Settings],
    ["consultas", "Consultas", Inbox],
  ];

  return (
    <div className={cx(b.builder, mobileView === "edit" ? b.mEdit : b.mPreview)}>
      <header className={b.top}>
        <Link href="/panel" className={b.backLink} title="Volver al panel">
          <ArrowLeft size={18} aria-hidden="true" />
          <span>Panel</span>
        </Link>
        <div className={b.pageSelect}>
          <select aria-label="Página" value={page.id} onChange={(e) => navigate(doc.pages.find((p) => p.id === e.target.value)?.slug ?? "")}>
            {doc.pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </div>
        <div className={b.devices} role="group" aria-label="Dispositivo">
          {(
            [
              ["desktop", Monitor, "Computadora"],
              ["tablet", Tablet, "Tablet"],
              ["mobile", Smartphone, "Celular"],
            ] as const
          ).map(([d, Icon, l]) => (
            <button key={d} type="button" title={l} aria-label={l} aria-pressed={device === d} className={cx(device === d && b.on)} onClick={() => setDevice(d)}>
              <Icon size={17} aria-hidden="true" />
            </button>
          ))}
        </div>
        <div className={b.history}>
          <button type="button" className={b.iconBtn} disabled={!past.length || readOnly} onClick={undo} title="Deshacer (Ctrl+Z)" aria-label="Deshacer">
            <Undo2 size={17} aria-hidden="true" />
          </button>
          <button type="button" className={b.iconBtn} disabled={!future.length || readOnly} onClick={redo} title="Rehacer (Ctrl+Shift+Z)" aria-label="Rehacer">
            <Redo2 size={17} aria-hidden="true" />
          </button>
        </div>
        <span className={cx(b.saveState, save === "error" && b.error)} role="status" title={saveError}>
          {readOnly
            ? "Solo lectura"
            : save === "saving"
              ? "Guardando…"
              : save === "dirty"
                ? "Cambios sin guardar"
                : save === "error"
                  ? "No se pudo guardar"
                  : data.pending
                    ? "Borrador guardado"
                    : data.agency.sitePublished
                      ? "Publicado"
                      : "Guardado"}
        </span>
        {save === "error" && (
          <button type="button" className={b.smallBtn} onClick={() => void flush()}>
            Reintentar
          </button>
        )}
        <div className={b.topEnd}>
          {data.pending && data.publishedAt && !readOnly && (
            <button type="button" className={b.ghostBtn} onClick={() => void discard()} title="Volver a la versión publicada">
              Descartar
            </button>
          )}
          <a className={b.ghostBtn} href={`/panel/sitio/vista-previa?pagina=${encodeURIComponent(page.slug)}`} target="_blank" rel="noopener">
            <Eye size={16} aria-hidden="true" /> <span>Vista previa</span>
          </a>
          {data.agency.sitePublished && liveUrl && (
            <a className={b.ghostBtn} href={liveUrl} target="_blank" rel="noopener">
              <ExternalLink size={16} aria-hidden="true" /> <span>Ver sitio</span>
            </a>
          )}
          <button type="button" className={b.primaryBtn} disabled={readOnly || publishing || (!pending && data.agency.sitePublished)} onClick={() => void publish()}>
            {publishing ? <Loader2 size={16} className={b.spin} aria-hidden="true" /> : null}
            {!pending && data.agency.sitePublished ? "Publicado" : data.agency.sitePublished ? "Publicar cambios" : "Publicar sitio"}
          </button>
        </div>
      </header>
      {notice && (
        <div className={b.toast} role="status">
          {notice}
        </div>
      )}
      {!data.ready && <div className={b.banner}>Para guardar el sitio falta aplicar la migración 202612120001_agency_site_builder.sql en Supabase.</div>}
      <div className={b.body}>
        <nav className={b.rail} aria-label="Herramientas del editor">
          {tabs.map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              className={cx(tab === id && b.on)}
              aria-pressed={tab === id}
              onClick={() => {
                setTab(id);
                if (id !== "secciones") setSelected(null);
                setMobileView("edit");
              }}
            >
              <Icon size={19} aria-hidden="true" />
              <span>{label}</span>
              {id === "consultas" && data.unread > 0 && <em className={b.dot}>{data.unread}</em>}
            </button>
          ))}
        </nav>
        <aside className={b.panel} aria-label="Edición">
          {tab === "secciones" && (section ? (
            <Inspector
              key={section.id}
              section={section}
              ctx={fieldCtx}
              onBack={() => setSelected(null)}
              onAction={(a) => action(section.id, a)}
              onChange={(k, v) => setPage((p) => ({ ...p, sections: p.sections.map((x) => (x.id === section.id ? { ...x, props: { ...x.props, [k]: v } } : x)) }), `${section.id}:${k}`)}
            />
          ) : (
            <>
              <div className={b.panelHead}>
                <h2 className={b.panelTitle}>{page.title}</h2>
                <small>{page.sections.length} secciones</small>
              </div>
              <SectionsPanel
                page={page}
                selected={selected}
                readOnly={readOnly}
                onSelect={(id) => {
                  select(id);
                  scrollTo(id);
                }}
                onAction={action}
                onMove={(from, to) =>
                  setPage((p) => {
                    const sections = [...p.sections];
                    const [x] = sections.splice(from, 1);
                    sections.splice(to, 0, x!);
                    return { ...p, sections };
                  })
                }
                onAdd={() => setLibrary({ at: page.sections.length })}
              />
            </>
          ))}
          {tab === "paginas" && (
            <>
              <div className={b.panelHead}>
                <h2 className={b.panelTitle}>Páginas</h2>
              </div>
              <PagesPanel doc={doc} current={page.id} readOnly={readOnly} update={update} onOpen={(id) => navigate(doc.pages.find((p) => p.id === id)?.slug ?? "")} />
            </>
          )}
          {tab === "diseno" && (
            <>
              <div className={b.panelHead}>
                <h2 className={b.panelTitle}>Diseño</h2>
              </div>
              <DesignPanel doc={doc} update={update} ctx={fieldCtx} />
            </>
          )}
          {tab === "ajustes" && (
            <>
              <div className={b.panelHead}>
                <h2 className={b.panelTitle}>Ajustes</h2>
              </div>
              <SettingsPanel doc={doc} update={update} ctx={fieldCtx} data={data} onAgency={patchAgency} onReset={onReset} />
            </>
          )}
          {tab === "consultas" && (
            <>
              <div className={b.panelHead}>
                <h2 className={b.panelTitle}>Consultas</h2>
              </div>
              <InquiriesPanel readOnly={readOnly} onUnread={(n) => n !== data.unread && setData({ ...data, unread: n })} />
            </>
          )}
        </aside>
        <div className={b.canvas} ref={canvas} onClick={(e) => e.target === e.currentTarget && setSelected(null)}>
          <div className={cx(b.frame, b[`f-${device}`])} style={{ width, zoom } as React.CSSProperties}>
            {device !== "desktop" && <div className={b.frameBar} aria-hidden="true" />}
            <SiteRenderer
              doc={doc}
              catalog={catalog}
              pageSlug={page.slug}
              mode="editor"
              query={query}
              editor={{ selected, onSelect: select, onAction: action, navigate }}
            />
          </div>
        </div>
      </div>
      <div className={b.mobileSwitch} role="group" aria-label="Vista">
        <button type="button" className={cx(mobileView === "edit" && b.on)} onClick={() => setMobileView("edit")}>
          Editar
        </button>
        <button type="button" className={cx(mobileView === "preview" && b.on)} onClick={() => setMobileView("preview")}>
          Ver sitio
        </button>
      </div>
      {library && <SectionLibrary page={page} onAdd={addSection} onClose={() => setLibrary(null)} />}
    </div>
  );
}

/* ───────────────── Entry ───────────────── */

export function SiteBuilder() {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<TemplateId | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [session, setSession] = useState(0);
  const load = useCallback(() => {
    setError("");
    api<Loaded>("/api/panel/sitio")
      .then(setData)
      .catch((e) => setError(errorText(e, "No pudimos cargar tu sitio.")));
  }, []);
  useEffect(load, [load]);
  // The editor takes the whole screen: habita's header and footer step aside.
  useEffect(() => {
    document.body.classList.add("site-builder-open");
    return () => document.body.classList.remove("site-builder-open");
  }, []);
  async function pick(t: TemplateId) {
    setBusy(t);
    try {
      const r = await api<EditorState>("/api/panel/sitio", { method: "PUT", body: JSON.stringify({ template: t }) });
      setData((d) => (d ? { ...d, ...r } : d));
      setChoosing(false);
      setSession((n) => n + 1);
    } catch (e) {
      setError(errorText(e, "No pudimos crear tu sitio."));
    } finally {
      setBusy(null);
    }
  }
  if (error && !data)
    return (
      <div className={b.center}>
        <p className={b.error}>{error}</p>
        <button type="button" className={b.primaryBtn} onClick={load}>
          Reintentar
        </button>
      </div>
    );
  if (!data)
    return (
      <div className={b.center}>
        <Loader2 size={22} className={b.spin} aria-hidden="true" /> Cargando tu sitio…
      </div>
    );
  const catalog = data.catalog ?? emptyCatalog(data.agency.name);
  if (!data.ready && !data.draft)
    return (
      <div className={b.center}>
        <p>El constructor de sitios necesita una actualización de la base de datos (migración 202612120001_agency_site_builder.sql). Avisale al equipo de habita.</p>
        <Link href="/panel" className={b.ghostBtn}>
          Volver al panel
        </Link>
      </div>
    );
  if (!data.draft || choosing)
    return (
      <div className={b.scroll}>
        <div className={b.topSimple}>
          <Link href="/panel" className={b.backLink}>
            <ArrowLeft size={18} aria-hidden="true" /> <span>Panel</span>
          </Link>
        </div>
        {error && <p className={b.error}>{error}</p>}
        <TemplatePicker seed={data.seed} catalog={catalog} busy={busy} onPick={(t) => void pick(t)} onCancel={data.draft ? () => setChoosing(false) : undefined} />
      </div>
    );
  return (
    <Editor
      key={session}
      data={data}
      initial={data.draft}
      setData={setData}
      onReset={() => {
        if (window.confirm("¿Elegir otra plantilla? Tu sitio actual se reemplaza por la plantilla nueva (lo publicado no cambia hasta que vuelvas a publicar).")) setChoosing(true);
      }}
    />
  );
}
