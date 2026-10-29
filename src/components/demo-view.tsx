"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Bath,
  BedDouble,
  Briefcase,
  Building2,
  CalendarClock,
  CalendarDays,
  Car,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleDollarSign,
  DoorOpen,
  Download,
  ExternalLink,
  FileText,
  Home,
  Image as ImageIcon,
  Info,
  LayoutGrid,
  Lock,
  Mail,
  MapPin,
  Maximize2,
  MessageCircle,
  Minimize2,
  Phone,
  Plus,
  RotateCw,
  Ruler,
  Sparkles,
} from "lucide-react";
import { Comparison } from "./comparison";
import type { DemoInvite } from "@/lib/agency/demo-invite";
import { registerSuperProperties, track } from "@/lib/analytics";
import { reportDemoActivity } from "@/lib/demos/activity-client";
import { requestPublicStaging } from "@/lib/demos/staging-client";
import { useRouter } from "next/navigation";
import { textOn, whatsappNumber, type FactIcon } from "@/lib/demos/branding";
import { DEMO_STYLES, demoStyleName } from "@/lib/demos/styles";
import {
  adminPhotoUrl,
  ctaHref,
  DEMO_REF_KEY,
  publicImageUrl,
  type PhotoVersion,
  type PublicDemo,
  type PublicPhoto,
} from "@/lib/demos/shared";

type Source = { kind: "public"; token: string } | { kind: "preview" };
/** What a photo shows: its original, or one style (in full or compared with the original). */
type PhotoState = { style: string | null; compare: boolean; position: number };
const ORIGINAL: PhotoState = { style: null, compare: false, position: 50 };
const TEXT = {
  keepsOriginal: "La foto original se mantiene hasta que elijas un estilo.",
  original: "Original",
  staged: "Ambientado con IA",
  backToOriginal: "Volver al original",
  compare: "Comparar con original",
  illustrative: "Las ambientaciones con IA son ilustrativas. La foto original siempre está disponible.",
};
const FACT_ICON: Record<FactIcon, typeof Ruler> = {
  area: Ruler,
  rooms: DoorOpen,
  bedrooms: BedDouble,
  offices: Briefcase,
  bathrooms: Bath,
  floor: Building2,
  parking: Car,
  age: CalendarClock,
  other: Info,
};
const external = { target: "_blank", rel: "noopener noreferrer" } as const;
const VISIBLE_STYLES = 3;
/** The agency's own view lists the original and four styles first. */
const OWNER_VISIBLE_STYLES = 4;

/**
 * The agency looking at its own demo with a live invitation: its panel on
 * top, and next to each style the action that fits it. A prepared version is
 * downloaded; any other style is generated from the panel, which asks for
 * the access (and shows the cost) first.
 */
export type OwnerMode = { href: string; freeCredits: number; buyerHref: string };

const fileSlug = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

function urlFor(source: Source, photoId: string, version: PhotoVersion | null, width: number, retry = 0) {
  const url =
    source.kind === "public"
      ? publicImageUrl(source.token, photoId, version, width)
      : adminPhotoUrl(photoId, version, width);
  return retry ? `${url}&n=${retry}` : url;
}
const versionOf = (photo: PublicPhoto, style: string | null) =>
  style ? (photo.versions.find((v) => v.style === style) ?? null) : null;

type Action = { href: string; label: string; short: string; kind: "whatsapp" | "url" | "phone" | "email" | "listing" };
/** The inquiry channels, resolved: WhatsApp with a prepared message first, the original listing as the last resort. */
function contactActions(demo: PublicDemo, pageUrl: string) {
  const ref = demo.reference ? ` (ref. ${demo.reference})` : "";
  const link = demo.listingUrl || pageUrl;
  const ask = `Hola! Quiero consultar por "${demo.title}"${ref}: ${link}`;
  const visit = `Hola! Quiero coordinar una visita a "${demo.title}"${ref}: ${link}`;
  const c = demo.contact;
  const wa = c.whatsapp ? whatsappNumber(c.whatsapp) : null;
  const waHref = (text: string) => (wa ? `https://wa.me/${wa}?text=${encodeURIComponent(text)}` : null);
  const actions: Action[] = [];
  if (wa) actions.push({ href: waHref(ask)!, label: "Consultar por WhatsApp", short: "Consultar", kind: "whatsapp" });
  if (c.url) actions.push({ href: c.url, label: `Consultar a ${demo.agencyName}`, short: "Consultar", kind: "url" });
  if (c.phone)
    actions.push({ href: `tel:${c.phone.replace(/[^\d+]/g, "")}`, label: `Llamar al ${c.phone}`, short: "Llamar", kind: "phone" });
  if (c.email)
    actions.push({
      href: `mailto:${c.email}?subject=${encodeURIComponent(`Consulta: ${demo.title}${ref}`)}&body=${encodeURIComponent(ask)}`,
      label: "Enviar un email",
      short: "Email",
      kind: "email",
    });
  const primary: Action | null =
    actions[0] ?? (demo.listingUrl ? { href: demo.listingUrl, label: "Ver publicación original", short: "Ver aviso", kind: "listing" } : null);
  // A visit only through a real channel: the agency's scheduling link, else its WhatsApp.
  const visitHref = demo.agency.visitUrl || waHref(visit);
  return { primary, others: actions.slice(1), visitHref };
}

/**
 * The demo as the agency's own listing: identification, one gallery with an
 * optional staging of each photo, the property's data, location, conditions
 * and contact. Every photo opens as its clean original (except the first one
 * in opening mode B); choosing a style compares it with the original, and
 * each photo keeps its own state during the visit. Nothing here generates
 * images: the styles are versions prepared and reviewed in the panel.
 */
export function DemoView({
  demo,
  source,
  presentation = false,
  invite = null,
  owner = null,
  plans = null,
}: {
  demo: PublicDemo;
  source: Source;
  /** The link for the agency: may show the "Demo preparada para…" strip. */
  presentation?: boolean;
  /** The private invitation carried by the presentation link (validated on the server), if any. */
  invite?: DemoInvite;
  /** The agency viewing its own demo through its invitation: its panel header and the download or generate actions. */
  owner?: OwnerMode | null;
  /** The plans of /precios, shown in the agency's side panel. */
  plans?: React.ReactNode;
}) {
  const { agency } = demo;
  const [pageUrl, setPageUrl] = useState("");
  // The agent's photo lives on the agency's site: if it fails, the initials stand in.
  const [agentPhotoFailed, setAgentPhotoFailed] = useState(false);
  const analytics = useMemo(
    () => ({
      demo_id: demo.id,
      // Readable names for the team's reports; both are already public on the demo page.
      demo_titulo: demo.title,
      inmobiliaria: agency.name,
      inmobiliaria_id: demo.agencyId,
      fotos: demo.photos.length,
      ambientadas: demo.photos.filter((p) => p.versions.length).length,
      version: presentation ? "presentacion" : "comprador",
    }),
    [demo.id, demo.title, agency.name, demo.agencyId, demo.photos, presentation],
  );
  useEffect(() => {
    setPageUrl(window.location.href.split(/[?#]/)[0]);
    if (source.kind !== "public") return;
    track("demo_vista", analytics);
    reportDemoActivity(source.token, "visita");
    registerSuperProperties({ demo_id: demo.id, demo_titulo: demo.title, demo_inmobiliaria: agency.name, demo_inmobiliaria_id: demo.agencyId });
    try {
      localStorage.setItem(DEMO_REF_KEY, JSON.stringify({ demoId: demo.id, agencyId: demo.agencyId, at: Date.now() }));
    } catch {
      /* Private mode or blocked storage. */
    }
  }, [source.kind, demo.id, demo.title, agency.name, demo.agencyId, analytics]);

  const { primary, others, visitHref } = contactActions(demo, pageUrl);
  const interacted = useRef(false);
  const log = (event: string, extra: Record<string, unknown> = {}) => {
    if (source.kind !== "public") return;
    track(event, { ...analytics, ...extra });
    // A download is its own step for the team's list; the server ignores repeats.
    if (event === "demo_owner_download") reportDemoActivity(source.token, "descarga");
    // The first other interaction of this visit is step 2.
    else if (!interacted.current) {
      interacted.current = true;
      reportDemoActivity(source.token, "interaccion");
    }
  };
  const contactLink = (a: Action, className: string, label = a.label) => (
    <a
      className={className}
      href={a.href}
      {...(a.kind === "phone" || a.kind === "email" ? {} : external)}
      onClick={() => log(a.kind === "listing" ? "demo_publicacion_original" : "demo_contacto", { canal: a.kind })}
    >
      <ContactIcon kind={a.kind} />
      <span>{label}</span>
    </a>
  );
  const brandStyle = {
    "--brand": agency.primary,
    "--brand-ink": textOn(agency.primary),
    "--brand-accent": agency.accent,
    "--brand-accent-ink": textOn(agency.accent),
  } as React.CSSProperties;
  const noun = demo.propertyType === "office" ? "la oficina" : "la propiedad";
  const rent = /alquiler/i.test(demo.operation ?? "");
  const priceLabel = demo.price ?? `Consultar ${rent ? "alquiler" : "precio"}`;
  // Only what applies to this operation: a sale shows no rental requirements nor generic text.
  const terms = [
    demo.expenses && { label: "Expensas", value: demo.expenses },
    demo.availability && { label: "Disponibilidad", value: demo.availability },
    demo.requirements && { label: "Requisitos", value: demo.requirements },
  ].filter(Boolean) as { label: string; value: string }[];
  const conditions = terms.length && demo.price ? [{ label: "Precio", value: demo.price }, ...terms] : terms;
  const showConditions = terms.length > 0 || (rent && !demo.price);

  return (
    <div className={`dv2-page ${agency.titleFont === "serif" ? "is-serif" : ""}`} style={brandStyle}>
      {owner && <OwnerHeader demo={demo} owner={owner} log={log} plans={plans} />}
      {!owner && presentation && demo.banner && (
        <div className="dv2-banner" role="note">
          Demo preparada para {agency.name} ·{" "}
          <a href={ctaHref(demo.id, demo.agencyId)} {...external} onClick={() => log("demo_cta_click")}>
            Por habita.
          </a>
        </div>
      )}
      {!owner && (
      <header className="dv2-header">
        <div className="container">
          <Brand agency={agency} />
          <nav className="dv2-nav-links" aria-label="Secciones">
            <a href="#propiedad">Propiedad</a>
            {(demo.map || demo.location) && <a href="#ubicacion">Ubicación</a>}
            <a href="#contacto">Contacto</a>
          </nav>
          <div className="dv2-header-actions">
            {demo.listingUrl && (
              <a className="dv2-header-link" href={demo.listingUrl} {...external}>
                Ver publicación original <ExternalLink size={14} aria-hidden="true" />
              </a>
            )}
            {primary && primary.kind !== "listing" && contactLink(primary, "dv2-header-cta", primary.short)}
          </div>
        </div>
      </header>
      )}

      <div className="container dv2-main">
        <section id="propiedad" className="dv2-heading" aria-labelledby="dv2-title">
          <div>
            {demo.reference && <p className="dv2-ref">Ref. {demo.reference}</p>}
            <h1 id="dv2-title">{demo.title}</h1>
            {demo.location && (
              <p className="dv2-location">
                <MapPin size={17} aria-hidden="true" /> {demo.location}
              </p>
            )}
            {demo.features && <p className="dv2-features">{demo.features}</p>}
          </div>
          <p className={`dv2-price ${demo.price ? "" : "is-ask"}`}>
            {demo.operation && <span className="dv2-chip">{demo.operation}</span>}
            <strong>{priceLabel}</strong>
          </p>
        </section>

        <Gallery
          demo={demo}
          source={source}
          log={log}
          sideAction={!owner && primary && primary.kind !== "listing" ? contactLink(primary, "dv2-contact-main") : null}
          sideInvite={!owner && presentation && demo.prospect && invite ? <PanelInvite invite={invite} place="lateral" log={log} /> : null}
          owner={owner}
        />
        {demo.photos.some((p) => p.versions.length) && <p className="dv2-illustrative">{TEXT.illustrative}</p>}

        {demo.facts.length > 0 && (
          <ul className="dv2-facts" aria-label="Datos principales">
            {demo.facts.map((f, i) => {
              const Icon = FACT_ICON[f.icon];
              return (
                <li key={i}>
                  <Icon size={24} aria-hidden="true" />
                  <span>
                    <strong>{f.value}</strong>
                    {f.label && <small>{f.label}</small>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        <div className="dv2-body">
          <div className="dv2-body-main">
            {demo.description && <Description text={demo.description} />}
            {demo.amenities.length > 0 && (
              <section className="dv2-section" aria-labelledby="dv2-amenities">
                <h2 id="dv2-amenities">Características y servicios</h2>
                <div className="dv2-amenities">
                  {demo.amenities.map((g, i) => (
                    <AmenityList key={i} group={g} />
                  ))}
                </div>
              </section>
            )}
          </div>
          <aside id="contacto" className="dv2-contact-card" aria-label={`Contacto con ${agency.name}`}>
            <Brand agency={agency} small />
            {demo.agent && (
              <div className="dv2-agent">
                {demo.agent.photoUrl && !agentPhotoFailed ? (
                  <img
                    src={demo.agent.photoUrl}
                    alt=""
                    loading="lazy"
                    onError={() => setAgentPhotoFailed(true)}
                    // An error before hydration fires no event: checked when mounted.
                    ref={(el) => {
                      if (el?.complete && !el.naturalWidth) setAgentPhotoFailed(true);
                    }}
                  />
                ) : (
                  <span className="dv2-initials" aria-hidden="true">
                    {demo.agent.initials}
                  </span>
                )}
                <span>
                  <strong>{demo.agent.name}</strong>
                  {demo.agent.role && <small>{demo.agent.role}</small>}
                </span>
              </div>
            )}
            {primary && contactLink(primary, "dv2-contact-main")}
            {others.map((a) => (
              <span key={a.kind}>{contactLink(a, "dv2-contact-alt")}</span>
            ))}
            {demo.listingUrl && primary?.kind !== "listing" && (
              <a
                className="dv2-contact-link"
                href={demo.listingUrl}
                {...external}
                onClick={() => log("demo_publicacion_original")}
              >
                <ExternalLink size={15} aria-hidden="true" /> Ver publicación original
              </a>
            )}
          </aside>
        </div>

        {(demo.map || demo.location) && (
          <section id="ubicacion" className="dv2-section" aria-labelledby="dv2-location">
            <h2 id="dv2-location">Ubicación</h2>
            {demo.location && <p className="dv2-location-text">{demo.location}</p>}
            {demo.map && <LazyMap map={demo.map} title={demo.title} />}
          </section>
        )}

        {showConditions && (
          <section className="dv2-conditions" aria-labelledby="dv2-conditions">
            <FileText size={28} aria-hidden="true" />
            <div>
              <h2 id="dv2-conditions">
                {rent ? "Condiciones del alquiler" : /venta/i.test(demo.operation ?? "") ? "Condiciones de la venta" : "Condiciones"}
              </h2>
              {conditions.length > 0 && (
                <dl>
                  {conditions.map((c) => (
                    <div key={c.label}>
                      <dt>{c.label}</dt>
                      <dd>{c.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {rent && !demo.price && (
                <p>
                  Consultá el valor actualizado{demo.expenses ? "" : ", las expensas"} y los requisitos con {agency.name}.
                </p>
              )}
            </div>
          </section>
        )}

        {/* Only on the team's presentation link of an agency without an account: buyers never see it. */}
        {!owner && presentation && demo.prospect && invite && <PanelInvite invite={invite} place="final" log={log} />}
        {!owner && presentation && demo.prospect && !invite && (
          <section className="dv2-habita" aria-labelledby="dv2-habita">
            <div>
              <h2 id="dv2-habita">¿Te imaginás todas tus propiedades así?</h2>
              <p>
                Con habita podés transformar las fotos de tus propiedades con IA, compartir fichas interactivas y crear
                tu propio catálogo inmobiliario.
              </p>
            </div>
            <div className="dv2-habita-actions">
              <a
                className="dv2-habita-cta"
                href={source.kind === "public" ? `/panel/empezar?demo=${source.token}` : "/panel/empezar"}
                onClick={() => log("demo_agency_cta_clicked", { origen: "demo" })}
              >
                Crear mi inmobiliaria gratis
              </a>
              <small>Sin tarjeta de crédito.</small>
            </div>
          </section>
        )}

        <section className="dv2-closing" aria-labelledby="dv2-closing">
          <div>
            <h2 id="dv2-closing">{demo.closingTitle}</h2>
            <p>{demo.closingText ?? `Contactá a ${agency.name} para conocer ${noun}.`}</p>
          </div>
          {visitHref ? (
            <a className="dv2-closing-cta" href={visitHref} {...external} onClick={() => log("demo_visita")}>
              <CalendarDays size={18} aria-hidden="true" /> Coordinar una visita
            </a>
          ) : (
            primary && contactLink(primary, "dv2-closing-cta")
          )}
        </section>
      </div>

      <footer className="dv2-footer">
        <div className="container">
          <Brand agency={agency} small />
          <nav aria-label="Enlaces">
            {demo.listingUrl && (
              <a href={demo.listingUrl} {...external}>
                Ver aviso original
              </a>
            )}
            <a href="#contacto">Contacto</a>
          </nav>
          <span className="dv2-tech">
            <Sparkles size={12} aria-hidden="true" /> Tecnología de <b>habita.</b>
          </span>
        </div>
      </footer>
      {primary && !owner && <div className="dv2-sticky">{contactLink(primary, "dv2-contact-main")}</div>}
    </div>
  );
}

function ContactIcon({ kind }: { kind: Action["kind"] }) {
  const Icon =
    kind === "whatsapp" ? MessageCircle : kind === "phone" ? Phone : kind === "email" ? Mail : ExternalLink;
  return <Icon size={18} aria-hidden="true" />;
}

function Brand({ agency, small = false }: { agency: PublicDemo["agency"]; small?: boolean }) {
  const inner = agency.logo ? <img src={agency.logo} alt={agency.name} /> : <strong>{agency.name}</strong>;
  const className = `dv2-brand ${small ? "is-small" : ""}`;
  return agency.website ? (
    <a className={className} href={agency.website} {...external}>
      {inner}
    </a>
  ) : (
    <span className={className}>{inner}</span>
  );
}

/** One group of features; long lists show the first ones and expand. */
function AmenityList({ group }: { group: PublicDemo["amenities"][number] }) {
  const [open, setOpen] = useState(false);
  const FIRST = 8;
  const items = open ? group.items : group.items.slice(0, FIRST);
  return (
    <div>
      {group.title && <h3>{group.title}</h3>}
      <ul>
        {items.map((item, j) => (
          <li key={j}>
            <Check size={16} aria-hidden="true" /> {item}
          </li>
        ))}
      </ul>
      {group.items.length > FIRST && (
        <button type="button" className="dv2-more-link" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Ver menos" : `Ver todos (${group.items.length})`}
        </button>
      )}
    </div>
  );
}

/** The description as published, in short paragraphs and lists; long ones start collapsed. */
function Description({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const blocks = useMemo(() => {
    const out: ({ kind: "p"; text: string } | { kind: "ul"; items: string[] })[] = [];
    // Sites without blank lines write one idea per line: each is a short paragraph,
    // unless it obviously continues the previous one (", 101 metros cuadrados.").
    const loose = !/\n\s*\n/.test(text);
    for (const raw of text.split(/\n/)) {
      const line = raw.trim();
      const item = line.match(/^[-•*·]\s*(.+)/);
      const last = out[out.length - 1];
      const continues = /^[,.;:)\p{Ll}]/u.test(line);
      if (!line) out.push({ kind: "p", text: "" });
      else if (item) {
        if (last?.kind === "ul") last.items.push(item[1]);
        else out.push({ kind: "ul", items: [item[1]] });
      } else if (last?.kind === "p" && last.text && (!loose || continues))
        last.text += /^[,.;:)]/.test(line) ? line : ` ${line}`;
      else out.push({ kind: "p", text: line });
    }
    return out.filter((b) => b.kind === "ul" || b.text);
  }, [text]);
  const long = text.length > 600 || blocks.length > 4;
  const shown = long && !open ? blocks.slice(0, 3) : blocks;
  return (
    <section className="dv2-section" aria-labelledby="dv2-description">
      <h2 id="dv2-description">Descripción</h2>
      <div className={`dv2-description ${long && !open ? "is-clipped" : ""}`} id="dv2-description-text">
        {shown.map((b, i) =>
          b.kind === "p" ? (
            <p key={i}>{b.text}</p>
          ) : (
            <ul key={i}>
              {b.items.map((item, j) => (
                <li key={j}>{item}</li>
              ))}
            </ul>
          ),
        )}
      </div>
      {long && (
        <button
          type="button"
          className="dv2-link"
          aria-expanded={open}
          aria-controls="dv2-description-text"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "Ver menos" : "Ver descripción completa"}
          {open ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
        </button>
      )}
    </section>
  );
}

/**
 * OpenStreetMap, loaded only when the section comes into view so it never
 * competes with the gallery. Zones and approximate locations show an area,
 * never a pin; only an address published as exact gets a marker.
 */
function LazyMap({ map, title }: { map: NonNullable<PublicDemo["map"]>; title: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    if (!("IntersectionObserver" in window)) return setVisible(true);
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setVisible(true), {
      rootMargin: "200px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  // The area drawn decides the zoom: the listing's radius, rounded on the server to the chosen precision.
  const meters = map.radius ?? 350;
  const dLat = (meters * 2.2) / 111320;
  const dLng = dLat / Math.max(0.2, Math.cos((map.lat * Math.PI) / 180));
  const bbox = [map.lng - dLng * 1.6, map.lat - dLat, map.lng + dLng * 1.6, map.lat + dLat].map((n) => n.toFixed(5)).join(",");
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik${
    map.precision === "exact" ? `&marker=${map.lat},${map.lng}` : ""
  }`;
  // Opening the map elsewhere shows the same precision: a pin only when exact.
  const zoom = map.precision === "zone" ? 14 : map.precision === "approx" ? 16 : 17;
  const open =
    map.precision === "exact"
      ? `https://www.openstreetmap.org/?mlat=${map.lat}&mlon=${map.lng}#map=${zoom}/${map.lat}/${map.lng}`
      : `https://www.openstreetmap.org/#map=${zoom}/${map.lat}/${map.lng}`;
  // The circle covers the radius over the frame's height (2.2 radii tall).
  const area = `${Math.min(90, Math.round(100 / 2.2))}%`;
  return (
    <>
      <div className="dv2-map" ref={box}>
        {visible ? (
          <iframe src={src} title={`Mapa: ${title}`} loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <span className="dv2-map-wait">Cargando mapa…</span>
        )}
        {map.precision !== "exact" && (
          <>
            <span className={`dv2-map-area is-${map.precision}`} style={{ height: area }} aria-hidden="true" />
            <span className="dv2-map-note">
              {map.precision === "zone" ? "Zona de la propiedad" : "Ubicación aproximada"}
            </span>
          </>
        )}
      </div>
      <a className="dv2-map-open" href={open} target="_blank" rel="noopener noreferrer">
        Abrir el mapa en otra pestaña
      </a>
    </>
  );
}

/** One carousel of the property's photos, each with the styles prepared for it. */
function Gallery({
  demo,
  source,
  log,
  sideAction,
  sideInvite = null,
  owner = null,
}: {
  demo: PublicDemo;
  source: Source;
  log: (event: string, extra?: Record<string, unknown>) => unknown;
  sideAction: React.ReactNode;
  /** The agency's way into its panel, right where it sees the result. */
  sideInvite?: React.ReactNode;
  /** The agency's own view: every style with its download or generate action. */
  owner?: OwnerMode | null;
}) {
  const photos = demo.photos;
  const styleNames = useMemo(
    () => Object.fromEntries(demo.styles.map((s) => [s.id, s.name])) as Record<string, string>,
    [demo.styles],
  );
  const name = (style: string) => styleNames[style] ?? demoStyleName(style);
  // The agency's own view always opens compared: the chosen style, else the first style with a staging.
  const openStyle = owner
    ? (demo.openStyle ?? demo.styles.find((st) => photos.some((p) => p.versions.some((v) => v.style === st.id)))?.id ?? null)
    : demo.openStyle;
  // The agency opens on the first photo that already has a staging, compared; the buyers start at the first photo.
  const [index, setIndex] = useState(() => (owner ? Math.max(0, photos.findIndex((p) => p.versions.length > 0)) : 0));
  // Remembered per photo during the visit.
  const [states, setStates] = useState<Record<string, PhotoState>>({});
  // The style last chosen: photos not seen yet open in it when they have it.
  const lastStyle = useRef(owner ? openStyle : demo.openStyle);
  // Where the comparison line was last left, on any photo.
  const lastPosition = useRef(50);
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const [retries, setRetries] = useState<Record<string, number>>({});
  const [ratios, setRatios] = useState<Record<string, number>>({});
  const [full, setFull] = useState(false);
  const [allStyles, setAllStyles] = useState(false);
  const router = useRouter();
  // The style being generated for a photo: the page refreshes until its version shows.
  const [staging, setStaging] = useState<{ photo: string; style: string } | null>(null);
  const [stagingError, setStagingError] = useState("");
  useEffect(() => {
    if (!staging) return;
    const done = photos.some((p) => p.id === staging.photo && p.versions.some((v) => v.style === staging.style));
    if (done) return void setStaging(null);
    const refresh = window.setInterval(() => router.refresh(), 8000);
    const stop = window.setTimeout(() => setStaging(null), 240000);
    return () => {
      window.clearInterval(refresh);
      window.clearTimeout(stop);
    };
  }, [staging, photos, router]);
  async function generate(photoId: string, style: string) {
    if (source.kind !== "public") return;
    setStagingError("");
    setStaging({ photo: photoId, style });
    const r = await requestPublicStaging(source.token, photoId, style);
    if (!r.ok) {
      setStaging(null);
      setStagingError(r.error);
      return;
    }
    // The visitor generated an image: step 3 for the team's list (the server ignores repeats).
    reportDemoActivity(source.token, "generacion");
  }
  const thumbs = useRef<HTMLOListElement>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);

  const photo = photos[index];
  // Opening mode B: every photo with stagings opens compared, the line in the middle
  // (in the style last chosen, else the configured one, else its first). Otherwise, the original.
  const opening = (p: PublicPhoto): PhotoState => {
    if (!openStyle || !p.versions.length) return ORIGINAL;
    const style = [lastStyle.current, openStyle].find((st) => st && p.versions.some((v) => v.style === st));
    return { style: style ?? p.versions[0].style, compare: true, position: 50 };
  };
  const state = photo ? (states[photo.id] ?? opening(photo)) : ORIGINAL;
  const version = photo ? versionOf(photo, state.style) : null;
  const stagedKey = photo && version ? `${photo.id}:${version.style}` : "";
  const stagedFailed = Boolean(stagedKey && failed[stagedKey]);
  // A version that fails to load leaves the original on screen.
  const showing = version && !stagedFailed ? version : null;
  const comparing = Boolean(showing && state.compare);
  const alt = (i: number, p: PublicPhoto) => `${demo.title}, foto ${i + 1}${p.label ? `: ${p.label}` : ""}`;

  const setState = useCallback(
    (next: PhotoState) => photo && setStates((s) => ({ ...s, [photo.id]: next })),
    [photo],
  );
  const go = useCallback(
    (step: number) => setIndex((i) => (photos.length ? (i + step + photos.length) % photos.length : 0)),
    [photos.length],
  );
  const choose = (style: string) => {
    // The line stays where the buyer left it: moved all the way to one side,
    // the next style is seen the same way, not from the middle again.
    setState({ style, compare: true, position: state.style && state.compare ? state.position : lastPosition.current });
    lastStyle.current = style;
    log("demo_estilo", { estilo: style });
  };
  const backToOriginal = () => {
    setState(ORIGINAL);
    log("demo_original");
  };

  // Arrows move between photos (not while the comparison slider has the focus); Esc leaves full screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return setFull(false);
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select")) return;
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);
  useEffect(() => {
    if (!full) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [full]);
  // The current thumbnail stays in view; the next original starts loading.
  useEffect(() => {
    const list = thumbs.current;
    const item = list?.querySelector<HTMLElement>(`[data-index="${index}"]`);
    if (list && item) list.scrollTo({ left: item.offsetLeft - list.clientWidth / 2 + item.clientWidth / 2, behavior: "smooth" });
    const next = photos[(index + 1) % Math.max(1, photos.length)];
    if (next && next !== photo) new Image().src = urlFor(source, next.id, null, 2048);
  }, [index, photos, photo, source]);

  // The strip scrolls a page at a time; the photo changes only on a thumbnail or the arrows on it.
  const scrollThumbs = (step: number) =>
    thumbs.current?.scrollBy({ left: step * thumbs.current.clientWidth * 0.8, behavior: "smooth" });

  if (!photo) return <p className="dv2-empty">Esta propiedad todavía no tiene fotos.</p>;
  const ratio = ratios[photo.id] ?? 4 / 3;
  const originalKey = `${photo.id}:o`;
  const panelTitle =
    demo.propertyType === "office" ? "Imaginá tu oficina a tu estilo" : "Imaginá este espacio a tu estilo";
  // Three styles at first; the chosen one always stays in view.
  const listed = allStyles
    ? photo.versions
    : photo.versions.filter((v, i) => i < VISIBLE_STYLES || v.style === state.style);
  // The agency's own view: the original first, then the prepared versions and every other style of the catalog.
  const ownerRows = owner
    ? [
        ...photo.versions.map((v) => ({ style: v.style, version: v as PhotoVersion | null })),
        ...DEMO_STYLES[demo.propertyType].filter((c) => !photo.versions.some((v) => v.style === c.id)).map((c) => ({ style: c.id, version: null })),
      ]
    : [];
  const ownerListed = allStyles ? ownerRows : ownerRows.filter((r, i) => i < OWNER_VISIBLE_STYLES || (r.version && r.style === state.style));
  const ownerFile = (style: string | null) => `${fileSlug(`${demo.title}-${photo.label}-${style ? name(style) : "original"}`)}.jpg`;
  const ownerPanel = owner && (
    <section className="dv2-panel is-owner" aria-labelledby="dv2-panel-title">
      <h2 id="dv2-panel-title">{panelTitle}</h2>
      <p className="dv2-panel-hint">
        {photo.versions.length ? "Elegí una propuesta preparada o generá otra." : "Esta foto todavía no tiene versiones: generá la primera."}
      </p>
      <ul className="dv2-owner-rows" id="dv2-estilos">
        <li className={`dv2-owner-row ${state.style ? "" : "is-on"}`}>
          <button type="button" aria-pressed={!state.style} onClick={backToOriginal}>
            <img src={urlFor(source, photo.id, null, 480)} alt="" loading="lazy" />
            <span>
              <strong>Original</strong>
              <small>{state.style ? "Ver original" : "Viendo el original"}</small>
            </span>
          </button>
          <a
            className="dv2-owner-action"
            href={urlFor(source, photo.id, null, 2048)}
            download={ownerFile(null)}
            aria-label="Descargar el original"
            onClick={() => log("demo_owner_download", { estilo: "original" })}
          >
            <Download size={16} aria-hidden="true" /> Descargar
          </a>
        </li>
        {ownerListed.map((r) => {
          const on = Boolean(r.version) && state.style === r.style;
          return r.version ? (
            <li key={r.style} className={`dv2-owner-row ${on ? "is-on" : ""}`}>
              <button type="button" aria-pressed={on} onClick={() => choose(r.style)}>
                <img src={urlFor(source, photo.id, r.version, 480)} alt="" loading="lazy" />
                <span>
                  <strong>{name(r.style)}</strong>
                  <small>{on ? "Viendo ahora" : "Lista"}</small>
                </span>
              </button>
              <a
                className="dv2-owner-action"
                href={urlFor(source, photo.id, r.version, 2048)}
                download={ownerFile(r.style)}
                aria-label={`Descargar ${name(r.style)}`}
                onClick={() => log("demo_owner_download", { estilo: r.style })}
              >
                <Download size={16} aria-hidden="true" /> Descargar
              </a>
            </li>
          ) : (
            <li key={r.style} className="dv2-owner-row is-missing">
              <span className="dv2-owner-info">
                <img src={urlFor(source, photo.id, null, 480)} alt="" loading="lazy" />
                <span>
                  <strong>{name(r.style)}</strong>
                  <small>Sin generar</small>
                </span>
              </span>
              <button
                type="button"
                className="dv2-owner-action is-generate"
                disabled={!!staging || source.kind !== "public"}
                aria-label={`Generar ${name(r.style)}`}
                onClick={() => {
                  log("demo_owner_generar", { estilo: r.style });
                  void generate(photo.id, r.style);
                }}
              >
                {staging?.photo === photo.id && staging.style === r.style ? (
                  "Generando…"
                ) : (
                  <>
                    <Sparkles size={16} aria-hidden="true" /> Generar
                  </>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {ownerRows.length > OWNER_VISIBLE_STYLES && (
        <button type="button" className="dv2-more" aria-expanded={allStyles} onClick={() => setAllStyles((a) => !a)}>
          {allStyles ? "Menos estilos" : `Más estilos (${ownerRows.length - ownerListed.length})`}
          {allStyles ? <ChevronUp size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />}
        </button>
      )}
      {stagingError && (
        <p className="dv2-note is-error" role="alert">
          {stagingError}
        </p>
      )}
      {stagedFailed && (
        <p className="dv2-note is-error" role="alert">
          No pudimos cargar esta ambientación. Seguís viendo la foto original.
        </p>
      )}
      {state.style && !state.compare && !stagedFailed && (
        <button type="button" className="dv2-secondary" onClick={() => setState({ ...state, compare: true })}>
          {TEXT.compare}
        </button>
      )}
      <p className="dv2-note">
        <Info size={15} aria-hidden="true" /> Descargar es gratis. Generar usa 1 de los créditos de regalo.
      </p>
    </section>
  );
  const panel = ownerPanel || (photo.versions.length > 0 && (
    <section className="dv2-panel" aria-labelledby="dv2-panel-title">
      <h2 id="dv2-panel-title">{panelTitle}</h2>
      <p className="dv2-panel-hint">Elegí una propuesta para esta foto.</p>
      <div className="dv2-options" role="radiogroup" aria-labelledby="dv2-panel-title">
        {listed.map((v) => {
          const on = state.style === v.style;
          return (
            <button
              key={v.style}
              type="button"
              role="radio"
              aria-checked={on}
              className={on ? "is-on" : ""}
              onClick={() => choose(v.style)}
            >
              <img src={urlFor(source, photo.id, v, 480)} alt="" loading="lazy" />
              <span className="dv2-option-name">{name(v.style)}</span>
              <span className="dv2-radio" aria-hidden="true">
                {on && <Check size={13} strokeWidth={3} />}
              </span>
            </button>
          );
        })}
      </div>
      {photo.versions.length > VISIBLE_STYLES && (
        <button type="button" className="dv2-more" aria-expanded={allStyles} onClick={() => setAllStyles((a) => !a)}>
          {allStyles ? "Ver menos estilos" : `Ver más estilos (${photo.versions.length - VISIBLE_STYLES})`}
          {allStyles ? <ChevronUp size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />}
        </button>
      )}
      {stagedFailed ? (
        <p className="dv2-note is-error" role="alert">
          No pudimos cargar esta ambientación. Seguís viendo la foto original.
          <button
            type="button"
            className="dv2-link"
            onClick={() => {
              setFailed((f) => ({ ...f, [stagedKey]: false }));
              setRetries((r) => ({ ...r, [stagedKey]: (r[stagedKey] ?? 0) + 1 }));
            }}
          >
            <RotateCw size={14} aria-hidden="true" /> Reintentar
          </button>
        </p>
      ) : state.style ? (
        <div className="dv2-actions">
          {!state.compare && (
            <button type="button" className="dv2-secondary" onClick={() => setState({ ...state, compare: true })}>
              {TEXT.compare}
            </button>
          )}
          <button type="button" className="dv2-secondary" onClick={backToOriginal}>
            <ArrowLeft size={17} aria-hidden="true" /> {TEXT.backToOriginal}
          </button>
        </div>
      ) : (
        <p className="dv2-note">
          <Info size={15} aria-hidden="true" /> {TEXT.keepsOriginal}
        </p>
      )}
    </section>
  ));

  return (
    <div className={`dv2-gallery ${panel ? "has-panel" : ""}`}>
      <div className="dv2-media">
        <div
          className={`dv2-stage ${full ? "is-full" : ""}`}
          role="group"
          aria-roledescription="carrusel"
          aria-label={`Foto ${index + 1} de ${photos.length}`}
          onPointerDown={(e) => {
            if (!comparing) swipe.current = { x: e.clientX, y: e.clientY };
          }}
          onPointerUp={(e) => {
            const s = swipe.current;
            swipe.current = null;
            // Swiping changes photo only outside comparison: there, dragging moves the line.
            if (!s || comparing || photos.length < 2) return;
            const dx = e.clientX - s.x;
            if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(e.clientY - s.y)) go(dx < 0 ? 1 : -1);
          }}
          onPointerCancel={() => (swipe.current = null)}
        >
          {/* Measures the original: both images are shown in its proportions, never stretched. */}
          <img
            className="dv2-measure"
            src={urlFor(source, photo.id, null, 480)}
            alt=""
            aria-hidden="true"
            onLoad={(e) => {
              const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
              if (w && h) setRatios((r) => (r[photo.id] ? r : { ...r, [photo.id]: w / h }));
            }}
          />
          {/* The same photo, blurred, fills the sides: a photo narrower than the stage never sits on gray bars. */}
          <div
            className="dv2-backdrop"
            aria-hidden="true"
            style={{ backgroundImage: `url("${urlFor(source, photo.id, comparing ? null : showing, 480)}")` }}
          />
          <div className="dv2-frame" style={{ "--ratio": String(ratio) } as React.CSSProperties}>
            {failed[originalKey] ? (
              <div className="dv2-broken">
                No pudimos cargar esta foto.
                <button
                  type="button"
                  className="dv2-link"
                  onClick={() => {
                    setFailed((f) => ({ ...f, [originalKey]: false }));
                    setRetries((r) => ({ ...r, [originalKey]: (r[originalKey] ?? 0) + 1 }));
                  }}
                >
                  <RotateCw size={14} aria-hidden="true" /> Reintentar
                </button>
              </div>
            ) : comparing && showing ? (
              <Comparison
                key={stagedKey}
                before={urlFor(source, photo.id, null, 2048, retries[originalKey])}
                after={urlFor(source, photo.id, showing, 2048, retries[stagedKey])}
                alt={`${alt(index, photo)}, ambientación ${name(showing.style)} con IA, ilustrativa`}
                beforeAlt={`${alt(index, photo)}, original`}
                beforeLabel={TEXT.original}
                afterLabel={TEXT.staged}
                initial={state.position}
                onPositionChange={(position) => {
                  lastPosition.current = position;
                  setStates((s) => ({ ...s, [photo.id]: { ...(s[photo.id] ?? state), position } }));
                }}
                onAfterError={() => setFailed((f) => ({ ...f, [stagedKey]: true }))}
              />
            ) : (
              <>
                <img
                  key={`${photo.id}-${showing?.style ?? "o"}`}
                  className="dv2-photo"
                  src={urlFor(source, photo.id, showing, 2048, showing ? retries[stagedKey] : retries[originalKey])}
                  alt={showing ? `${alt(index, photo)}, ambientación ${name(showing.style)} con IA, ilustrativa` : alt(index, photo)}
                  draggable={false}
                  fetchPriority={index === 0 ? "high" : undefined}
                  onError={() => setFailed((f) => ({ ...f, [showing ? stagedKey : originalKey]: true }))}
                />
                {showing && (
                  <span className="dv2-tag is-ai">
                    <Sparkles size={14} aria-hidden="true" /> {TEXT.staged} · {name(showing.style)}
                  </span>
                )}
              </>
            )}
          </div>
          {photos.length > 1 && (
            <>
              <button type="button" className="dv2-nav dv2-prev" aria-label="Foto anterior" onClick={() => go(-1)}>
                <ChevronLeft size={24} />
              </button>
              <button type="button" className="dv2-nav dv2-next" aria-label="Foto siguiente" onClick={() => go(1)}>
                <ChevronRight size={24} />
              </button>
            </>
          )}
          <span className="dv2-counter">
            {index + 1} / {photos.length}
          </span>
          <button
            type="button"
            className="dv2-full"
            aria-label={full ? "Salir de pantalla completa" : "Ver en pantalla completa"}
            aria-pressed={full}
            onClick={() => setFull((f) => !f)}
          >
            {full ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
        </div>
        {photos.length > 1 && (
          <div className="dv2-thumbs">
            <button type="button" className="dv2-thumbs-step" aria-label="Ver miniaturas anteriores" onClick={() => scrollThumbs(-1)}>
              <ChevronLeft size={18} />
            </button>
            <ol ref={thumbs} aria-label="Fotos de la propiedad">
              {photos.map((p, i) => (
                <li key={p.id}>
                  <button
                    type="button"
                    data-index={i}
                    aria-label={`Ver foto ${i + 1}`}
                    aria-current={i === index ? "true" : undefined}
                    className={i === index ? "is-on" : ""}
                    onClick={() => setIndex(i)}
                  >
                    <img src={urlFor(source, p.id, null, 480)} alt="" loading="lazy" />
                  </button>
                </li>
              ))}
            </ol>
            <button type="button" className="dv2-thumbs-step" aria-label="Ver más miniaturas" onClick={() => scrollThumbs(1)}>
              <ChevronRight size={18} />
            </button>
          </div>
        )}
      </div>
      {panel && (
        <aside className="dv2-aside">
          {panel}
          {sideInvite}
          {sideAction && <div className="dv2-side-action">{sideAction}</div>}
          <span className="dv2-tech dv2-side-tech">
            <Sparkles size={12} aria-hidden="true" /> Tecnología de <b>habita.</b>
          </span>
        </aside>
      )}
    </div>
  );
}

/**
 * The agency's way from its demo into its own panel, with this same
 * property, photos and versions: the team's private invitation. The same
 * text and destination next to the result and at the end of the page.
 */
function PanelInvite({
  invite,
  place,
  log,
}: {
  invite: Exclude<DemoInvite, null>;
  place: "lateral" | "final";
  log: (event: string, extra?: Record<string, unknown>) => unknown;
}) {
  const id = `dv2-invite-${place}`;
  if ("unavailable" in invite)
    return (
      <section className={`dv2-invite is-${place}`} aria-labelledby={id}>
        <p className="dv2-invite-eyebrow">Para tu inmobiliaria</p>
        <h2 id={id}>Esta invitación ya no está disponible</h2>
        <p>El enlace venció o ya se usó. Pedile uno nuevo al equipo de habita para trabajar esta propiedad en tu panel.</p>
      </section>
    );
  return (
    <section className={`dv2-invite is-${place}`} aria-labelledby={id}>
      <p className="dv2-invite-eyebrow">Para tu inmobiliaria</p>
      <h2 id={id}>Probá con esta misma propiedad</h2>
      <p>Preparamos esta demostración para tu inmobiliaria. Entrá a tu panel para trabajar sus fotos y sumar otras propiedades.</p>
      <a className="dv2-invite-cta" href={invite.href} onClick={() => log("demo_agency_cta_clicked", { origen: `demo_invitacion_${place}` })}>
        Probar esta propiedad en mi panel
      </a>
      <small>
        <Lock size={14} aria-hidden="true" /> Conservás las fotos y ambientaciones que estás viendo.
      </small>
      {invite.freeCredits > 0 && (
        <small>
          Incluye {invite.freeCredits} {invite.freeCredits === 1 ? "crédito" : "créditos"} para ambientar fotos nuevas.
        </small>
      )}
    </section>
  );
}

/**
 * The agency's own panel above its demo: who it is, its main sections and
 * the actions that need the access. Every one of them goes through the
 * private invitation; only this property is open here.
 */
/**
 * The agency's gift credits, in the bar: how many it has, what they are for and
 * where to get more. A native details element, so it opens the same on a phone.
 */
function OwnerCredits({
  owner,
  log,
  onPrices,
}: {
  owner: OwnerMode;
  log: (event: string, extra?: Record<string, unknown>) => unknown;
  onPrices: () => void;
}) {
  const gift = owner.freeCredits;
  return (
    <details className="dv2-owner-credits" onToggle={(e) => e.currentTarget.open && log("demo_owner_creditos")}>
      <summary>
        <CircleDollarSign size={17} aria-hidden="true" /> Créditos
        <span className="dv2-owner-count">{gift > 0 ? `${gift} de regalo` : "Sin regalo"}</span>
      </summary>
      <div className="dv2-owner-menu">
        <strong>{gift > 0 ? `Tenés ${gift} ${gift === 1 ? "crédito" : "créditos"} de regalo` : "No tenés créditos de regalo"}</strong>
        <p>Cada estilo nuevo usa 1 crédito. Descargar es gratis.</p>
        <a href="#dv2-estilos" onClick={() => log("demo_owner_generar_menu")}>
          <Sparkles size={16} aria-hidden="true" /> Generar sin registrarte
          <small>Usá tus créditos ahora. Al guardar tu panel, quedan en tu cuenta.</small>
        </a>
        <div className="dv2-owner-menu-more">
          <span>¿Necesitás más?</span>
          <button
            type="button"
            onClick={() => {
              log("demo_owner_precios");
              onPrices();
            }}
          >
            Ver precios
          </button>
        </div>
      </div>
    </details>
  );
}

/** The plans of /precios, opened from the agency's bar: on the right, inside its environment. */
function PricesDrawer({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const close = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  return (
    <div className="dv2-prices" role="dialog" aria-modal="true" aria-label="Planes y créditos">
      <div className="dv2-prices-head">
        <button type="button" className="dv2-prices-back" onClick={onClose}>
          ← Volver a la demo
        </button>
      </div>
      <div className="dv2-prices-body">{children}</div>
    </div>
  );
}

function OwnerHeader({
  demo,
  owner,
  log,
  plans,
}: {
  demo: PublicDemo;
  owner: OwnerMode;
  log: (event: string, extra?: Record<string, unknown>) => unknown;
  plans: React.ReactNode;
}) {
  const [prices, setPrices] = useState(false);
  const closePrices = useCallback(() => setPrices(false), []);
  const versions = demo.photos.reduce((n, p) => n + p.versions.length, 0);
  const go = (origin: string) => ({ href: owner.href, onClick: () => log("demo_agency_cta_clicked", { origen: `demo_encabezado_${origin}` }) });
  const initials = demo.agencyName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  return (
    <header className="dv2-owner">
      <div className="dv2-owner-bar">
        <div className="dv2-owner-brand">
          {demo.agency.logo ? (
            <img src={demo.agency.logo} alt="" className="dv2-owner-logo" />
          ) : (
            <span className="dv2-owner-logo" aria-hidden="true">
              {initials}
            </span>
          )}
          <span>
            <strong>{demo.agencyName}</strong>
            <small>Modo demostración</small>
          </span>
        </div>
        <nav className="dv2-owner-nav" aria-label="Panel de la inmobiliaria">
          <a {...go("inicio")}>
            <Home size={17} aria-hidden="true" /> Inicio
          </a>
          <a href="#propiedad" aria-current="page" className="is-on">
            <LayoutGrid size={17} aria-hidden="true" /> Mis propiedades <span className="dv2-owner-count">1</span>
          </a>
          <a {...go("imagenes")}>
            <ImageIcon size={17} aria-hidden="true" /> Imágenes
          </a>
          <OwnerCredits owner={owner} log={log} onPrices={() => setPrices(true)} />
          <a className="dv2-owner-create-chip" {...go("crear_movil")}>
            <Plus size={17} aria-hidden="true" /> Crear propiedad
          </a>
        </nav>
        <div className="dv2-owner-ctas">
          <a className="dv2-owner-create" {...go("crear")}>
            <Plus size={17} aria-hidden="true" /> Crear propiedad
          </a>
          <a className="dv2-owner-save" {...go("guardar")}>
            Guardar mi panel
          </a>
        </div>
      </div>
      <p className="dv2-owner-strip">
        <span>
          <strong>Modo demostración.</strong>{" "}
          {versions ? `${versions} ${versions === 1 ? "versión lista" : "versiones listas"} para descargar gratis.` : "Generá versiones con IA desde tu panel."}{" "}
          <span className="dv2-owner-strip-long">Para el resto de los estilos y fotos, tocá Generar.</span>
        </span>
        <a href={owner.buyerHref} onClick={() => log("demo_owner_buyer_view")}>
          Ver como comprador
        </a>
      </p>
      {prices && (
        <PricesDrawer onClose={closePrices}>
          {plans}
        </PricesDrawer>
      )}
    </header>
  );
}
