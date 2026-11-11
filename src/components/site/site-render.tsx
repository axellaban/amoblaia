"use client";
// An agency's website as built in Panel → Sitio web. The same component
// renders the public site, the members' preview and the editor's live
// canvas (mode "editor": sections are selectable and links do not leave).
// Responsive by container queries, so the editor's phone and tablet views
// look exactly like the real thing.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDown,
  ArrowUp,
  Award,
  BarChart3,
  Building2,
  Calculator,
  Camera,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Eye,
  EyeOff,
  Facebook,
  FileText,
  Handshake,
  Heart,
  Home,
  Instagram,
  KeyRound,
  Landmark,
  Linkedin,
  Mail,
  Map as MapIcon,
  MapPin,
  Menu,
  MessageCircle,
  Music2,
  Phone,
  Plus,
  Quote,
  Scale,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trash2,
  Users,
  X,
  Youtube,
} from "lucide-react";
import type { PublicSite, SiteProperty } from "@/lib/agency/site";
import { fontsHref, fontStack } from "@/lib/site/fonts";
import {
  filterProperties,
  filtersFromQuery,
  KIND_LABELS,
  NO_FILTERS,
  OPERATION_LABELS,
  queryOf,
  type ListingFilters,
  type Operation,
  type PropertyKind,
} from "@/lib/site/listing";
import { inkOn, pagePath, SECTIONS, videoEmbed, waNumber, type IconId, type Props, type Section, type SiteDoc, type SitePage } from "@/lib/site/schema";
import s from "./site.module.css";

export type SiteMode = "public" | "preview" | "editor";
export type SectionAction = "up" | "down" | "duplicate" | "hide" | "delete" | "add";
export type EditorHooks = {
  selected: string | null;
  onSelect: (id: string) => void;
  onAction: (id: string, action: SectionAction) => void;
  navigate: (pageSlug: string, query?: string) => void;
};

type Ctx = {
  doc: SiteDoc;
  catalog: PublicSite;
  mode: SiteMode;
  page: SitePage | null;
  editor?: EditorHooks;
  /** The page with the catalog (listings), where searches go. */
  catalogSlug: string | null;
};

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown, d = 0) => (typeof v === "number" ? v : d);
const list = (v: unknown) => (Array.isArray(v) ? (v as Props[]) : []);

/* ───────────────── Links ───────────────── */

function pageHref(ctx: Ctx, slug: string, query = "") {
  if (ctx.mode === "preview") return `/panel/sitio/vista-previa?pagina=${encodeURIComponent(slug)}${query ? `&${query.slice(1)}` : ""}`;
  return `${pagePath(ctx.catalog.slug || "-", slug)}${query}`;
}
function whatsapp(ctx: Ctx, message?: string) {
  const n = waNumber(ctx.doc.settings.whatsapp) ?? ctx.catalog.whatsapp;
  if (!n) return null;
  const text = message || ctx.doc.settings.whatsappMessage || `Hola ${ctx.catalog.name}! Vi su sitio web y quiero hacer una consulta.`;
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}
type Resolved = { href: string; page?: string; query?: string; external?: boolean } | null;
function resolve(ctx: Ctx, to: string): Resolved {
  if (!to) return null;
  if (to.startsWith("wa:")) {
    const n = to.slice(3) ? waNumber(to.slice(3)) : null;
    const href = n ? `https://wa.me/${n}` : whatsapp(ctx);
    return href ? { href, external: true } : null;
  }
  if (to.startsWith("#")) return { href: to };
  if (to.startsWith("/")) {
    const [path, q] = to.split("?");
    const slug = path!.replace(/^\/+|\/+$/g, "");
    const query = q ? `?${q}` : "";
    return { href: pageHref(ctx, slug, query), page: slug, query };
  }
  return { href: to, external: /^https?:/.test(to) };
}

function SLink({ ctx, to, className, children, label }: { ctx: Ctx; to: string; className?: string; children: React.ReactNode; label?: string }) {
  const r = resolve(ctx, to);
  if (!r) return null;
  return (
    <a
      href={r.href}
      className={className}
      aria-label={label}
      {...(r.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      onClick={(e) => {
        if (ctx.mode !== "editor") return;
        e.preventDefault();
        if (r.page !== undefined) ctx.editor?.navigate(r.page, r.query);
      }}
    >
      {children}
    </a>
  );
}

function Buttons({ ctx, p, center }: { ctx: Ctx; p: Props; center?: boolean }) {
  const one = str(p.buttonLabel) && resolve(ctx, str(p.buttonLink));
  const two = str(p.secondLabel) && resolve(ctx, str(p.secondLink));
  if (!one && !two) return null;
  return (
    <div className={cx(s.buttons, center && s.center)}>
      {one && (
        <SLink ctx={ctx} to={str(p.buttonLink)} className={s.btn}>
          {str(p.buttonLabel)}
        </SLink>
      )}
      {two && (
        <SLink ctx={ctx} to={str(p.secondLink)} className={cx(s.btn, s.btnGhost)}>
          {str(p.secondLink).startsWith("wa:") && <MessageCircle size={17} aria-hidden="true" />}
          {str(p.secondLabel)}
        </SLink>
      )}
    </div>
  );
}

/** Paragraphs separated by a blank line; **bold**. Never HTML. */
function RichText({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/\n\s*\n/)
        .filter((x) => x.trim())
        .map((para, i) => (
          <p key={i}>
            {para.split("\n").map((line, j) => (
              <span key={j}>
                {j > 0 && <br />}
                {line.split(/(\*\*[^*]+\*\*)/).map((part, k) => (part.startsWith("**") && part.endsWith("**") ? <strong key={k}>{part.slice(2, -2)}</strong> : part))}
              </span>
            ))}
          </p>
        ))}
    </>
  );
}

function Heading({ p, center, as = "h2" }: { p: Props; center?: boolean; as?: "h1" | "h2" }) {
  const H = as;
  if (!str(p.eyebrow) && !str(p.title) && !str(p.subtitle)) return null;
  return (
    <header className={cx(s.heading, center && s.center)}>
      {str(p.eyebrow) && <span className={s.eyebrow}>{str(p.eyebrow)}</span>}
      {str(p.title) && <H className={s.title}>{str(p.title)}</H>}
      {str(p.subtitle) && <p className={s.subtitle}>{str(p.subtitle)}</p>}
    </header>
  );
}

const ICON: Record<IconId, typeof Home> = {
  home: Home,
  building: Building2,
  key: KeyRound,
  search: Search,
  handshake: Handshake,
  chart: BarChart3,
  shield: ShieldCheck,
  camera: Camera,
  sparkles: Sparkles,
  map: MapIcon,
  phone: Phone,
  file: FileText,
  calculator: Calculator,
  users: Users,
  star: Star,
  heart: Heart,
  clock: Clock,
  award: Award,
  landmark: Landmark,
  scale: Scale,
};
export const iconFor = (id: string) => ICON[id as IconId] ?? Home;

/* ───────────────── Properties ───────────────── */

function propertyHref(ctx: Ctx, token: string) {
  return ctx.mode === "public" ? `/inmobiliaria/${ctx.catalog.slug}/${token}` : `/demo/${token}`;
}

function PropertyCard({ ctx, p }: { ctx: Ctx; p: SiteProperty }) {
  return (
    <a
      href={propertyHref(ctx, p.token)}
      className={s.card}
      onClick={(e) => ctx.mode === "editor" && e.preventDefault()}
      {...(ctx.mode === "preview" ? { target: "_blank", rel: "noopener" } : {})}
    >
      <span className={s.cardPhoto}>
        {p.cover ? <img src={p.cover} alt="" loading="lazy" /> : <span className={s.cardNoPhoto}><Home size={28} aria-hidden="true" /></span>}
        {p.operation && <span className={s.cardOp}>{p.operation}</span>}
        {p.staged && (
          <span className={s.cardTag}>
            <Sparkles size={12} aria-hidden="true" /> Ambientación IA
          </span>
        )}
      </span>
      <span className={s.cardBody}>
        <span className={s.cardPrice}>{p.price ?? "Consultar precio"}</span>
        <strong className={s.cardTitle}>{p.title}</strong>
        {p.location && (
          <span className={s.cardLoc}>
            <MapPin size={14} aria-hidden="true" /> {p.location}
          </span>
        )}
        {p.features && <span className={s.cardFeat}>{p.features}</span>}
      </span>
    </a>
  );
}

function EmptyCatalog({ ctx }: { ctx: Ctx }) {
  return (
    <p className={s.empty}>
      {ctx.mode === "editor"
        ? "Acá van a aparecer tus propiedades publicadas. Publicá fichas desde «Propiedades» y se suman solas."
        : "Pronto vas a ver acá nuestras propiedades."}
    </p>
  );
}

function SearchBar({ ctx, compact }: { ctx: Ctx; compact?: boolean }) {
  const [op, setOp] = useState<Operation | "">("");
  const [kind, setKind] = useState<PropertyKind | "">("");
  const [q, setQ] = useState("");
  const ops = useMemo(() => {
    const found = new Set(ctx.catalog.properties.map((p) => p.operation?.toLowerCase() ?? ""));
    const all = Object.keys(OPERATION_LABELS) as Operation[];
    const present = all.filter((o) => [...found].some((f) => f.includes(o === "temporario" ? "tempor" : o)));
    return present.length ? present : (["venta", "alquiler"] as Operation[]);
  }, [ctx.catalog.properties]);
  function go(e: React.FormEvent) {
    e.preventDefault();
    const query = queryOf({ q: q.trim(), op, kind });
    const slug = ctx.catalogSlug ?? "";
    if (ctx.mode === "editor") return ctx.editor?.navigate(slug, query);
    window.location.href = pageHref(ctx, slug, query);
  }
  return (
    <form className={cx(s.search, compact && s.searchCompact)} onSubmit={go} role="search">
      <div className={s.searchTabs} role="group" aria-label="Operación">
        <button type="button" className={cx(!op && s.on)} onClick={() => setOp("")}>
          Todas
        </button>
        {ops.map((o) => (
          <button key={o} type="button" className={cx(op === o && s.on)} onClick={() => setOp(o)}>
            {OPERATION_LABELS[o]}
          </button>
        ))}
      </div>
      <div className={s.searchRow}>
        <label className={s.searchField}>
          <span>Tipo</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as PropertyKind | "")}>
            <option value="">Todos</option>
            {(Object.keys(KIND_LABELS) as PropertyKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label className={cx(s.searchField, s.searchGrow)}>
          <span>Ubicación o palabra clave</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Barrio, ciudad, ambientes…" />
        </label>
        <button className={cx(s.btn, s.searchGo)}>
          <Search size={18} aria-hidden="true" /> Buscar
        </button>
      </div>
    </form>
  );
}

/* ───────────────── Sections ───────────────── */

function Hero({ ctx, p, first }: { ctx: Ctx; p: Props; first: boolean }) {
  const variant = str(p.variant) || "image";
  const fallback = ctx.catalog.properties.find((x) => x.cover && x.staged)?.cover ?? ctx.catalog.properties.find((x) => x.cover)?.cover ?? "/ejemplos/living-modern.webp";
  const image = str(p.image) || fallback;
  const center = str(p.align) === "center";
  const content = (
    <div className={cx(s.heroText, center && s.center)}>
      {str(p.eyebrow) && <span className={s.eyebrow}>{str(p.eyebrow)}</span>}
      {first ? <h1 className={s.heroTitle}>{str(p.title)}</h1> : <h2 className={s.heroTitle}>{str(p.title)}</h2>}
      {str(p.subtitle) && <p className={s.heroSub}>{str(p.subtitle)}</p>}
      <Buttons ctx={ctx} p={p} center={center} />
      {p.search === true && <SearchBar ctx={ctx} />}
    </div>
  );
  if (variant === "split")
    return (
      <div className={cx(s.wrap, s.heroSplit, s[`h-${str(p.height)}`])}>
        {content}
        <div className={s.heroSplitImg}>
          <img src={image} alt="" />
        </div>
      </div>
    );
  if (variant === "minimal") return <div className={cx(s.wrap, s.heroMinimal, s[`h-${str(p.height)}`])}>{content}</div>;
  return (
    <div className={cx(s.heroImage, s[`h-${str(p.height)}`])} style={{ "--ov": num(p.overlay, 45) / 100 } as React.CSSProperties}>
      <img className={s.heroBg} src={image} alt="" />
      <div className={cx(s.wrap, s.heroInner, center && s.heroCenter)}>{content}</div>
    </div>
  );
}

function SearchSection({ ctx, p }: { ctx: Ctx; p: Props }) {
  const center = str(p.align) === "center";
  return (
    <div className={s.wrap}>
      <Heading p={p} center={center} />
      <div className={cx(s.searchStandalone, center && s.center)}>
        <SearchBar ctx={ctx} compact />
      </div>
    </div>
  );
}

function Featured({ ctx, p }: { ctx: Ctx; p: Props }) {
  const op = str(p.operation) as Operation | "";
  const items = filterProperties(
    ctx.catalog.properties.filter((x) => p.onlyStaged !== true || x.staged),
    { ...NO_FILTERS, op },
  ).slice(0, num(p.count, 6));
  const rail = useRef<HTMLDivElement>(null);
  const scroll = (dir: number) => rail.current?.scrollBy({ left: dir * rail.current.clientWidth * 0.8, behavior: "smooth" });
  const carousel = str(p.layout) === "carousel";
  return (
    <div className={s.wrap}>
      <div className={s.rowHead}>
        <Heading p={p} />
        {carousel && items.length > 1 && (
          <div className={s.arrows}>
            <button type="button" aria-label="Anteriores" onClick={() => scroll(-1)}>
              <ChevronLeft size={20} aria-hidden="true" />
            </button>
            <button type="button" aria-label="Siguientes" onClick={() => scroll(1)}>
              <ChevronRight size={20} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
      {items.length ? (
        carousel ? (
          <div className={s.rail} ref={rail}>
            {items.map((x) => (
              <div key={x.token} className={s.railItem}>
                <PropertyCard ctx={ctx} p={x} />
              </div>
            ))}
          </div>
        ) : (
          <div className={cx(s.grid, s.cols3)}>
            {items.map((x) => (
              <PropertyCard key={x.token} ctx={ctx} p={x} />
            ))}
          </div>
        )
      ) : (
        <EmptyCatalog ctx={ctx} />
      )}
      {items.length > 0 && <Buttons ctx={ctx} p={p} center />}
    </div>
  );
}

function Listings({ ctx, p, query }: { ctx: Ctx; p: Props; query: string }) {
  const fixedOp = str(p.operation) as Operation | "";
  const [f, setF] = useState<ListingFilters>(() => ({ ...filtersFromQuery(new URLSearchParams(query)), ...(fixedOp ? { op: fixedOp } : {}) }));
  const [pageN, setPageN] = useState(1);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setF({ ...filtersFromQuery(new URLSearchParams(query)), ...(fixedOp ? { op: fixedOp } : {}) });
    setPageN(1);
  }, [query, fixedOp]);
  const all = ctx.catalog.properties;
  const found = useMemo(() => filterProperties(all, f), [all, f]);
  const per = num(p.perPage, 12);
  const shown = found.slice(0, pageN * per);
  const set = (patch: Partial<ListingFilters>) => {
    setF((prev) => ({ ...prev, ...patch }));
    setPageN(1);
  };
  const active = Boolean(f.q || (!fixedOp && f.op) || f.kind || f.rooms || f.min !== null || f.max !== null);
  const money = (v: string) => {
    const n = Number(v.replace(/\D/g, ""));
    return v.trim() && Number.isFinite(n) ? n : null;
  };
  return (
    <div className={s.wrap}>
      <Heading p={p} as={ctx.page?.sections[0]?.type === "listings" ? "h1" : "h2"} />
      {p.filters !== false && (
        <div className={s.filters}>
          <label className={cx(s.filterSearch)}>
            <Search size={17} aria-hidden="true" />
            <input type="search" value={f.q} placeholder="Buscar por barrio, calle, ambientes…" aria-label="Buscar propiedades" onChange={(e) => set({ q: e.target.value })} />
          </label>
          <button type="button" className={s.filterToggle} aria-expanded={open} onClick={() => setOpen(!open)}>
            <SlidersHorizontal size={17} aria-hidden="true" /> Filtros
          </button>
          <div className={cx(s.filterMore, open && s.filterOpen)}>
            {!fixedOp && (
              <select aria-label="Operación" value={f.op} onChange={(e) => set({ op: e.target.value as Operation | "" })}>
                <option value="">Operación</option>
                {(Object.keys(OPERATION_LABELS) as Operation[]).map((o) => (
                  <option key={o} value={o}>
                    {OPERATION_LABELS[o]}
                  </option>
                ))}
              </select>
            )}
            <select aria-label="Tipo de propiedad" value={f.kind} onChange={(e) => set({ kind: e.target.value as PropertyKind | "" })}>
              <option value="">Tipo</option>
              {(Object.keys(KIND_LABELS) as PropertyKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
            <select aria-label="Ambientes" value={f.rooms} onChange={(e) => set({ rooms: Number(e.target.value) })}>
              <option value={0}>Ambientes</option>
              <option value={1}>1 ambiente</option>
              <option value={2}>2 ambientes</option>
              <option value={3}>3 ambientes</option>
              <option value={4}>4 o más</option>
            </select>
            <select aria-label="Moneda" value={f.currency} onChange={(e) => set({ currency: e.target.value as ListingFilters["currency"] })}>
              <option value="">Moneda</option>
              <option value="USD">US$</option>
              <option value="ARS">$</option>
            </select>
            <input inputMode="numeric" aria-label="Precio desde" placeholder="Desde" value={f.min ?? ""} onChange={(e) => set({ min: money(e.target.value) })} />
            <input inputMode="numeric" aria-label="Precio hasta" placeholder="Hasta" value={f.max ?? ""} onChange={(e) => set({ max: money(e.target.value) })} />
            <select aria-label="Ordenar" value={f.sort} onChange={(e) => set({ sort: e.target.value as ListingFilters["sort"] })}>
              <option value="recent">Más recientes</option>
              <option value="price-asc">Menor precio</option>
              <option value="price-desc">Mayor precio</option>
            </select>
          </div>
        </div>
      )}
      <div className={s.resultsLine}>
        <span>
          {found.length} {found.length === 1 ? "propiedad" : "propiedades"}
        </span>
        {active && (
          <button type="button" className={s.linkBtn} onClick={() => set({ ...NO_FILTERS, op: fixedOp })}>
            <X size={14} aria-hidden="true" /> Limpiar filtros
          </button>
        )}
      </div>
      {shown.length ? (
        <div className={cx(s.grid, s[`cols${str(p.columns) || "3"}`])}>
          {shown.map((x) => (
            <PropertyCard key={x.token} ctx={ctx} p={x} />
          ))}
        </div>
      ) : all.length ? (
        <p className={s.empty}>Ninguna propiedad coincide con la búsqueda. Probá con menos filtros.</p>
      ) : (
        <EmptyCatalog ctx={ctx} />
      )}
      {shown.length < found.length && (
        <div className={cx(s.buttons, s.center)}>
          <button type="button" className={cx(s.btn, s.btnGhost)} onClick={() => setPageN(pageN + 1)}>
            Ver más propiedades
          </button>
        </div>
      )}
      {all.some((x) => x.staged) && <p className={s.fine}>Las ambientaciones con IA son ilustrativas: muestran cómo podría verse cada espacio. La foto original siempre está en cada ficha.</p>}
    </div>
  );
}

function About({ ctx, p }: { ctx: Ctx; p: Props }) {
  const image = str(p.image);
  return (
    <div className={cx(s.wrap, s.split, image && str(p.imageSide) === "left" && s.splitReverse, !image && s.splitSolo)}>
      <div className={s.splitText}>
        <Heading p={p} />
        <div className={s.prose}>
          <RichText text={str(p.body)} />
        </div>
        {list(p.points).length > 0 && (
          <ul className={s.checks}>
            {list(p.points).map((x, i) => (
              <li key={i}>{str(x.text)}</li>
            ))}
          </ul>
        )}
        <Buttons ctx={ctx} p={p} />
      </div>
      {image && (
        <div className={s.splitImg}>
          <img src={image} alt="" loading="lazy" />
        </div>
      )}
    </div>
  );
}

function Services({ ctx, p }: { ctx: Ctx; p: Props }) {
  return (
    <div className={s.wrap}>
      <Heading p={p} center />
      <div className={cx(s.grid, s[`cols${str(p.columns) || "3"}`])}>
        {list(p.items).map((x, i) => {
          const Icon = iconFor(str(x.icon));
          const body = (
            <>
              <span className={s.iconBox}>
                <Icon size={24} aria-hidden="true" />
              </span>
              <strong>{str(x.title)}</strong>
              {str(x.text) && <span>{str(x.text)}</span>}
            </>
          );
          return str(x.link) && resolve(ctx, str(x.link)) ? (
            <SLink key={i} ctx={ctx} to={str(x.link)} className={cx(s.tile, s.tileLink)}>
              {body}
            </SLink>
          ) : (
            <div key={i} className={s.tile}>
              {body}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stats({ p }: { p: Props }) {
  return (
    <div className={s.wrap}>
      <Heading p={p} center />
      <dl className={s.stats}>
        {list(p.items).map((x, i) => (
          <div key={i}>
            <dt>{str(x.value)}</dt>
            <dd>{str(x.label)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Steps({ p }: { p: Props }) {
  return (
    <div className={s.wrap}>
      <Heading p={p} center />
      <ol className={s.steps}>
        {list(p.items).map((x, i) => (
          <li key={i}>
            <span className={s.stepN}>{i + 1}</span>
            <strong>{str(x.title)}</strong>
            <span>{str(x.text)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Testimonials({ p }: { p: Props }) {
  return (
    <div className={s.wrap}>
      <Heading p={p} center />
      <div className={cx(s.grid, s.cols3)}>
        {list(p.items).map((x, i) => (
          <figure key={i} className={s.quote}>
            <Quote size={26} aria-hidden="true" className={s.quoteMark} />
            {num(x.rating) > 0 && (
              <span className={s.stars} aria-label={`${num(x.rating)} de 5 estrellas`}>
                {Array.from({ length: num(x.rating) }, (_, k) => (
                  <Star key={k} size={15} aria-hidden="true" fill="currentColor" />
                ))}
              </span>
            )}
            <blockquote>{str(x.quote)}</blockquote>
            <figcaption>
              <strong>{str(x.name)}</strong>
              {str(x.role) && <span>{str(x.role)}</span>}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

function Team({ p }: { p: Props }) {
  return (
    <div className={s.wrap}>
      <Heading p={p} center />
      <div className={cx(s.grid, s.cols4)}>
        {list(p.items).map((x, i) => {
          const wa = waNumber(str(x.whatsapp));
          return (
            <div key={i} className={s.person}>
              <span className={s.avatar}>{str(x.photo) ? <img src={str(x.photo)} alt="" loading="lazy" /> : <span>{initials(str(x.name))}</span>}</span>
              <strong>{str(x.name)}</strong>
              {str(x.role) && <span className={s.personRole}>{str(x.role)}</span>}
              {str(x.license) && <span className={s.personLic}>{str(x.license)}</span>}
              <span className={s.personLinks}>
                {wa && (
                  <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp de ${str(x.name)}`}>
                    <MessageCircle size={17} aria-hidden="true" />
                  </a>
                )}
                {str(x.email) && (
                  <a href={`mailto:${str(x.email)}`} aria-label={`Email de ${str(x.name)}`}>
                    <Mail size={17} aria-hidden="true" />
                  </a>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Zones({ ctx, p }: { ctx: Ctx; p: Props }) {
  return (
    <div className={s.wrap}>
      <Heading p={p} center />
      <div className={cx(s.grid, s.cols3)}>
        {list(p.items).map((x, i) => (
          <SLink key={i} ctx={ctx} to={`/${ctx.catalogSlug ?? ""}${queryOf({ q: str(x.query) || str(x.name) })}`} className={s.zone}>
            {str(x.image) && <img src={str(x.image)} alt="" loading="lazy" />}
            <span>{str(x.name)}</span>
          </SLink>
        ))}
      </div>
    </div>
  );
}

function Cta({ ctx, p }: { ctx: Ctx; p: Props }) {
  const center = str(p.align) !== "left";
  const image = str(p.image);
  return (
    <div className={s.wrap}>
      <div className={cx(s.cta, image && s.ctaImage, center && s.center)}>
        {image && <img className={s.heroBg} src={image} alt="" loading="lazy" />}
        <div className={s.ctaInner}>
          <Heading p={p} center={center} />
          <Buttons ctx={ctx} p={p} center={center} />
        </div>
      </div>
    </div>
  );
}

/* ───────────────── Forms ───────────────── */

type FormKind = "contacto" | "tasacion" | "newsletter";
function useInquiry(ctx: Ctx, kind: FormKind) {
  const started = useRef(0);
  useEffect(() => {
    started.current = Date.now();
  }, []);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");
  async function send(form: HTMLFormElement) {
    if (ctx.mode !== "public") {
      setState("error");
      setError("Vista previa: los formularios se activan cuando publicás el sitio.");
      return;
    }
    const data = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
    const { name, email, phone, message, empresa, ...details } = data;
    setState("sending");
    setError("");
    try {
      const res = await fetch("/api/sitio/consulta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: ctx.catalog.slug, kind, name, email, phone, message, empresa, details, page: ctx.page?.slug ?? "", t: started.current }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error || "No pudimos enviar la consulta.");
      setState("sent");
      form.reset();
    } catch (e) {
      setState("error");
      setError(e instanceof Error ? e.message : "No pudimos enviar la consulta.");
    }
  }
  return { state, error, send };
}

function Honeypot() {
  return (
    <label className={s.hp} aria-hidden="true">
      Empresa
      <input name="empresa" tabIndex={-1} autoComplete="off" />
    </label>
  );
}

function FormStatus({ ctx, state, error, success }: { ctx: Ctx; state: string; error: string; success: string }) {
  const wa = whatsapp(ctx);
  if (state === "sent")
    return (
      <div className={s.formOk} role="status">
        <p>{success}</p>
        {wa && (
          <a href={wa} target="_blank" rel="noopener noreferrer" className={cx(s.btn, s.btnGhost)}>
            <MessageCircle size={17} aria-hidden="true" /> También por WhatsApp
          </a>
        )}
      </div>
    );
  return error ? (
    <p className={s.formError} role="alert">
      {error}
    </p>
  ) : null;
}

function ContactInfo({ ctx }: { ctx: Ctx }) {
  const st = ctx.doc.settings;
  const wa = whatsapp(ctx);
  return (
    <ul className={s.info}>
      {wa && (
        <li>
          <MessageCircle size={18} aria-hidden="true" />
          <a href={wa} target="_blank" rel="noopener noreferrer">
            {st.whatsapp || "WhatsApp"}
          </a>
        </li>
      )}
      {st.phone && (
        <li>
          <Phone size={18} aria-hidden="true" />
          <a href={`tel:${st.phone.replace(/[^\d+]/g, "")}`}>{st.phone}</a>
        </li>
      )}
      {st.email && (
        <li>
          <Mail size={18} aria-hidden="true" />
          <a href={`mailto:${st.email}`}>{st.email}</a>
        </li>
      )}
      {st.address && (
        <li>
          <MapPin size={18} aria-hidden="true" />
          <span>{st.address}</span>
        </li>
      )}
      {st.hours && (
        <li>
          <Clock size={18} aria-hidden="true" />
          <span>{st.hours}</span>
        </li>
      )}
    </ul>
  );
}

function MapFrame({ query, height }: { query: string; height: string }) {
  if (!query) return null;
  return (
    <div className={cx(s.map, s[`map-${height}`])}>
      <iframe title={`Mapa: ${query}`} src={`https://maps.google.com/maps?q=${encodeURIComponent(query)}&z=15&output=embed`} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
    </div>
  );
}

function Contact({ ctx, p }: { ctx: Ctx; p: Props }) {
  const { state, error, send } = useInquiry(ctx, "contacto");
  const showForm = p.form !== false;
  const showInfo = p.info !== false;
  return (
    <div className={s.wrap}>
      <div className={cx(s.contact, (!showForm || !showInfo) && s.contactOne)}>
        <div>
          <Heading p={p} />
          {showInfo && <ContactInfo ctx={ctx} />}
        </div>
        {showForm && (
          <form
            className={s.form}
            onSubmit={(e) => {
              e.preventDefault();
              void send(e.currentTarget);
            }}
          >
            <Honeypot />
            <label>
              Nombre
              <input name="name" required maxLength={120} autoComplete="name" />
            </label>
            <div className={s.formRow}>
              <label>
                Email
                <input name="email" type="email" maxLength={160} autoComplete="email" />
              </label>
              <label>
                Teléfono
                <input name="phone" type="tel" maxLength={40} autoComplete="tel" />
              </label>
            </div>
            <label>
              Mensaje
              <textarea name="message" rows={4} maxLength={3000} />
            </label>
            <button className={s.btn} disabled={state === "sending"}>
              {state === "sending" ? "Enviando…" : str(p.submitLabel) || "Enviar"}
            </button>
            <FormStatus ctx={ctx} state={state} error={error} success={str(p.success)} />
          </form>
        )}
      </div>
      {p.map === true && <MapFrame query={ctx.doc.settings.address} height="m" />}
    </div>
  );
}

function Valuation({ ctx, p }: { ctx: Ctx; p: Props }) {
  const { state, error, send } = useInquiry(ctx, "tasacion");
  return (
    <div className={s.wrap}>
      <div className={s.contact}>
        <div>
          <Heading p={p} />
          {list(p.points).length > 0 && (
            <ul className={s.checks}>
              {list(p.points).map((x, i) => (
                <li key={i}>{str(x.text)}</li>
              ))}
            </ul>
          )}
        </div>
        <form
          className={s.form}
          onSubmit={(e) => {
            e.preventDefault();
            void send(e.currentTarget);
          }}
        >
          <Honeypot />
          <div className={s.formRow}>
            <label>
              Operación
              <select name="operacion" defaultValue="venta">
                <option value="venta">Quiero vender</option>
                <option value="alquiler">Quiero alquilar</option>
                <option value="ambas">Todavía no sé</option>
              </select>
            </label>
            <label>
              Tipo
              <select name="tipo" defaultValue="departamento">
                {(Object.keys(KIND_LABELS) as PropertyKind[]).map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Dirección o barrio
            <input name="direccion" required maxLength={200} />
          </label>
          <div className={s.formRow}>
            <label>
              Ambientes
              <input name="ambientes" inputMode="numeric" maxLength={3} />
            </label>
            <label>
              Superficie (m²)
              <input name="superficie" inputMode="numeric" maxLength={6} />
            </label>
          </div>
          <label>
            Nombre
            <input name="name" required maxLength={120} autoComplete="name" />
          </label>
          <div className={s.formRow}>
            <label>
              Teléfono
              <input name="phone" type="tel" maxLength={40} autoComplete="tel" />
            </label>
            <label>
              Email
              <input name="email" type="email" maxLength={160} autoComplete="email" />
            </label>
          </div>
          <label>
            Comentarios
            <textarea name="message" rows={3} maxLength={3000} />
          </label>
          <button className={s.btn} disabled={state === "sending"}>
            {state === "sending" ? "Enviando…" : str(p.submitLabel) || "Pedir tasación"}
          </button>
          <FormStatus ctx={ctx} state={state} error={error} success={str(p.success)} />
        </form>
      </div>
    </div>
  );
}

function Newsletter({ ctx, p }: { ctx: Ctx; p: Props }) {
  const { state, error, send } = useInquiry(ctx, "newsletter");
  return (
    <div className={s.wrap}>
      <div className={s.newsletter}>
        <Heading p={p} />
        <form
          className={s.newsForm}
          onSubmit={(e) => {
            e.preventDefault();
            void send(e.currentTarget);
          }}
        >
          <Honeypot />
          <input name="email" type="email" required placeholder="tu@email.com" aria-label="Tu email" />
          <button className={s.btn} disabled={state === "sending"}>
            {state === "sending" ? "Enviando…" : str(p.submitLabel) || "Suscribirme"}
          </button>
        </form>
        <FormStatus ctx={ctx} state={state} error={error} success={str(p.success)} />
      </div>
    </div>
  );
}

/* ───────────────── Content ───────────────── */

function Faq({ p }: { p: Props }) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className={cx(s.wrap, s.narrow)}>
      <Heading p={p} center />
      <div className={s.faq}>
        {list(p.items).map((x, i) => (
          <div key={i} className={cx(s.faqItem, open === i && s.faqOpen)}>
            <button type="button" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
              <span>{str(x.q)}</span>
              <ChevronDown size={20} aria-hidden="true" />
            </button>
            {open === i && (
              <div className={s.prose}>
                <RichText text={str(x.a)} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function TextBlock({ ctx, p }: { ctx: Ctx; p: Props }) {
  const center = str(p.align) === "center";
  return (
    <div className={cx(s.wrap, s.narrow, center && s.center)}>
      <Heading p={p} center={center} />
      <div className={s.prose}>
        <RichText text={str(p.body)} />
      </div>
      <Buttons ctx={ctx} p={p} center={center} />
    </div>
  );
}

function Gallery({ p }: { p: Props }) {
  const items = list(p.items).filter((x) => str(x.image));
  const [zoom, setZoom] = useState<number | null>(null);
  return (
    <div className={s.wrap}>
      <Heading p={p} center />
      <div className={cx(s.grid, s[`cols${str(p.columns) || "3"}`])}>
        {items.map((x, i) => (
          <figure key={i} className={s.galleryItem}>
            <button type="button" onClick={() => setZoom(i)} aria-label={`Ampliar imagen ${i + 1}`}>
              <img src={str(x.image)} alt={str(x.caption)} loading="lazy" />
            </button>
            {str(x.caption) && <figcaption>{str(x.caption)}</figcaption>}
          </figure>
        ))}
      </div>
      {zoom !== null &&
        items[zoom] &&
        createPortal(
        <div className={s.lightbox} role="dialog" aria-modal="true" aria-label="Imagen ampliada" onClick={() => setZoom(null)}>
          <img src={str(items[zoom].image)} alt={str(items[zoom].caption)} />
          <button type="button" aria-label="Cerrar" onClick={() => setZoom(null)}>
            <X size={24} aria-hidden="true" />
          </button>
        </div>,
          document.body,
        )}
    </div>
  );
}

function Video({ ctx, p }: { ctx: Ctx; p: Props }) {
  const src = videoEmbed(str(p.url));
  return (
    <div className={cx(s.wrap, s.narrow)}>
      <Heading p={p} center />
      {src ? (
        <div className={s.video}>
          <iframe src={src} title={str(p.title) || "Video"} allow="accelerometer; encrypted-media; picture-in-picture; fullscreen" allowFullScreen loading="lazy" />
        </div>
      ) : (
        ctx.mode === "editor" && <p className={s.empty}>Pegá un enlace de YouTube o Vimeo en el panel de la sección.</p>
      )}
    </div>
  );
}

function Logos({ ctx, p }: { ctx: Ctx; p: Props }) {
  return (
    <div className={s.wrap}>
      <Heading p={p} center />
      <div className={s.logos}>
        {list(p.items).map((x, i) => {
          const body = str(x.image) ? <img src={str(x.image)} alt={str(x.name)} loading="lazy" /> : <span>{str(x.name)}</span>;
          return str(x.link) ? (
            <SLink key={i} ctx={ctx} to={str(x.link)} className={s.logo}>
              {body}
            </SLink>
          ) : (
            <span key={i} className={s.logo}>
              {body}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function BeforeAfter({ p }: { p: Props }) {
  const [pos, setPos] = useState(50);
  const before = str(p.before);
  const after = str(p.after);
  return (
    <div className={cx(s.wrap, s.narrow)}>
      <Heading p={p} center />
      {before && after && (
        <div className={s.compare} style={{ "--pos": `${pos}%` } as React.CSSProperties}>
          <img src={after} alt="Ambientado" />
          <img src={before} alt="Original" className={s.compareBefore} />
          <span className={s.compareLine} aria-hidden="true" />
          <span className={cx(s.compareTag, s.compareTagL)}>Antes</span>
          <span className={cx(s.compareTag, s.compareTagR)}>Después</span>
          <input type="range" min={0} max={100} value={pos} aria-label="Comparar antes y después" onChange={(e) => setPos(Number(e.target.value))} />
        </div>
      )}
      {str(p.note) && <p className={cx(s.fine, s.center)}>{str(p.note)}</p>}
    </div>
  );
}

function SectionBody({ ctx, section, first, query }: { ctx: Ctx; section: Section; first: boolean; query: string }) {
  const p = section.props;
  switch (section.type) {
    case "hero":
      return <Hero ctx={ctx} p={p} first={first} />;
    case "search":
      return <SearchSection ctx={ctx} p={p} />;
    case "featured":
      return <Featured ctx={ctx} p={p} />;
    case "listings":
      return <Listings ctx={ctx} p={p} query={query} />;
    case "about":
      return <About ctx={ctx} p={p} />;
    case "services":
      return <Services ctx={ctx} p={p} />;
    case "stats":
      return <Stats p={p} />;
    case "steps":
      return <Steps p={p} />;
    case "testimonials":
      return <Testimonials p={p} />;
    case "team":
      return <Team p={p} />;
    case "zones":
      return <Zones ctx={ctx} p={p} />;
    case "cta":
      return <Cta ctx={ctx} p={p} />;
    case "valuation":
      return <Valuation ctx={ctx} p={p} />;
    case "contact":
      return <Contact ctx={ctx} p={p} />;
    case "map":
      return (
        <div className={s.wrap}>
          <Heading p={p} center />
          <MapFrame query={str(p.query) || ctx.doc.settings.address} height={str(p.height) || "m"} />
          {ctx.mode === "editor" && !str(p.query) && !ctx.doc.settings.address && <p className={s.empty}>Cargá la dirección de tu oficina en Ajustes para ver el mapa.</p>}
        </div>
      );
    case "faq":
      return <Faq p={p} />;
    case "text":
      return <TextBlock ctx={ctx} p={p} />;
    case "gallery":
      return <Gallery p={p} />;
    case "video":
      return <Video ctx={ctx} p={p} />;
    case "logos":
      return <Logos ctx={ctx} p={p} />;
    case "newsletter":
      return <Newsletter ctx={ctx} p={p} />;
    case "staging":
      return <BeforeAfter p={p} />;
  }
}

/** Sections that disappear from the public site when they would be empty. */
function emptyInPublic(ctx: Ctx, section: Section) {
  const p = section.props;
  if (section.type === "featured") return ctx.catalog.properties.length === 0;
  if (section.type === "video") return !videoEmbed(str(p.url));
  if (section.type === "map") return !(str(p.query) || ctx.doc.settings.address);
  if (["services", "stats", "steps", "testimonials", "team", "zones", "faq", "gallery", "logos"].includes(section.type)) return list(p.items).length === 0;
  return false;
}

function SectionShell({ ctx, section, index, total, first, query }: { ctx: Ctx; section: Section; index: number; total: number; first: boolean; query: string }) {
  const p = section.props;
  const editor = ctx.editor;
  const bodyClass = cx(
    s.section,
    s[`bg-${str(p.bg) || "default"}`],
    s[`sp-${str(p.space) || "normal"}`],
    section.type === "hero" && str(p.variant) !== "split" && str(p.variant) !== "minimal" && s.flush,
  );
  const body = (
    <section id={str(p.anchor) || undefined} className={bodyClass} aria-label={section.type === "hero" ? undefined : str(p.title) || SECTIONS[section.type].label}>
      <SectionBody ctx={ctx} section={section} first={first} query={query} />
    </section>
  );
  if (!editor) return body;
  const selected = editor.selected === section.id;
  const act = (a: SectionAction) => (e: React.MouseEvent) => {
    e.stopPropagation();
    editor.onAction(section.id, a);
  };
  return (
    <div
      className={cx(s.editable, selected && s.selected, section.hidden && s.isHidden)}
      data-section-id={section.id}
      onClickCapture={(e) => {
        const target = e.target as HTMLElement;
        // Forms, filters and sliders keep working in the canvas; everything else selects.
        if (!target.closest("input, select, textarea, [data-tool]")) editor.onSelect(section.id);
      }}
    >
      <span className={s.editLabel}>
        {SECTIONS[section.type].label}
        {section.hidden && " · oculta"}
      </span>
      {selected && (
        <span className={s.toolbar} data-tool="">
          <button type="button" title="Subir" disabled={index === 0} onClick={act("up")}>
            <ArrowUp size={15} aria-hidden="true" />
          </button>
          <button type="button" title="Bajar" disabled={index === total - 1} onClick={act("down")}>
            <ArrowDown size={15} aria-hidden="true" />
          </button>
          <button type="button" title="Duplicar" onClick={act("duplicate")}>
            <Copy size={15} aria-hidden="true" />
          </button>
          <button type="button" title={section.hidden ? "Mostrar" : "Ocultar"} onClick={act("hide")}>
            {section.hidden ? <Eye size={15} aria-hidden="true" /> : <EyeOff size={15} aria-hidden="true" />}
          </button>
          <button type="button" title="Eliminar" onClick={act("delete")}>
            <Trash2 size={15} aria-hidden="true" />
          </button>
        </span>
      )}
      {body}
      {selected && (
        <button type="button" className={s.addBelow} data-tool="" onClick={act("add")}>
          <Plus size={15} aria-hidden="true" /> Agregar sección
        </button>
      )}
    </div>
  );
}

/* ───────────────── Header & footer ───────────────── */

function SocialLinks({ ctx }: { ctx: Ctx }) {
  const st = ctx.doc.settings;
  const items = [
    [st.instagram, Instagram, "Instagram"],
    [st.facebook, Facebook, "Facebook"],
    [st.linkedin, Linkedin, "LinkedIn"],
    [st.youtube, Youtube, "YouTube"],
    [st.tiktok, Music2, "TikTok"],
  ] as const;
  const shown = items.filter(([url]) => url);
  if (!shown.length) return null;
  return (
    <span className={s.social}>
      {shown.map(([url, Icon, label]) => (
        <a key={label} href={url} target="_blank" rel="noopener noreferrer" aria-label={label}>
          <Icon size={18} aria-hidden="true" />
        </a>
      ))}
    </span>
  );
}

function Brand({ ctx }: { ctx: Ctx }) {
  return (
    <SLink ctx={ctx} to="/" className={s.brand} label={`${ctx.catalog.name}: inicio`}>
      {ctx.catalog.logo ? <img src={ctx.catalog.logo} alt={ctx.catalog.name} /> : <span>{ctx.catalog.name}</span>}
    </SLink>
  );
}

function SiteHeader({ ctx, overHero }: { ctx: Ctx; overHero: boolean }) {
  const [open, setOpen] = useState(false);
  const h = ctx.doc.header;
  const nav = ctx.doc.pages.filter((p) => p.nav);
  const style = h.style === "transparent" && !overHero ? "light" : h.style;
  return (
    <>
      {ctx.doc.settings.announcement && (
        <div className={s.announce}>
          {ctx.doc.settings.announcementLink ? (
            <SLink ctx={ctx} to={ctx.doc.settings.announcementLink}>
              {ctx.doc.settings.announcement} →
            </SLink>
          ) : (
            <span>{ctx.doc.settings.announcement}</span>
          )}
        </div>
      )}
      <header className={cx(s.header, s[`hd-${style}`], h.sticky && style !== "transparent" && s.sticky, h.layout === "center" && s.headerCenter)}>
        <div className={cx(s.wrap, s.headerRow)}>
          <Brand ctx={ctx} />
          <nav className={cx(s.nav, open && s.navOpen)} aria-label="Secciones del sitio">
            {nav.map((p) => (
              <SLink key={p.id} ctx={ctx} to={`/${p.slug}`} className={cx(ctx.page?.id === p.id && s.navOn)}>
                {p.title}
              </SLink>
            ))}
          </nav>
          <div className={s.headerEnd}>
            {h.showPhone && ctx.doc.settings.phone && (
              <a className={s.headerPhone} href={`tel:${ctx.doc.settings.phone.replace(/[^\d+]/g, "")}`}>
                <Phone size={16} aria-hidden="true" /> {ctx.doc.settings.phone}
              </a>
            )}
            {h.ctaLabel && resolve(ctx, h.ctaLink) && (
              <SLink ctx={ctx} to={h.ctaLink} className={cx(s.btn, s.btnSmall)}>
                {h.ctaLabel}
              </SLink>
            )}
            <button type="button" className={s.burger} aria-label={open ? "Cerrar menú" : "Abrir menú"} aria-expanded={open} onClick={() => setOpen(!open)} data-tool="">
              {open ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
            </button>
          </div>
        </div>
      </header>
    </>
  );
}

function SiteFooter({ ctx }: { ctx: Ctx }) {
  const f = ctx.doc.footer;
  const st = ctx.doc.settings;
  return (
    <footer className={cx(s.footer, s[`ft-${f.style}`])}>
      <div className={cx(s.wrap, s.footerGrid)}>
        <div className={s.footerBrand}>
          <Brand ctx={ctx} />
          {f.about && <p>{f.about}</p>}
          {f.showSocial && <SocialLinks ctx={ctx} />}
        </div>
        {f.showPages && (
          <nav aria-label="Páginas">
            <strong>Navegación</strong>
            {ctx.doc.pages
              .filter((p) => p.nav)
              .map((p) => (
                <SLink key={p.id} ctx={ctx} to={`/${p.slug}`}>
                  {p.title}
                </SLink>
              ))}
          </nav>
        )}
        {f.showContact && (
          <div>
            <strong>Contacto</strong>
            <ContactInfo ctx={ctx} />
          </div>
        )}
      </div>
      <div className={cx(s.wrap, s.footerLegal)}>
        <span>
          © {new Date().getFullYear()} {ctx.catalog.name}
          {st.license && ` · ${st.license}`}
        </span>
        {f.legal && <span>{f.legal}</span>}
        <span>
          Sitio hecho con{" "}
          <a href="https://www.habitaia.app" target="_blank" rel="noopener">
            habita.
          </a>
        </span>
      </div>
    </footer>
  );
}

/* ───────────────── Root ───────────────── */

function themeStyle(doc: SiteDoc): React.CSSProperties {
  const t = doc.theme;
  return {
    "--p": t.primary,
    "--p-ink": inkOn(t.primary),
    "--a": t.accent,
    "--a-ink": inkOn(t.accent),
    "--bg": t.background,
    "--sf": t.surface,
    "--tx": t.text,
    "--r": t.radius === "none" ? "0px" : t.radius === "round" ? "18px" : "8px",
    "--rb": t.buttons === "pill" ? "999px" : t.radius === "none" ? "0px" : t.radius === "round" ? "14px" : "6px",
    "--hf": fontStack(t.headingFont),
    "--bf": fontStack(t.bodyFont),
    "--maxw": t.width === "wide" ? "1320px" : "1160px",
    "--hcase": t.headingCase === "upper" ? "uppercase" : "none",
    "--hls": t.headingCase === "upper" ? "0.06em" : "-0.01em",
  } as React.CSSProperties;
}

function Root({ ctx, children }: { ctx: Ctx; children: React.ReactNode }) {
  const t = ctx.doc.theme;
  const wa = ctx.doc.settings.whatsappButton ? whatsapp(ctx) : null;
  const fonts = fontsHref([t.headingFont, t.bodyFont]);
  return (
    <div className={cx(s.site, s[`btn-${t.buttons}`], ctx.mode === "editor" && s.inEditor)} style={themeStyle(ctx.doc)}>
      {fonts && <link rel="stylesheet" href={fonts} precedence="default" />}
      {children}
      {wa && (
        <div className={s.floatWrap}>
          <a className={s.floatWa} href={wa} target="_blank" rel="noopener noreferrer" aria-label="Escribinos por WhatsApp" onClick={(e) => ctx.mode === "editor" && e.preventDefault()}>
            <MessageCircle size={26} aria-hidden="true" />
          </a>
        </div>
      )}
    </div>
  );
}

const catalogSlugOf = (doc: SiteDoc) => doc.pages.find((p) => p.sections.some((x) => x.type === "listings" && !x.hidden))?.slug ?? null;

/**
 * A page of the site. `query`: the listing's filters from the address
 * (?q=&op=…); the public page reads it from the browser.
 */
export function SiteRenderer({
  doc,
  catalog,
  pageSlug,
  mode,
  editor,
  query = "",
}: {
  doc: SiteDoc;
  catalog: PublicSite;
  pageSlug: string;
  mode: SiteMode;
  editor?: EditorHooks;
  query?: string;
}) {
  const page = doc.pages.find((p) => p.slug === pageSlug) ?? doc.pages[0] ?? null;
  const ctx: Ctx = { doc, catalog, mode, page, editor, catalogSlug: catalogSlugOf(doc) };
  const [search, setSearch] = useState(query);
  useEffect(() => {
    if (mode !== "editor") setSearch(window.location.search);
  }, [mode]);
  useEffect(() => {
    if (mode === "editor") setSearch(query);
  }, [mode, query]);
  const sections = (page?.sections ?? []).filter((x) => mode === "editor" || (!x.hidden && !emptyInPublic(ctx, x)));
  const firstVisible = sections.find((x) => !x.hidden);
  const overHero = firstVisible?.type === "hero" && (str(firstVisible.props.variant) || "image") === "image";
  return (
    <Root ctx={ctx}>
      <SiteHeader ctx={ctx} overHero={overHero} />
      <main className={s.main}>
        {sections.map((x, i) => (
          <SectionShell key={x.id} ctx={ctx} section={x} index={i} total={sections.length} first={x === firstVisible} query={search} />
        ))}
        {mode === "editor" && sections.length === 0 && (
          <div className={s.blank}>
            <p>Esta página está vacía.</p>
            <button type="button" className={s.btn} data-tool="" onClick={() => editor?.onAction("", "add")}>
              <Plus size={16} aria-hidden="true" /> Agregar la primera sección
            </button>
          </div>
        )}
      </main>
      <SiteFooter ctx={ctx} />
    </Root>
  );
}
