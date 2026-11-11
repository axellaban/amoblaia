"use client";
// The site editor's form controls, driven by the field lists of schema.ts:
// text, links to pages, images (upload, your properties, examples), lists.
import { useRef, useState } from "react";
import { ChevronDown, ChevronUp, ImagePlus, Link2, Loader2, Plus, Trash2, X } from "lucide-react";
import { api } from "@/components/admin-demos";
import { ICONS, type Field, type Props, type SiteDoc } from "@/lib/site/schema";
import { iconFor } from "./site-render";
import b from "./site-builder.module.css";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export type FieldCtx = {
  doc: SiteDoc;
  /** Covers of the agency's published properties, to reuse as images. */
  covers: string[];
  readOnly: boolean;
};

export const EXAMPLE_IMAGES = [
  "/ejemplos/living-modern.webp",
  "/ejemplos/living-luxury.webp",
  "/ejemplos/living-scandinavian.webp",
  "/ejemplos/living-farmhouse.webp",
  "/ejemplos/living-classic.webp",
  "/ejemplos/living-midcentury.webp",
  "/ejemplos/kitchen-modern.webp",
  "/ejemplos/kitchen-farmhouse.webp",
  "/ejemplos/dining-scandinavian.webp",
  "/ejemplos/dining-luxury.webp",
  "/ejemplos/bedroom-luxury.webp",
  "/ejemplos/bedroom-coastal.webp",
  "/ejemplos/office-classic.webp",
  "/ejemplos/living-before.webp",
];

export async function uploadImage(file: File, purpose: "photo" | "logo" = "photo") {
  const body = new FormData();
  body.set("image", file);
  body.set("purpose", purpose);
  const { url } = await api<{ url: string }>("/api/panel/sitio/imagenes", { method: "POST", body });
  return url;
}

export function ImageField({ value, onChange, ctx, label }: { value: string; onChange: (v: string) => void; ctx: FieldCtx; label: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");
  const input = useRef<HTMLInputElement>(null);
  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      onChange(await uploadImage(file));
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos subir la imagen.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  return (
    <div className={b.field}>
      <span className={b.label}>{label}</span>
      <div className={b.image}>
        <button type="button" className={b.imageThumb} onClick={() => setOpen(!open)} disabled={ctx.readOnly} aria-label={`Cambiar ${label.toLowerCase()}`}>
          {value ? <img src={value} alt="" /> : <ImagePlus size={22} aria-hidden="true" />}
        </button>
        <div className={b.imageActions}>
          <button type="button" className={b.smallBtn} disabled={ctx.readOnly || busy} onClick={() => input.current?.click()}>
            {busy ? <Loader2 size={14} className={b.spin} aria-hidden="true" /> : <ImagePlus size={14} aria-hidden="true" />} {busy ? "Subiendo…" : "Subir"}
          </button>
          <button type="button" className={b.smallBtn} disabled={ctx.readOnly} onClick={() => setOpen(!open)}>
            Elegir
          </button>
          {value && (
            <button type="button" className={b.iconBtn} disabled={ctx.readOnly} onClick={() => onChange("")} aria-label="Quitar imagen" title="Quitar">
              <X size={15} aria-hidden="true" />
            </button>
          )}
        </div>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => void pick(e.target.files?.[0])} />
      </div>
      {error && <p className={b.error}>{error}</p>}
      {open && (
        <div className={b.picker}>
          {ctx.covers.length > 0 && (
            <>
              <span className={b.pickerTitle}>De tus propiedades</span>
              <div className={b.pickerGrid}>
                {ctx.covers.slice(0, 24).map((src) => (
                  <button key={src} type="button" className={cx(value === src && b.on)} onClick={() => {
                    onChange(src);
                    setOpen(false);
                  }}>
                    <img src={src} alt="" loading="lazy" />
                  </button>
                ))}
              </div>
            </>
          )}
          <span className={b.pickerTitle}>Ambientes de ejemplo</span>
          <div className={b.pickerGrid}>
            {EXAMPLE_IMAGES.map((src) => (
              <button key={src} type="button" className={cx(value === src && b.on)} onClick={() => {
                    onChange(src);
                    setOpen(false);
                  }}>
                <img src={src} alt="" loading="lazy" />
              </button>
            ))}
          </div>
          <span className={b.pickerTitle}>Desde un enlace</span>
          <div className={b.inline}>
            <input value={url} placeholder="https://…" onChange={(e) => setUrl(e.target.value)} />
            <button type="button" className={b.smallBtn} disabled={!/^https:\/\/\S+$/.test(url)} onClick={() => {
                onChange(url);
                setUrl("");
                setOpen(false);
              }}>
              Usar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** A destination: a page of the site, WhatsApp, a section (#ancla) or any address. */
export function LinkField({ value, onChange, ctx, label }: { value: string; onChange: (v: string) => void; ctx: FieldCtx; label: string }) {
  const pages = ctx.doc.pages;
  const isPage = value.startsWith("/") && pages.some((p) => `/${p.slug}` === value.split("?")[0]);
  const mode = !value ? "" : isPage ? "page" : value.startsWith("wa:") ? "wa" : value.startsWith("#") ? "anchor" : "url";
  const anchors = [...new Set(pages.flatMap((p) => p.sections.map((x) => String(x.props.anchor ?? "")).filter(Boolean)))];
  return (
    <div className={b.field}>
      <span className={b.label}>{label}</span>
      <select
        disabled={ctx.readOnly}
        value={mode === "page" ? `page:${value}` : mode}
        onChange={(e) => {
          const v = e.target.value;
          if (v.startsWith("page:")) onChange(v.slice(5));
          else if (v === "wa") onChange("wa:");
          else if (v === "anchor") onChange(`#${anchors[0] ?? "contacto"}`);
          else if (v === "url") onChange("https://");
          else onChange("");
        }}
      >
        <option value="">Sin enlace</option>
        <optgroup label="Páginas del sitio">
          {pages.map((p) => (
            <option key={p.id} value={`page:/${p.slug}`}>
              {p.title}
            </option>
          ))}
        </optgroup>
        <option value="wa">WhatsApp de la inmobiliaria</option>
        <option value="anchor">Una sección (#ancla)</option>
        <option value="url">Otra dirección</option>
      </select>
      {(mode === "url" || mode === "anchor") && (
        <span className={b.inline}>
          <Link2 size={15} aria-hidden="true" />
          <input disabled={ctx.readOnly} value={value} onChange={(e) => onChange(e.target.value)} placeholder={mode === "anchor" ? "#contacto" : "https://…"} />
        </span>
      )}
    </div>
  );
}

function ListField({ field, value, onChange, ctx }: { field: Extract<Field, { kind: "list" }>; value: Props[]; onChange: (v: Props[]) => void; ctx: FieldCtx }) {
  const [open, setOpen] = useState<number | null>(null);
  const move = (i: number, d: number) => {
    const next = [...value];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x!);
    onChange(next);
    setOpen(open === i ? i + d : open);
  };
  const blank = () => Object.fromEntries(field.fields.map((f) => [f.key, f.kind === "number" ? f.max : f.kind === "toggle" ? false : f.kind === "icon" ? "home" : ""]));
  return (
    <div className={b.field}>
      <span className={b.label}>
        {field.label} <small>({value.length})</small>
      </span>
      <ul className={b.items}>
        {value.map((item, i) => (
          <li key={i} className={cx(b.item, open === i && b.itemOpen)}>
            <div className={b.itemHead}>
              <button type="button" className={b.itemTitle} onClick={() => setOpen(open === i ? null : i)}>
                {String(item[field.titleKey] ?? "") || `${field.itemLabel} ${i + 1}`}
              </button>
              <button type="button" className={b.iconBtn} disabled={ctx.readOnly || i === 0} onClick={() => move(i, -1)} aria-label="Subir" title="Subir">
                <ChevronUp size={15} aria-hidden="true" />
              </button>
              <button type="button" className={b.iconBtn} disabled={ctx.readOnly || i === value.length - 1} onClick={() => move(i, 1)} aria-label="Bajar" title="Bajar">
                <ChevronDown size={15} aria-hidden="true" />
              </button>
              <button
                type="button"
                className={b.iconBtn}
                disabled={ctx.readOnly}
                onClick={() => {
                  onChange(value.filter((_, j) => j !== i));
                  setOpen(null);
                }}
                aria-label="Eliminar"
                title="Eliminar"
              >
                <Trash2 size={15} aria-hidden="true" />
              </button>
            </div>
            {open === i && (
              <div className={b.itemBody}>
                {field.fields.map((f) => (
                  <FieldEditor key={f.key} field={f} value={item[f.key]} ctx={ctx} onChange={(v) => onChange(value.map((x, j) => (j === i ? { ...x, [f.key]: v } : x)))} />
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
      {value.length < field.max && (
        <button
          type="button"
          className={b.addItem}
          disabled={ctx.readOnly}
          onClick={() => {
            onChange([...value, blank()]);
            setOpen(value.length);
          }}
        >
          <Plus size={15} aria-hidden="true" /> Agregar {field.itemLabel.toLowerCase()}
        </button>
      )}
    </div>
  );
}

export function FieldEditor({ field, value, onChange, ctx }: { field: Field; value: unknown; onChange: (v: unknown) => void; ctx: FieldCtx }) {
  const help = field.help && <small className={b.help}>{field.help}</small>;
  switch (field.kind) {
    case "text":
      return (
        <label className={b.field}>
          <span className={b.label}>{field.label}</span>
          <input disabled={ctx.readOnly} value={String(value ?? "")} maxLength={field.max} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />
          {help}
        </label>
      );
    case "textarea":
      return (
        <label className={b.field}>
          <span className={b.label}>{field.label}</span>
          <textarea disabled={ctx.readOnly} value={String(value ?? "")} maxLength={field.max} rows={field.rows ?? 3} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />
          {help}
        </label>
      );
    case "link":
      return <LinkField label={field.label} value={String(value ?? "")} onChange={onChange} ctx={ctx} />;
    case "image":
      return (
        <>
          <ImageField label={field.label} value={String(value ?? "")} onChange={onChange} ctx={ctx} />
          {help}
        </>
      );
    case "color":
      return (
        <label className={b.field}>
          <span className={b.label}>{field.label}</span>
          <span className={b.color}>
            <input type="color" disabled={ctx.readOnly} value={String(value ?? "#000000")} onChange={(e) => onChange(e.target.value)} />
            <code>{String(value ?? "")}</code>
          </span>
        </label>
      );
    case "select":
      return field.options.length <= 4 ? (
        <div className={b.field}>
          <span className={b.label}>{field.label}</span>
          <div className={b.segmented} role="group" aria-label={field.label}>
            {field.options.map(([v, l]) => (
              <button key={v} type="button" disabled={ctx.readOnly} className={cx(value === v && b.on)} onClick={() => onChange(v)}>
                {l}
              </button>
            ))}
          </div>
          {help}
        </div>
      ) : (
        <label className={b.field}>
          <span className={b.label}>{field.label}</span>
          <select disabled={ctx.readOnly} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
            {field.options.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          {help}
        </label>
      );
    case "toggle":
      return (
        <label className={b.toggle}>
          <input type="checkbox" disabled={ctx.readOnly} checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          <span className={b.switch} aria-hidden="true" />
          <span>{field.label}</span>
        </label>
      );
    case "number":
      return (
        <label className={b.field}>
          <span className={b.label}>
            {field.label} <small>{String(value ?? "")}{field.unit ?? ""}</small>
          </span>
          <input type="range" disabled={ctx.readOnly} min={field.min} max={field.max} step={field.step ?? 1} value={Number(value ?? field.min)} onChange={(e) => onChange(Number(e.target.value))} />
        </label>
      );
    case "icon":
      return (
        <div className={b.field}>
          <span className={b.label}>{field.label}</span>
          <div className={b.icons}>
            {ICONS.map(([id, label]) => {
              const Icon = iconFor(id);
              return (
                <button key={id} type="button" disabled={ctx.readOnly} title={label} aria-label={label} className={cx(value === id && b.on)} onClick={() => onChange(id)}>
                  <Icon size={17} aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </div>
      );
    case "list":
      return <ListField field={field} value={Array.isArray(value) ? (value as Props[]) : []} onChange={onChange} ctx={ctx} />;
  }
}
