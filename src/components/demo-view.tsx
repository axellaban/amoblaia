"use client";
import { formatRatio } from "@/lib/video/plan";
import { freeCreditsLine } from "@/lib/commerce/credit-packs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  Image as ImageIcon,
  Info,
  LayoutGrid,
  Link2 as Link2Icon,
  Lock,
  Menu,
  Mail,
  MapPin,
  Maximize2,
  MessageCircle,
  Minimize2,
  Phone,
  Play,
  Plus,
  RotateCw,
  Ruler,
  Share2,
  Sparkles,
  Tag,
  Volume2,
  Eye,
  ArrowRight,
  House,
  X,
} from "lucide-react";
import { Comparison } from "./comparison";
import { PENDING_IMPORT_KEY, withIntent, type DemoIntent, type DemoInvite } from "@/lib/agency/demo-invite";
import { registerSuperProperties, registerSuperPropertiesOnce, track, type EventProperties } from "@/lib/analytics";
import { cta, startDemoEngagement, ViewTimer } from "@/lib/interaction-tracking";
import { reportDemoActivity } from "@/lib/demos/activity-client";
import { flushLeads, leadActiveTime, leadEvent, startLeadTracking } from "@/lib/leads/client";
import { usePathname, useRouter } from "next/navigation";
import { requestPublicStaging } from "@/lib/demos/staging-client";
import { textOn, whatsappNumber, type FactIcon } from "@/lib/demos/branding";
import { DEMO_STYLES, demoStyleName } from "@/lib/demos/styles";
import {
  RETOUCH_STYLE,
  adminPhotoUrl,
  ctaHref,
  DEMO_REF_KEY,
  publicImageUrl,
  publicVideoUrl,
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
/** The agency's own view lists six styles first (two rows of three on desktop, a scrollable row on phones). */
const OWNER_VISIBLE_STYLES = 6;

/**
 * The agency looking at its own demo with a live invitation: its panel on
 * top, and next to each style the action that fits it. A prepared version is
 * downloaded; any other style is generated from the panel, which asks for
 * the access (and shows the cost) first.
 */
export type OwnerMode = {
  /** The invitation code: the agency's way into its demo's editing (the server checks it). */
  code: string;
  href: string;
  /** Its own panel, opened on its home without creating the account first (Ingresar al panel). */
  panelHref: string;
  freeCredits: number;
  buyerHref: string;
  /** The presentation itself and its plans: the two sections under the agency's bar, each with its own link. */
  demoHref: string;
  pricesHref: string;
};

const fileSlug = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

/** A duration as m:ss (92 000 ms → "1:32"). */
const clock = (ms: number) => {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

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
  if (wa) actions.push({ href: waHref(ask)!, label: "Contactar por WhatsApp", short: "Consultar", kind: "whatsapp" });
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
  backToDemo = null,
}: {
  demo: PublicDemo;
  source: Source;
  /** The link for the agency: may show the "Demo preparada para…" strip. */
  presentation?: boolean;
  /** The private invitation carried by the presentation link (validated on the server), if any. */
  invite?: DemoInvite;
  /** The agency viewing its own demo through its invitation: its panel header and the download or generate actions. */
  owner?: OwnerMode | null;
  /** The plans of /precios, shown under the agency's bar. */
  plans?: React.ReactNode;
  /** The agency looking at its buyers' page ("Ver como comprador"): the way back to its demo, nothing else of its tools. */
  backToDemo?: string | null;
}) {
  const { agency } = demo;
  const [pageUrl, setPageUrl] = useState("");
  // The agent's photo lives on the agency's site: if it fails, the initials stand in.
  const [agentPhotoFailed, setAgentPhotoFailed] = useState(false);
  const ownerMode = Boolean(owner);
  // How the visitor got here, never the invitation code itself.
  const linkKind = ownerMode
    ? "owner_invitation"
    : presentation && invite && "href" in invite
      ? "presentation_invitation"
      : presentation && invite
        ? "presentation_invite_unavailable"
        : presentation
          ? "presentation"
          : "buyer";
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
      agency_id: demo.agencyId,
      demo_link_type: linkKind,
      owner_mode: ownerMode,
    }),
    [demo.id, demo.title, agency.name, demo.agencyId, demo.photos, presentation, linkKind, ownerMode],
  );
  // The same ficha inside the agency's own site is one more way in.
  const linkType = useRef<string>(linkKind);
  // Lead score: the deliberate actions of this page view (src/lib/leads). Started before the visit is reported.
  useEffect(() => {
    if (source.kind !== "public") return;
    return startLeadTracking(source.token, window.location.pathname.startsWith("/inmobiliaria/") ? "agency_site" : linkType.current);
    // A new page view per demo; the link kind is read once.
  }, [source.kind, demo.id]);
  // One visit per demo: the page refreshing (while a style is generated) is not a new one.
  const viewed = useRef("");
  useEffect(() => {
    setPageUrl(window.location.href.split(/[?#]/)[0]);
    if (source.kind !== "public" || viewed.current === demo.id) return;
    viewed.current = demo.id;
    if (window.location.pathname.startsWith("/inmobiliaria/")) linkType.current = "agency_site";
    const via = { demo_link_type: linkType.current };
    // Last touch on every later event, first touch kept for the whole journey (sign-up, first import…).
    registerSuperProperties({
      demo_id: demo.id,
      demo_titulo: demo.title,
      demo_inmobiliaria: agency.name,
      demo_inmobiliaria_id: demo.agencyId,
      ...via,
    });
    registerSuperPropertiesOnce({ first_demo_id: demo.id, first_demo_agency_id: demo.agencyId, first_demo_link_type: linkType.current });
    // A person profile only for the agencies the team writes to, not for every buyer.
    const prospect = linkType.current !== "buyer" && linkType.current !== "agency_site";
    track(
      "demo_vista",
      { ...analytics, ...via },
      false,
      prospect ? { first_demo_id: demo.id, first_demo_agency_id: demo.agencyId, first_demo_link_type: linkType.current } : undefined,
    );
    reportDemoActivity(source.token, "visita");
    leadEvent("demo_opened");
    try {
      // The token lets the sign-up and the panel credit their steps to this demo (lead score).
      localStorage.setItem(
        DEMO_REF_KEY,
        JSON.stringify({ demoId: demo.id, agencyId: demo.agencyId, token: source.token, link: linkType.current, at: Date.now() }),
      );
    } catch {
      /* Private mode or blocked storage. */
    }
  }, [source.kind, demo.id, demo.title, agency.name, demo.agencyId, analytics]);
  useEffect(() => {
    if (source.kind !== "public") return;
    return startDemoEngagement({ demo_id: demo.id, agency_id: demo.agencyId, demo_link_type: linkType.current, owner_mode: ownerMode }, leadActiveTime);
  }, [source.kind, demo.id, demo.agencyId, ownerMode]);

  const { primary, others, visitHref } = contactActions(demo, pageUrl);
  // "Enviar consulta": the agency's email or its contact page, when the main channel is another one.
  const inquiry = others.find((a) => a.kind === "email" || a.kind === "url") ?? null;
  // The bar at the bottom of phones only once the contact next to the gallery left the screen: it never covers it.
  const contactBox = useRef<HTMLDivElement>(null);
  const [contactInView, setContactInView] = useState(true);
  useEffect(() => {
    const el = contactBox.current;
    if (!el || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver((e) => setContactInView(e.some((x) => x.isIntersecting) || el.getBoundingClientRect().top > window.innerHeight));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  // "Compartir": the buyers' link of this same property, on the domain it is opened from.
  const [shareNote, setShareNote] = useState("");
  async function shareListing() {
    if (source.kind !== "public") return;
    const url = window.location.pathname.startsWith("/inmobiliaria/") ? window.location.href.split(/[?#]/)[0] : `${window.location.origin}/demo/${source.token}`;
    note("demo_buyer_share", { method: typeof navigator.share === "function" ? "native" : "copy" });
    try {
      if (typeof navigator.share === "function") await navigator.share({ title: demo.title, text: `${demo.title} · ${agency.name}`, url });
      else {
        await navigator.clipboard.writeText(url);
        setShareNote("Enlace copiado.");
        window.setTimeout(() => setShareNote(""), 3000);
      }
    } catch {
      // Cancelled by the visitor.
    }
  }
  const interacted = useRef(false);
  /** `beacon` for a click that leaves the page in this same tab. */
  const log = (event: string, extra: EventProperties = {}, beacon = false) => {
    if (source.kind !== "public") return;
    track(event, { ...analytics, demo_link_type: linkType.current, ...extra }, beacon);
    if (event === "demo_agency_cta_clicked") {
      // It usually leaves the page: sent right away.
      leadEvent("demo_agency_cta_clicked");
      flushLeads(true);
    }
    // A download is its own step for the team's list; the server ignores repeats.
    // A real value action of the agency (spec §8): what it obtained, not a tap on a style.
    const VALUE: Record<string, string> = { demo_owner_download: "download", demo_owner_share: "share", demo_owner_generation_started: "generation", demo_owner_retouch_saved: "edit" };
    if (VALUE[event]) track("demo_value_action", { ...analytics, demo_link_type: linkType.current, subtype: VALUE[event] });
    if (event === "demo_owner_download") reportDemoActivity(source.token, "descarga");
    // The first other interaction of this visit is step 2.
    else if (!interacted.current) {
      interacted.current = true;
      reportDemoActivity(source.token, "interaccion");
    }
  };
  // Behavior only (photos, full screen, time per style): PostHog, without touching the team's activity steps.
  const note = (event: string, extra: EventProperties = {}) => {
    if (source.kind !== "public") return;
    track(event, { ...analytics, demo_link_type: linkType.current, ...extra });
  };
  // The plans are a section of the agency's environment with its own link (…/precios): the bar stays, the
  // property is only hidden (a style being generated keeps going) and the browser's back button returns to it.
  const pathname = usePathname();
  const pricesOn = Boolean(owner) && (pathname?.endsWith("/precios") ?? false);
  const pricesSince = useRef(0);
  const pricesExit = useRef("history");
  const noteRef = useRef(note);
  noteRef.current = note;
  useEffect(() => {
    if (pricesOn) {
      pricesSince.current = Date.now();
      // The plans are on screen (by the link, the bar or the credits menu).
      leadEvent("demo_pricing_viewed");
      return;
    }
    if (!pricesSince.current) return;
    noteRef.current("demo_prices_closed", { method: pricesExit.current, duration_ms: Date.now() - pricesSince.current });
    pricesSince.current = 0;
    pricesExit.current = "history";
  }, [pricesOn]);
  // Opened straight from the link the team sends.
  const pricesLanding = useRef(pricesOn);
  useEffect(() => {
    // Once, on arrival.
    if (pricesLanding.current) log("demo_owner_precios", { origen: "enlace" });
  }, []);
  const showPrices = (origin: string) => {
    if (!owner) return;
    log("demo_owner_precios", { origen: origin });
    if (!pricesOn) window.history.pushState(null, "", owner.pricesHref);
    window.scrollTo({ top: 0 });
  };
  const showDemo = (method: string) => {
    if (!owner || !pricesOn) return;
    pricesExit.current = method;
    window.history.pushState(null, "", owner.demoHref);
    window.scrollTo({ top: 0 });
  };
  const contactLink = (a: Action, className: string, place: string, label = a.label) => (
    <a
      className={className}
      href={a.href}
      {...(a.kind === "phone" || a.kind === "email" ? {} : external)}
      {...cta(`contact_${a.kind}`, place, a.kind === "url" ? "agency_contact_page" : a.kind, a.kind === "listing" ? "navigation" : "buyer_contact")}
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
      {owner && <OwnerHeader demo={demo} owner={owner} log={log} pricesOn={pricesOn} onPrices={showPrices} onDemo={showDemo} />}
      {backToDemo && (
        <a className="dv2-back-demo" href={backToDemo} {...cta("buyer_back_to_demo", "buyer_view", "demo", "navigation")}>
          <ArrowLeft size={16} aria-hidden="true" /> Volver al modo demo
        </a>
      )}
      {owner && pricesOn && (
        <section className="dv2-prices" aria-label="Precios y créditos">
          <div className="container dv2-prices-head">
            <button type="button" className="dv2-prices-back" {...cta("prices_back", "pricing_section", "demo", "navigation")} onClick={() => showDemo("button")}>
              ← Volver a la propiedad
            </button>
          </div>
          <div className="dv2-prices-body">{plans}</div>
        </section>
      )}
      {!owner && !backToDemo && presentation && demo.banner && (
        <div className="dv2-banner" role="note">
          Demo preparada para {agency.name} ·{" "}
          <a href={ctaHref(demo.id, demo.agencyId)} {...external} {...cta("banner_by_habita", "banner", "habita_studio")} onClick={() => log("demo_cta_click")}>
            Por habita.
          </a>
        </div>
      )}
      {!owner && (
        <header className="dv2-header is-buyer">
          <div className="container">
            <span className="dv2-owner-habita dv2-habita-mark" aria-label="Habita">
              <House size={20} aria-hidden="true" />
              <span aria-hidden="true">HABITA</span>
            </span>
            {source.kind === "public" && (
              <button type="button" className="dv2-header-share" onClick={() => void shareListing()} {...cta("buyer_share", "header", "share_listing", "content")}>
                <Share2 size={17} aria-hidden="true" /> <span>Compartir</span>
              </button>
            )}
          </div>
          {shareNote && (
            <p className="dv2-share-note" role="status">
              {shareNote}
            </p>
          )}
        </header>
      )}

      <div className="container dv2-main" hidden={pricesOn}>
        {owner ? (
          <section id="propiedad" className="dv2-hero is-compact" aria-labelledby="dv2-hero-title">
            <h1 id="dv2-hero-title" className="dv2-sr">
              Demo de {demo.title} para {agency.name}
            </h1>
            <p className="dv2-hero-pill">Demo para inmobiliaria</p>
            <a className="dv2-buyer-link" href={owner.buyerHref} {...cta("owner_buyer_view", "heading", "demo_buyer_view", "navigation")} onClick={() => log("demo_owner_buyer_view", {}, true)}>
              <Eye size={17} aria-hidden="true" /> Ver como comprador <ArrowRight size={17} aria-hidden="true" />
            </a>
          </section>
        ) : (
        <section id="propiedad" className="dv2-heading is-buyer" aria-labelledby="dv2-title">
          <div>
            {demo.reference && <p className="dv2-ref">Ref. {demo.reference}</p>}
            <h1 id="dv2-title">{demo.title}</h1>
            {demo.location && (
              <p className="dv2-location">
                <MapPin size={17} aria-hidden="true" /> {demo.location}
              </p>
            )}
          </div>
        </section>
        )}

        <Gallery
          demo={demo}
          source={source}
          log={log}
          note={note}
          aside={
            owner ? null : (
              <>
                <div className="dv2-summary" aria-label="Resumen de la propiedad">
                  <p className={`dv2-price ${demo.price ? "" : "is-ask"}`}>
                    {demo.operation && <span className="dv2-chip">{demo.operation}</span>}
                    <strong>{priceLabel}</strong>
                  </p>
                  {demo.features && <p className="dv2-features">{demo.features}</p>}
                </div>
                {(primary || visitHref) && (
                  <div className="dv2-buyer-contact" ref={contactBox}>
                    {primary && contactLink(primary, "dv2-contact-main", "gallery_side")}
                    {inquiry && contactLink(inquiry, "dv2-contact-alt", "gallery_side", "Enviar consulta")}
                    {visitHref && (
                      <a className="dv2-contact-alt" href={visitHref} {...external} {...cta("schedule_visit", "gallery_side", "visit_scheduling", "buyer_contact")} onClick={() => log("demo_visita")}>
                        <CalendarDays size={18} aria-hidden="true" /> <span>Agendar visita</span>
                      </a>
                    )}
                  </div>
                )}
                {!backToDemo && presentation && demo.prospect && invite && <PanelInvite invite={invite} place="lateral" log={log} />}
              </>
            )
          }
          owner={owner}
          ownerActions={
            owner && source.kind === "public" ? (
              <>
                <OwnerValue demo={demo} token={source.token} log={log} />
                <OwnerSaveDemo owner={owner} log={log} />
              </>
            ) : null
          }
        />
        {demo.photos.some((p) => p.versions.length) && <p className="dv2-illustrative">{TEXT.illustrative}</p>}
        {!owner && (
          <nav className="dv2-tabs" aria-label="La ficha de la propiedad">
            <a href="#sobre">Sobre la propiedad</a>
            <a href="#propiedad">Galería</a>
            {(demo.map || demo.location) && <a href="#ubicacion">Ubicación</a>}
            <a href="#contacto">Contactar</a>
          </nav>
        )}
        {owner && source.kind === "public" && (
          <>
            <AnotherProperty owner={owner} log={log} />
            <nav className="dv2-tabs" aria-label="La ficha de la propiedad">
              <a href="#sobre">Sobre la propiedad</a>
              <a href="#propiedad">Galería</a>
              {(demo.map || demo.location) && <a href="#ubicacion">Ubicación</a>}
              <a href="#contacto">Contactar</a>
            </nav>
            <section id="sobre" className="dv2-heading is-ficha" aria-labelledby="dv2-title">
          <div>
            {demo.reference && <p className="dv2-ref">Ref. {demo.reference}</p>}
            <h2 id="dv2-title">{demo.title}</h2>
            {demo.location && (
              <p className="dv2-location">
                <MapPin size={17} aria-hidden="true" /> {demo.location}
              </p>
            )}
            {demo.features && <p className="dv2-features">{demo.features}</p>}
          </div>
          <div className="dv2-heading-side">
            <p className={`dv2-price ${demo.price ? "" : "is-ask"}`}>
              {demo.operation && <span className="dv2-chip">{demo.operation}</span>}
              <strong>{priceLabel}</strong>
            </p>
            {primary && primary.kind !== "listing" && contactLink(primary, "dv2-ficha-contact", "ficha_heading", "Consultar por esta propiedad")}
          </div>
        </section>
          </>
        )}

        {demo.facts.length > 0 && (
          <ul id={owner ? undefined : "sobre"} className="dv2-facts" aria-label="Datos principales">
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

        <div className="dv2-body" id={owner || demo.facts.length > 0 ? undefined : "sobre"}>
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
            <Brand agency={agency} small place="contact_card" />
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
            {primary && contactLink(primary, "dv2-contact-main", "contact_card")}
            {others.map((a) => (
              <span key={a.kind}>{contactLink(a, "dv2-contact-alt", "contact_card")}</span>
            ))}
            {demo.listingUrl && primary?.kind !== "listing" && (
              <a
                className="dv2-contact-link"
                href={demo.listingUrl}
                {...external}
                {...cta("contact_listing", "contact_card", "listing", "navigation")}
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
        {!owner && !backToDemo && presentation && demo.prospect && invite && <PanelInvite invite={invite} place="final" log={log} />}
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
                {...cta("create_agency", "habita_section", "agency_signup")}
                onClick={() => log("demo_agency_cta_clicked", { origen: "demo", cta_id: "create_agency", cta_location: "habita_section" }, true)}
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
            <a className="dv2-closing-cta" href={visitHref} {...external} {...cta("schedule_visit", "closing", "visit_scheduling", "buyer_contact")} onClick={() => log("demo_visita")}>
              <CalendarDays size={18} aria-hidden="true" /> Coordinar una visita
            </a>
          ) : (
            primary && contactLink(primary, "dv2-closing-cta", "closing")
          )}
        </section>
      </div>

      <footer className="dv2-footer" hidden={pricesOn}>
        <div className="container">
          <Brand agency={agency} small place="footer" />
          <nav aria-label="Enlaces">
            {demo.listingUrl && (
              <a href={demo.listingUrl} {...external} {...cta("contact_listing", "footer", "listing", "navigation")}>
                Ver aviso original
              </a>
            )}
            <a href="#contacto" {...cta("nav_contact", "footer", "section_contact", "navigation")}>
              Contacto
            </a>
          </nav>
          <span className="dv2-tech">
            <Sparkles size={12} aria-hidden="true" /> Tecnología de <b>habita.</b>
          </span>
        </div>
      </footer>
      {primary && !owner && !contactInView && <div className="dv2-sticky">{contactLink(primary, "dv2-contact-main", "sticky_bar")}</div>}
    </div>
  );
}

function ContactIcon({ kind }: { kind: Action["kind"] }) {
  const Icon =
    kind === "whatsapp" ? MessageCircle : kind === "phone" ? Phone : kind === "email" ? Mail : ExternalLink;
  return <Icon size={18} aria-hidden="true" />;
}

function Brand({ agency, small = false, place }: { agency: PublicDemo["agency"]; small?: boolean; place: string }) {
  const inner = agency.logo ? <img src={agency.logo} alt={agency.name} /> : <strong>{agency.name}</strong>;
  const className = `dv2-brand ${small ? "is-small" : ""}`;
  return agency.website ? (
    <a className={className} href={agency.website} {...external} {...cta("agency_website", place, "agency_website", "buyer_contact")}>
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
      <a className="dv2-map-open" href={open} target="_blank" rel="noopener noreferrer" {...cta("open_map", "location", "external_map", "content")}>
        Abrir el mapa en otra pestaña
      </a>
    </>
  );
}

/** One entry of the carousel: a photo (by its index) or the property's video. */
type Entry = { kind: "photo"; index: number } | { kind: "video" };

/**
 * One carousel of the property's photos, each with the styles prepared for
 * it, and the property's video where the agency placed it: first or second
 * among the thumbnails, or a card under the gallery. The agency's "Generar"
 * opens «Ambientá con IA» over the demo while it has gift credits (one per
 * style, spent on the server); without them, and for the photos still without
 * a staging, it leads to its panel.
 */
function Gallery({
  demo,
  source,
  log,
  note,
  aside = null,
  owner = null,
  ownerActions = null,
}: {
  demo: PublicDemo;
  source: Source;
  log: (event: string, extra?: EventProperties, beacon?: boolean) => unknown;
  note: (event: string, extra?: EventProperties) => unknown;
  /** The buyers' column under the styles: the property's summary and the contact with the agency. */
  aside?: React.ReactNode;
  /** The agency's own view: every style, ready to choose or "Generar" in its panel. */
  owner?: OwnerMode | null;
  /** The agency's "Descargar imágenes" and "Compartir ficha", under its styles. */
  ownerActions?: React.ReactNode;
}) {
  const photos = demo.photos;
  const styleNames = useMemo(
    () => Object.fromEntries(demo.styles.map((s) => [s.id, s.name])) as Record<string, string>,
    [demo.styles],
  );
  // A retouch the listing shows is one more option: the photo as its owner saved it.
  const name = (style: string) => styleNames[style] ?? (style === RETOUCH_STYLE ? "Retocada" : demoStyleName(style));
  // The agency's own view always opens compared: the chosen style, else the first style with a staging.
  const openStyle = owner
    ? (demo.openStyle ?? demo.styles.find((st) => photos.some((p) => p.versions.some((v) => v.style === st.id)))?.id ?? null)
    : demo.openStyle;
  // The before/after is the first impression, even with the video first among the thumbnails:
  // the agency opens on the first photo with a staging, the buyers on the first photo.
  const [index, setIndex] = useState(() => (owner ? Math.max(0, photos.findIndex((p) => p.versions.length > 0)) : 0));
  // The video in the big frame instead of a photo (only a real, finished one; only public links can play it).
  const video = source.kind === "public" ? demo.video : null;
  // Placed first by the agency: the buyers' page opens on the video, playing by itself (muted, as browsers allow).
  const [videoOn, setVideoOn] = useState(() => !owner && video?.placement === "first");
  const [muted, setMuted] = useState(true);
  const player = useRef<HTMLVideoElement>(null);
  // Remembered per photo during the visit.
  const [states, setStates] = useState<Record<string, PhotoState>>({});
  // The style last chosen: photos not seen yet open in it when they have it.
  const lastStyle = useRef(openStyle);
  // Where the comparison line was last left, on any photo.
  const lastPosition = useRef(50);
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const [retries, setRetries] = useState<Record<string, number>>({});
  const [ratios, setRatios] = useState<Record<string, number>>({});
  const lastRatio = useRef(4 / 3);
  const [full, setFull] = useState(false);
  const [allStyles, setAllStyles] = useState(false);
  // «Ambientá con IA»: the photo and style it opened with, and the agency's gift credits left.
  const [generate, setGenerate] = useState<{ photoId: string; style: string } | null>(null);
  const [credits, setCredits] = useState(owner?.freeCredits ?? 0);
  // Five thumbnails and "+N fotos" (the mockup); the rest open on demand.
  const [allThumbs, setAllThumbs] = useState(false);
  // Buyers on phones: «Estilos» and «Video» share one place, as two tabs (the mockup); on desktop both show.
  const [asideTab, setAsideTab] = useState<"styles" | "video">("styles");
  const thumbs = useRef<HTMLOListElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  // What the timers and the slider report with every event (the rest comes from the demo's super properties).
  const base = { demo_id: demo.id, agency_id: demo.agencyId, owner_mode: Boolean(owner) };

  // The carousel's order: the video first or second when the agency placed it there.
  const entries = useMemo<Entry[]>(() => {
    const list: Entry[] = photos.map((_, i) => ({ kind: "photo", index: i }));
    if (video?.placement === "first") list.unshift({ kind: "video" });
    else if (video?.placement === "second") list.splice(Math.min(1, list.length), 0, { kind: "video" });
    return list;
  }, [photos, video?.placement]);
  const at = videoOn ? entries.findIndex((e) => e.kind === "video") : entries.findIndex((e) => e.kind === "photo" && e.index === index);

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
  const comparing = Boolean(showing && state.compare) && !videoOn;
  const alt = (i: number, p: PublicPhoto) => `${demo.title}, foto ${i + 1}${p.label ? `: ${p.label}` : ""}`;

  const setState = useCallback(
    (next: PhotoState) => photo && setStates((s) => ({ ...s, [photo.id]: next })),
    [photo],
  );
  // How the visitor moved to the photo on screen, reported once it changes.
  const navMethod = useRef("arrow");
  const show = useCallback(
    (entry: Entry | undefined, method: string) => {
      if (!entry) return;
      navMethod.current = method;
      if (entry.kind === "video") {
        // Opened by a tap: the browser lets it play with sound.
        setMuted(false);
        setVideoOn(true);
        note("demo_video_opened", { placement: video?.placement ?? "", method });
        return;
      }
      setVideoOn(false);
      setIndex(entry.index);
    },
    // note is rebuilt on every render; the video's placement is what matters.
    [video?.placement],
  );
  // The video plays as soon as it is on screen (muted when it opens the page by itself).
  useEffect(() => {
    const v = player.current;
    if (!videoOn || !v) return;
    v.muted = muted;
    void v.play().catch(() => {
      // Sound not allowed without a tap: muted, it can still start.
      if (!v.muted) {
        v.muted = true;
        setMuted(true);
        void v.play().catch(() => null);
      }
    });
    // Only when the video comes on screen; the sound button changes muted without restarting it.
  }, [videoOn, video?.id]);

  const go = useCallback(
    (step: number, method = "arrow") => {
      if (!entries.length) return;
      const from = at < 0 ? 0 : at;
      show(entries[(from + step + entries.length) % entries.length], method);
    },
    [entries, at, show],
  );
  // The styles chosen during the visit, in order: which comes first and how many are tried.
  const picks = useRef<string[]>([]);
  const choose = (style: string) => {
    setVideoOn(false);
    // The line stays where the buyer left it: moved all the way to one side,
    // the next style is seen the same way, not from the middle again.
    setState({ style, compare: true, position: state.style && state.compare ? state.position : lastPosition.current });
    lastStyle.current = style;
    picks.current.push(style);
    leadEvent("demo_style_selected", { style });
    log("demo_estilo", {
      estilo: style,
      photo_id: photo.id,
      photo_index: index,
      style_id: style,
      previous_style_id: state.style ?? "original",
      selection_order: picks.current.length,
      distinct_styles: new Set(picks.current).size,
    });
  };
  const seen = useRef(new Set<number>());
  const shownIndex = useRef(index);
  useEffect(() => {
    seen.current.add(index);
    if (shownIndex.current === index) return;
    // The first photo is shown by itself; only a change made by the visitor gets here.
    if (photos[index]) leadEvent("demo_photo_selected", { photo: photos[index].id });
    note("demo_photo_changed", {
      photo_id: photos[index]?.id ?? "",
      photo_index: index,
      from_photo_id: photos[shownIndex.current]?.id ?? "",
      from_index: shownIndex.current,
      method: navMethod.current,
      photos_total: photos.length,
      photos_seen: seen.current.size,
    });
    shownIndex.current = index;
    // Only a change of photo is reported.
  }, [index]);
  const fullMethod = useRef("button");
  const wasFull = useRef(full);
  useEffect(() => {
    if (wasFull.current === full) return;
    wasFull.current = full;
    note("demo_fullscreen_toggled", { action: full ? "open" : "close", method: fullMethod.current, photo_id: photos[index]?.id ?? "", photo_index: index });
    // Only opening or closing is reported.
  }, [full]);

  // Arrows move between photos (not while the comparison slider or the player has the focus); Esc leaves full screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        fullMethod.current = "escape";
        return setFull(false);
      }
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, video")) return;
      if (e.key === "ArrowRight") go(1, "keyboard");
      if (e.key === "ArrowLeft") go(-1, "keyboard");
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
    const item = list?.querySelector<HTMLElement>(`[data-entry="${at}"]`);
    if (list && item) list.scrollTo({ left: item.offsetLeft - list.clientWidth / 2 + item.clientWidth / 2, behavior: "smooth" });
    const next = photos[(index + 1) % Math.max(1, photos.length)];
    if (next && next !== photo) new Image().src = urlFor(source, next.id, null, 2048);
  }, [index, at, photos, photo, source]);

  // Every photo's proportions, measured up front from the thumbnail-sized original: opening one
  // never shows it in other proportions first (the frame of the agency's demo follows the photo).
  const sourceKey = source.kind === "public" ? source.token : "preview";
  useEffect(() => {
    let alive = true;
    for (const p of photos) {
      const img = new Image();
      img.onload = () => {
        const { naturalWidth: w, naturalHeight: h } = img;
        if (alive && w && h) setRatios((r) => (r[p.id] ? r : { ...r, [p.id]: w / h }));
      };
      img.src = urlFor(source, p.id, null, 480);
    }
    return () => {
      alive = false;
    };
    // The photos and where they are served from; source itself is the same link.
  }, [photos, sourceKey]);

  // The strip scrolls a page at a time; the photo changes only on a thumbnail or the arrows on it.
  const scrollThumbs = (step: number) => {
    note("demo_thumbnails_scrolled", { direction: step > 0 ? "next" : "previous" });
    thumbs.current?.scrollBy({ left: step * thumbs.current.clientWidth * 0.8, behavior: "smooth" });
  };

  // Time on screen of each photo in each style (or its original), counted while the tab is visible.
  const views = useRef<ViewTimer | null>(null);
  useEffect(() => {
    if (source.kind !== "public") return;
    const timer = new ViewTimer("demo_style_viewed");
    views.current = timer;
    return () => {
      timer.dispose();
      views.current = null;
    };
  }, [source.kind]);
  const viewStyle = photo ? (versionOf(photo, state.style) && !stagedFailed ? state.style : null) : null;
  const viewMode = viewStyle ? (state.compare ? "compare" : "staged") : "original";
  useEffect(() => {
    if (!photo || videoOn) return;
    views.current?.show(`${photo.id}:${viewStyle ?? "o"}:${viewMode}`, {
      ...base,
      photo_id: photo.id,
      photo_index: index,
      style_id: viewStyle ?? "original",
      view_mode: viewMode,
    });
    // The view changes with the photo, its style and the mode; base is the same demo.
  }, [photo?.id, viewStyle, viewMode, index, videoOn]);

  if (!photo) return <p className="dv2-empty">Esta propiedad todavía no tiene fotos.</p>;
  // Until a photo is measured, the frame keeps the last proportions it had (never a jump to 4:3 and back).
  const ratio = videoOn && video ? formatRatio(video.format) : (ratios[photo.id] ?? lastRatio.current);
  if (!videoOn && ratios[photo.id]) lastRatio.current = ratios[photo.id];
  const originalKey = `${photo.id}:o`;
  // The video's cover: the property's cover in its main style, a real picture of this property.
  const cover = demo.cover ?? photos[0];
  const coverVersion = cover.versions[0] ?? null;
  const poster = urlFor(source, cover.id, coverVersion, 1280);
  const posterThumb = urlFor(source, cover.id, coverVersion, 480);
  const videoSrc = video && source.kind === "public" ? publicVideoUrl(source.token, video.id) : "";
  const duration = video?.durationMs ? clock(video.durationMs) : null;
  const openVideo = (method: string) => {
    show({ kind: "video" }, method);
    stageRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  const toggleStyles = () => {
    note("demo_more_styles_toggled", { expanded: !allStyles, photo_id: photo.id });
    setAllStyles((a) => !a);
  };
  // The agency's panel (its visit, no account yet), with what it asked for here already chosen.
  const intentLink = (intent: Exclude<DemoIntent, null>, id: string, place: string) =>
    owner
      ? {
          href: withIntent(owner.panelHref, intent),
          ...cta(id, place, "panel_visit", "habita_b2b", { intent: intent.kind }),
          onClick: () =>
            log("demo_agency_cta_clicked", { origen: place, cta_id: id, cta_intent: intent.kind, photo_id: photo.id, ...(intent.kind === "generate" ? { style_id: intent.style } : {}) }, true),
        }
      : null;

  // The styles: the buyers see only the versions made; the agency also every other style, with "Generar".
  // The versions keep the demo's order (main style first); the styles still to generate follow the
  // demo's configured order (its region's for new demos), else the catalog's.
  const sequence = demo.styleOrder ?? [];
  const rank = (id: string) => (sequence.includes(id) ? sequence.indexOf(id) : sequence.length);
  // The agency sees every style in that order, the main one first, each ready or with «Generar».
  const mainStyle = demo.styles[0]?.id ?? null;
  const rows = owner
    ? [
        ...DEMO_STYLES[demo.propertyType]
          .map((c, i) => ({ c, i }))
          .sort((a, b) => Number(b.c.id === mainStyle) - Number(a.c.id === mainStyle) || rank(a.c.id) - rank(b.c.id) || a.i - b.i)
          .map(({ c }) => ({ style: c.id, version: (photo.versions.find((v) => v.style === c.id) ?? null) as PhotoVersion | null })),
        // A retouch (not a catalog style) stays last, as before.
        ...photo.versions
          .filter((v) => !DEMO_STYLES[demo.propertyType].some((c) => c.id === v.style))
          .map((v) => ({ style: v.style, version: v as PhotoVersion | null })),
      ]
    : photo.versions.map((v) => ({ style: v.style, version: v as PhotoVersion | null }));
  const visibleCount = owner ? OWNER_VISIBLE_STYLES : VISIBLE_STYLES;
  const cards = allStyles ? rows : rows.filter((r, i) => i < visibleCount || (r.version && r.style === state.style));
  // «Mostrar selector de estilos» off: buyers see the opening style only (the agency's own view keeps its picker).
  const stylesCard = rows.length > 0 && (owner || demo.styleSelector !== false) && (
    <section className={`dv2-styles ${owner ? "is-owner" : "is-buyer"}`} aria-labelledby="dv2-panel-title" id="dv2-estilos">
      <div className="dv2-styles-head">
        <h2 id="dv2-panel-title">
          <Sparkles size={18} aria-hidden="true" /> Estilos
        </h2>
        {rows.length > visibleCount && (
          <button type="button" className="dv2-styles-all" aria-expanded={allStyles} onClick={toggleStyles}>
            {allStyles ? "Ver menos" : "Ver todos"} {allStyles ? <ChevronUp size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
          </button>
        )}
      </div>
      {/* Phones: one short line inviting to play with the styles, right under the photo. */}
      {photo.versions.length > 0 && <p className="dv2-styles-hint">Tocá un estilo y mové el antes/después</p>}
      <ul className="dv2-style-grid">
        {cards.map((r) => {
          const on = Boolean(r.version) && state.style === r.style && !videoOn;
          if (r.version)
            return (
              <li key={r.style} className={`dv2-style-card ${on ? "is-on" : ""}`}>
                <button type="button" className="dv2-style-pick" aria-pressed={on} onClick={() => choose(r.style)}>
                  <img src={urlFor(source, photo.id, r.version, 480)} alt="" loading="lazy" />
                  <span className="dv2-style-name" title={name(r.style)}>
                    {name(r.style)}
                  </span>
                </button>
                {on && (
                  <span className="dv2-style-check" aria-hidden="true">
                    <Check size={13} strokeWidth={3} />
                  </span>
                )}
              </li>
            );
          const link = intentLink({ kind: "generate", photo: photo.id, style: r.style }, "owner_generate", "styles_panel");
          // With gift credits left, «Generar» opens «Ambientá con IA» over the demo; without them, the panel.
          const inDemo = Boolean(owner) && source.kind === "public" && credits > 0;
          return (
            <li key={r.style} className="dv2-style-card is-missing">
              <span className="dv2-style-pick" aria-hidden="true">
                <img src={urlFor(source, photo.id, null, 480)} alt="" loading="lazy" />
                <span className="dv2-style-name" title={name(r.style)}>
                  {name(r.style)}
                </span>
              </span>
              {inDemo ? (
                <button
                  type="button"
                  className="dv2-style-generate"
                  aria-label={`Generar ${name(r.style)} con IA`}
                  aria-haspopup="dialog"
                  {...cta("owner_generate", "styles_panel", "generation_modal", "habita_b2b", { photo: photo.id, style: r.style, intent: "generate" })}
                  onClick={() => {
                    setGenerate({ photoId: photo.id, style: r.style });
                    log("demo_style_generation_cta_clicked", { photo_id: photo.id, style_id: r.style, credits_left: credits });
                  }}
                >
                  <span className="dv2-style-generate-pill">
                    Generar <Sparkles size={13} aria-hidden="true" />
                  </span>
                </button>
              ) : (
                link && (
                <a className="dv2-style-generate" aria-label={`Generar ${name(r.style)} en tu panel`} {...link}>
                  <span className="dv2-style-generate-pill">
                    Generar <Sparkles size={13} aria-hidden="true" />
                  </span>
                </a>
                )
              )}
            </li>
          );
        })}
      </ul>
      {stagedFailed && (
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
      )}
    </section>
  );

  // "Recorré la transformación": the video as its own card, under the gallery.
  // The buyers' phone tabs: the card also lives in «Video» when the video sits among the thumbnails.
  const buyerTabs = !owner && Boolean(video) && rows.length > 0;
  // The agency's demo: a compact horizontal card right after the photos and before Descargar / Compartir.
  const ownerVideoCard = owner && video?.placement === "below" && (
    <OwnerVideoCard key={video.id} src={videoSrc} cover={posterThumb} durationMs={video.durationMs} onOpen={openVideo} />
  );
  const videoCard = !owner && (video?.placement === "below" || buyerTabs) && (
    <section
      className={`dv2-video-card ${video?.placement === "below" ? "" : "is-tab-only"}`}
      aria-labelledby="dv2-video-title"
      id="dv2-aside-video"
      {...(buyerTabs ? { role: "tabpanel" } : {})}
    >
      <button type="button" className="dv2-video-cover" aria-label="Ver el video" onClick={() => openVideo("card_cover")}>
        <img src={posterThumb} alt="" loading="lazy" />
        <span className="dv2-play" aria-hidden="true">
          <Play size={20} fill="currentColor" />
        </span>
      </button>
      <div>
        <h2 id="dv2-video-title">Recorré la transformación</h2>
        <p>Mirá el antes y después de {demo.propertyType === "office" ? "esta oficina" : "esta propiedad"}.</p>
        <button type="button" className="dv2-video-cta" onClick={() => openVideo("card_button")}>
          {owner ? (
            <>
              Ver video <ArrowRight size={16} aria-hidden="true" />
            </>
          ) : (
            <>
              <Play size={15} aria-hidden="true" /> Ver video{duration ? ` (${duration})` : ""}
            </>
          )}
        </button>
      </div>
    </section>
  );

  // Five thumbnails (the video counts as one) and "+N fotos"; all of them on demand.
  const few = !allThumbs && entries.length > 6;
  const listedEntries = few ? entries.slice(0, 5) : entries;
  const hiddenPhotos = entries.length - listedEntries.length;
  // The agency's photo still without a staging: its original is free to see; staging it is in its panel.
  const pending = Boolean(owner) && photo.versions.length === 0 && !videoOn;
  const pendingLink = pending ? intentLink({ kind: "stage", photo: photo.id }, "owner_stage_photo", "gallery_stage") : null;

  return (
    <div className="dv2-gallery has-panel">
      <div className="dv2-media">
        <div
          ref={stageRef}
          className={`dv2-stage ${full ? "is-full" : ""} ${videoOn ? "is-video" : ""}`}
          style={{ "--ratio": String(ratio) } as React.CSSProperties}
          role="group"
          aria-roledescription="carrusel"
          aria-label={videoOn ? "Video de la propiedad" : `Foto ${index + 1} de ${photos.length}`}
          onPointerDown={(e) => {
            if (!comparing && !videoOn) swipe.current = { x: e.clientX, y: e.clientY };
          }}
          onPointerUp={(e) => {
            const s = swipe.current;
            swipe.current = null;
            // Swiping changes photo only outside comparison: there, dragging moves the line.
            if (!s || comparing || entries.length < 2) return;
            const dx = e.clientX - s.x;
            if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(e.clientY - s.y)) go(dx < 0 ? 1 : -1, "swipe");
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
            style={{ backgroundImage: `url("${videoOn ? posterThumb : urlFor(source, photo.id, comparing ? null : showing, 480)}")` }}
          />
          <div className="dv2-frame" style={{ "--ratio": String(ratio) } as React.CSSProperties}>
            {videoOn && video ? (
              // Plays on screen by itself, never with sound until the visitor asks; its own proportions.
              <>
                <video
                  ref={player}
                  key={video.id}
                  className="dv2-video"
                  src={videoSrc}
                  poster={poster}
                  controls
                  autoPlay
                  muted={muted}
                  loop
                  playsInline
                  preload="auto"
                  onVolumeChange={(e) => setMuted(e.currentTarget.muted)}
                  onPlay={() => note("demo_video_played", { placement: video.placement, format: video.format, muted })}
                />
                {muted && (
                  <button
                    type="button"
                    className="dv2-unmute"
                    onClick={() => {
                      const v = player.current;
                      if (!v) return;
                      v.muted = false;
                      setMuted(false);
                      void v.play().catch(() => null);
                      note("demo_video_unmuted", { placement: video.placement });
                    }}
                  >
                    <Volume2 size={16} aria-hidden="true" /> Activar sonido
                  </button>
                )}
              </>
            ) : failed[originalKey] ? (
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
                beforeLabel="Antes"
                afterLabel="Después"
                initial={state.position}
                teach
                analytics={source.kind === "public" ? { ...base, photo_id: photo.id, photo_index: index, style_id: showing.style } : undefined}
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
          {pendingLink && (
            <a className="dv2-pending-cta" {...pendingLink}>
              <Lock size={15} aria-hidden="true" /> Creá tu panel y ambientá esta foto con IA
            </a>
          )}
          {entries.length > 1 && (
            <>
              <button type="button" className="dv2-nav dv2-prev" aria-label="Anterior" onClick={() => go(-1)}>
                <ChevronLeft size={24} />
              </button>
              <button type="button" className="dv2-nav dv2-next" aria-label="Siguiente" onClick={() => go(1)}>
                <ChevronRight size={24} />
              </button>
            </>
          )}
          <span className="dv2-counter">{videoOn ? "Video" : `${index + 1} / ${photos.length}`}</span>
          <button
            type="button"
            className="dv2-full"
            aria-label={full ? "Salir de pantalla completa" : "Ver en pantalla completa"}
            aria-pressed={full}
            onClick={() => {
              fullMethod.current = "button";
              setFull((f) => !f);
            }}
          >
            {full ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
        </div>
        {owner && entries.length > 1 && <PageDots count={entries.length} at={Math.max(0, at)} />}
        {owner && (
          <h2 className="dv2-gallery-title">
            <ImageIcon size={18} aria-hidden="true" /> Galería de la propiedad ({photos.length})
          </h2>
        )}
        {entries.length > 1 && (
          <div className="dv2-thumbs">
            <button type="button" className="dv2-thumbs-step" aria-label="Ver miniaturas anteriores" onClick={() => scrollThumbs(-1)}>
              <ChevronLeft size={18} />
            </button>
            <ol ref={thumbs} aria-label="Fotos de la propiedad" className={few ? "is-few" : ""}>
              {listedEntries.map((entry, n) => {
                if (entry.kind === "video")
                  return (
                    <li key="video">
                      <button
                        type="button"
                        data-entry={n}
                        aria-label="Ver el video"
                        aria-current={videoOn ? "true" : undefined}
                        className={`dv2-thumb-video ${videoOn ? "is-on" : ""}`}
                        onClick={() => show(entry, "thumbnail")}
                      >
                        <img src={posterThumb} alt="" loading="lazy" />
                        <span className="dv2-play" aria-hidden="true">
                          <Play size={16} fill="currentColor" />
                        </span>
                        <span className="dv2-thumb-label">Video</span>
                      </button>
                    </li>
                  );
                const p = photos[entry.index];
                const on = !videoOn && entry.index === index;
                const locked = Boolean(owner) && p.versions.length === 0;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      data-entry={n}
                      aria-label={locked ? `Ver foto ${entry.index + 1} (original, todavía sin ambientar)` : `Ver foto ${entry.index + 1}`}
                      aria-current={on ? "true" : undefined}
                      className={`${on ? "is-on" : ""} ${locked ? "is-locked" : ""}`}
                      onClick={() => show(entry, "thumbnail")}
                    >
                      <img src={urlFor(source, p.id, null, 480)} alt="" loading="lazy" />
                      {locked && (
                        <span className="dv2-thumb-lock" aria-hidden="true">
                          <Lock size={15} />
                          <span>Creá tu panel y ambientá esta foto con IA</span>
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
              {few && (
                <li>
                  <button type="button" className="dv2-thumbs-more" aria-label={`Ver las ${hiddenPhotos} fotos restantes`} onClick={() => setAllThumbs(true)}>
                    <strong>+{hiddenPhotos}</strong>
                    <span>fotos</span>
                  </button>
                </li>
              )}
            </ol>
            <button type="button" className="dv2-thumbs-step" aria-label="Ver más miniaturas" onClick={() => scrollThumbs(1)}>
              <ChevronRight size={18} />
            </button>
          </div>
        )}
        {ownerVideoCard}
      </div>
      <aside className="dv2-aside">
        {buyerTabs && (
          <div className="dv2-aside-tabs" role="tablist" aria-label="Estilos y video">
            {(["styles", "video"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={asideTab === t}
                aria-controls={t === "styles" ? "dv2-estilos" : "dv2-aside-video"}
                className={asideTab === t ? "is-on" : ""}
                onClick={() => {
                  setAsideTab(t);
                  note("demo_aside_tab", { tab: t });
                }}
              >
                {t === "styles" ? <Sparkles size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />} {t === "styles" ? "Estilos" : "Video"}
              </button>
            ))}
          </div>
        )}
        <div className={`dv2-aside-group ${buyerTabs ? `has-tabs is-${asideTab}` : ""}`}>
          {stylesCard}
          {!owner && videoCard}
        </div>
        {ownerActions && <div className="dv2-aside-actions">{ownerActions}</div>}
        {aside}
      </aside>
      {generate && owner && source.kind === "public" && (
        <GenerateDialog
          key={generate.photoId}
          token={source.token}
          owner={owner}
          photo={photos.find((p) => p.id === generate.photoId) ?? photo}
          photoIndex={Math.max(0, photos.findIndex((p) => p.id === generate.photoId))}
          title={demo.title}
          initialStyle={generate.style}
          pending={rows.filter((r) => !r.version && DEMO_STYLES[demo.propertyType].some((c) => c.id === r.style)).map((r) => r.style)}
          name={name}
          credits={credits}
          onCredits={setCredits}
          log={log}
          onClose={() => setGenerate(null)}
          onContinue={(style) => {
            setGenerate(null);
            const at = photos.findIndex((p) => p.id === generate.photoId);
            if (at >= 0 && at !== index) setIndex(at);
            setStates((s) => ({ ...s, [generate.photoId]: { style, compare: true, position: 50 } }));
            lastStyle.current = style;
          }}
        />
      )}
    </div>
  );
}

/**
 * The agency's video as a compact horizontal card: a frame of the video
 * itself (the property's cover until it loads, and where the browser loads
 * nothing before playing), Play in the middle, its real duration and
 * «Ver video». Nothing plays by itself: the player opens on a tap.
 */
function OwnerVideoCard({
  src,
  cover,
  durationMs,
  onOpen,
}: {
  src: string;
  cover: string;
  durationMs: number | null;
  onOpen: (method: string) => void;
}) {
  const [frame, setFrame] = useState(false);
  const [measured, setMeasured] = useState<number | null>(null);
  const ms = durationMs ?? measured;
  return (
    <section className="dv2-video-card is-owner" aria-labelledby="dv2-video-title">
      <button type="button" className="dv2-video-open" onClick={() => onOpen("card")} aria-describedby="dv2-video-sub">
        <span className="dv2-video-cover">
          <img src={cover} alt="" loading="lazy" />
          {/* Only the metadata and the first frame; muted and never played here. */}
          <video
            className={frame ? "is-ready" : ""}
            src={`${src}#t=0.1`}
            muted
            playsInline
            preload="metadata"
            tabIndex={-1}
            aria-hidden="true"
            onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setMeasured(Math.round(e.currentTarget.duration * 1000))}
            onLoadedData={() => setFrame(true)}
          />
          <span className="dv2-play" aria-hidden="true">
            <Play size={20} fill="currentColor" />
          </span>
          {ms ? <span className="dv2-video-time">{clock(ms)}</span> : null}
        </span>
        <span className="dv2-video-text">
          <strong id="dv2-video-title">Recorré la propiedad en video</strong>
          <small id="dv2-video-sub">
            Recorrido por los ambientes
            <span className="dv2-sr">. Ver video{ms ? ` (${clock(ms)})` : ""}</span>
          </small>
        </span>
        <ChevronRight size={20} aria-hidden="true" className="dv2-video-chevron" />
      </button>
    </section>
  );
}

/** Where the carousel is: at most five dots, the current one long (the mockup). Decorative: the arrows and thumbnails navigate. */
function PageDots({ count, at }: { count: number; at: number }) {
  const shown = Math.min(5, count);
  const first = Math.min(Math.max(0, at - 2), count - shown);
  return (
    <div className="dv2-dots" aria-hidden="true">
      {Array.from({ length: shown }, (_, i) => (
        <span key={i} className={first + i === at ? "is-on" : ""} />
      ))}
    </div>
  );
}

/** How long «Ambientá con IA» waits for a staging before saying it is taking longer (it keeps going on the server). */
const GENERATION_WAIT_MS = 4 * 60 * 1000;
/** How often the page asks the server again while a staging runs. */
const GENERATION_POLL_MS = 4000;

type GenerateStep =
  | { kind: "pick" }
  | { kind: "running"; style: string; since: number }
  | { kind: "slow"; style: string }
  | { kind: "done"; style: string }
  | { kind: "error"; message: string };

/**
 * «Ambientá con IA»: the agency generates one style of a photo without leaving
 * its demo, with its gift credits (one per style; the server checks the
 * invitation, spends it once per try and gives it back if the staging does not
 * start). A bottom sheet on phones, a centered dialog on desktop. While it
 * runs the page asks the server again until the photo has the new version;
 * nothing here shows a result that does not exist. Then «Generar mi panel»
 * (the panel's visit, with this photo and style), «Probar otro estilo» or
 * «Continuar en la demo» (the new style chosen on the same photo).
 */
function GenerateDialog({
  token,
  owner,
  photo,
  photoIndex,
  title,
  initialStyle,
  pending,
  name,
  credits,
  onCredits,
  log,
  onClose,
  onContinue,
}: {
  token: string;
  owner: OwnerMode;
  photo: PublicPhoto;
  photoIndex: number;
  title: string;
  initialStyle: string;
  /** The catalog styles this photo does not have yet, in the demo's order. */
  pending: string[];
  name: (style: string) => string;
  credits: number;
  onCredits: (n: number) => void;
  log: (event: string, extra?: EventProperties, beacon?: boolean) => unknown;
  onClose: () => void;
  onContinue: (style: string) => void;
}) {
  const router = useRouter();
  const [style, setStyle] = useState(pending.includes(initialStyle) ? initialStyle : (pending[0] ?? initialStyle));
  const [step, setStep] = useState<GenerateStep>({ kind: "pick" });
  const sending = useRef(false);
  const box = useRef<HTMLDivElement>(null);
  const ids = { photo_id: photo.id, photo_index: photoIndex };
  const original = publicImageUrl(token, photo.id, null, 1600);
  const ready = (st: string) => photo.versions.find((v) => v.style === st) ?? null;

  useEffect(() => {
    log("demo_generation_modal_opened", { ...ids, style_id: initialStyle, credits_left: credits });
    box.current?.focus();
    // Once, when it opens.
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  // While it runs: the page asks the server again (the photo's versions come back with the page).
  const running = step.kind === "running" ? step : null;
  useEffect(() => {
    if (!running) return;
    const poll = window.setInterval(() => router.refresh(), GENERATION_POLL_MS);
    const late = window.setTimeout(() => {
      setStep({ kind: "slow", style: running.style });
      log("demo_trial_generation_slow", { ...ids, style_id: running.style });
    }, Math.max(0, running.since + GENERATION_WAIT_MS - Date.now()));
    return () => {
      window.clearInterval(poll);
      window.clearTimeout(late);
    };
    // One loop per staging.
  }, [running?.style, running?.since]);
  // Done only when the photo really has the version (stored and visible): never before.
  const waiting = step.kind === "running" || step.kind === "slow" ? step.style : null;
  useEffect(() => {
    if (!waiting || !ready(waiting)) return;
    setStep({ kind: "done", style: waiting });
    log("demo_trial_generation_completed", { ...ids, style_id: waiting });
    log("demo_generated_result_viewed", { ...ids, style_id: waiting });
  }, [waiting, photo.versions]);

  async function start() {
    if (sending.current || credits < 1) return;
    sending.current = true;
    log("demo_trial_generation_started", { ...ids, style_id: style, credits_left: credits });
    const r = await requestPublicStaging(token, photo.id, style, owner.code);
    sending.current = false;
    if (!r.ok) {
      setStep({ kind: "error", message: r.error });
      log("demo_trial_generation_failed", { ...ids, style_id: style, reason: "request" });
      return;
    }
    if (typeof r.remaining === "number") onCredits(r.remaining);
    setStep({ kind: "running", style, since: Date.now() });
    router.refresh();
  }

  const shown = step.kind === "done" ? ready(step.style) : null;
  const heading =
    step.kind === "done" ? "¡Tu ambientación está lista!" : step.kind === "running" || step.kind === "slow" ? "Generando tu ambientación" : "Ambientá con IA";
  const panelLink = (st: string) => withIntent(owner.panelHref, { kind: "generate", photo: photo.id, style: st });
  const thumb = (st: string) => `/ejemplos/living-${st}.webp`;

  return createPortal(
    <div className="pe-backdrop dv2-gen-backdrop" onMouseDown={onClose}>
      <div
        ref={box}
        className={`pe-dialog dv2-gen is-${step.kind}`}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dv2-gen-title"
        aria-busy={step.kind === "running"}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="dv2-gen-head">
          <div>
            <h2 id="dv2-gen-title">
              {heading} {step.kind !== "running" && step.kind !== "slow" && <Sparkles size={20} aria-hidden="true" />}
            </h2>
            <p>
              {step.kind === "done"
                ? "Así podría verse esta propiedad con el estilo seleccionado"
                : step.kind === "running" || step.kind === "slow"
                  ? `Estilo ${name(step.style)} sobre esta foto.`
                  : "Generá una nueva versión de esta foto con otro estilo"}
            </p>
          </div>
          <button type="button" className="dv2-gen-close" aria-label="Cerrar" onClick={onClose}>
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <div className="dv2-gen-body">
          <div className="dv2-gen-media">
            {shown ? (
              <Comparison
                before={original}
                after={publicImageUrl(token, photo.id, shown, 1600)}
                alt={`${title}, foto ${photoIndex + 1}, ambientación ${name(shown.style)} con IA, ilustrativa`}
                beforeAlt={`${title}, foto ${photoIndex + 1}, original`}
                beforeLabel="Antes"
                afterLabel={name(shown.style)}
                initial={50}
                teach
              />
            ) : (
              <div className={`dv2-gen-photo ${step.kind === "running" || step.kind === "slow" ? "is-busy" : ""}`}>
                <img src={original} alt={`${title}, foto ${photoIndex + 1}, original`} />
                <span className="dv2-gen-tag">Foto original</span>
                {(step.kind === "running" || step.kind === "slow") && (
                  <span className="dv2-gen-spinner" role="status">
                    <span className="dv2-sr">Generando</span>
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="dv2-gen-side">
            {step.kind === "pick" && (
              <>
                <p className="dv2-gen-label">Elegí un estilo</p>
                <ul className="dv2-gen-styles">
                  {pending.map((st) => (
                    <li key={st}>
                      <button
                        type="button"
                        className={`dv2-gen-style ${st === style ? "is-on" : ""}`}
                        aria-pressed={st === style}
                        onClick={() => {
                          setStyle(st);
                          log("demo_style_selected", { ...ids, style_id: st, origen: "generation_modal" });
                        }}
                      >
                        <img src={thumb(st)} alt="" loading="lazy" onError={(e) => ((e.currentTarget.src = original), (e.currentTarget.onerror = null))} />
                        <span>{name(st)}</span>
                        {st === style && (
                          <span className="dv2-gen-check" aria-hidden="true">
                            <Check size={13} strokeWidth={3} />
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="dv2-gen-actions">
                  <p className="dv2-gen-credits">
                    <CircleDollarSign size={16} aria-hidden="true" />
                    {credits > 0
                      ? `Usa 1 de tus ${credits} ${credits === 1 ? "crédito gratis" : "créditos gratis"}.`
                      : "Ya usaste tus créditos gratis de este mes. Seguí en tu panel para generar más."}
                  </p>
                  {credits > 0 ? (
                    <button type="button" className="dv2-gen-primary" disabled={!pending.length} onClick={() => void start()}>
                      Generar imagen <Sparkles size={17} aria-hidden="true" />
                    </button>
                  ) : (
                    <a className="dv2-gen-primary" href={panelLink(style)} onClick={() => log("demo_agency_cta_clicked", { origen: "generation_modal", cta_id: "generation_no_credits", cta_intent: "generate", ...ids, style_id: style }, true)}>
                      Continuar en mi panel <ArrowRight size={17} aria-hidden="true" />
                    </a>
                  )}
                  <button type="button" className="dv2-gen-tertiary" onClick={onClose}>
                    Cancelar
                  </button>
                </div>
              </>
            )}

            {step.kind === "running" && (
              <>
                <p className="dv2-gen-text">Te mostramos el resultado apenas esté listo. Podés quedarte en esta ventana.</p>
                <div className="dv2-gen-actions">
                  <button type="button" className="dv2-gen-primary" disabled>
                    Generando…
                  </button>
                </div>
              </>
            )}

            {step.kind === "slow" && (
              <>
                <p className="dv2-gen-text">Está tardando más de lo habitual. Cuando termine, la vas a ver en la demo con el estilo {name(step.style)}.</p>
                <div className="dv2-gen-actions">
                  <button type="button" className="dv2-gen-secondary" onClick={() => setStep({ kind: "running", style: step.style, since: Date.now() })}>
                    <RotateCw size={16} aria-hidden="true" /> Seguir esperando
                  </button>
                  <button type="button" className="dv2-gen-tertiary" onClick={onClose}>
                    Volver a la demo
                  </button>
                </div>
              </>
            )}

            {step.kind === "error" && (
              <>
                <p className="dv2-note is-error" role="alert">
                  {step.message}
                </p>
                <div className="dv2-gen-actions">
                  <button type="button" className="dv2-gen-secondary" onClick={() => setStep({ kind: "pick" })}>
                    <RotateCw size={16} aria-hidden="true" /> Volver a intentar
                  </button>
                  <button type="button" className="dv2-gen-tertiary" onClick={onClose}>
                    Volver a la demo
                  </button>
                </div>
              </>
            )}

            {step.kind === "done" && (
              <div className="dv2-gen-actions">
                <a
                  className="dv2-gen-primary"
                  href={panelLink(step.style)}
                  {...cta("generation_result_panel", "generation_result", "panel_visit", "habita_b2b", { photo: photo.id, style: step.style, intent: "generate" })}
                  onClick={() => {
                    log("demo_generated_result_save_clicked", { ...ids, style_id: step.style });
                    log("demo_agency_cta_clicked", { origen: "generation_result", cta_id: "generation_result_panel", cta_intent: "generate", ...ids, style_id: step.style }, true);
                  }}
                >
                  <House size={18} aria-hidden="true" /> Generar mi panel <ArrowRight size={17} aria-hidden="true" />
                </a>
                <button
                  type="button"
                  className="dv2-gen-secondary"
                  onClick={() => {
                    log("demo_generation_try_another", { ...ids, style_id: step.style, credits_left: credits });
                    setStyle(pending[0] ?? style);
                    setStep({ kind: "pick" });
                  }}
                >
                  <RotateCw size={16} aria-hidden="true" /> Probar otro estilo
                </button>
                <button
                  type="button"
                  className="dv2-gen-tertiary"
                  onClick={() => {
                    log("demo_generation_back_to_demo", { ...ids, style_id: step.style });
                    onContinue(step.style);
                  }}
                >
                  Continuar en la demo
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** «¿Te imaginás esto con todas tus propiedades?»: the agency continues in its own panel (its visit: the account is asked when it saves). */
function OwnerSaveDemo({ owner, log }: { owner: OwnerMode; log: (event: string, extra?: EventProperties, beacon?: boolean) => unknown }) {
  return (
    <section className="dv2-save-demo" aria-labelledby="dv2-save-demo-title">
      <h2 id="dv2-save-demo-title">
        <Sparkles size={20} aria-hidden="true" /> ¿Te imaginás esto con todas tus propiedades?
      </h2>
      <a
        className="dv2-save-demo-cta"
        href={owner.panelHref}
        {...cta("owner_save_demo", "value_actions", "panel_visit", "habita_b2b", { intent: "panel_home" })}
        onClick={() => log("demo_agency_cta_clicked", { origen: "demo_guardar_demo", cta_id: "owner_save_demo", cta_intent: "panel_home" }, true)}
      >
        Continuar en mi panel <ArrowRight size={17} aria-hidden="true" />
      </a>
    </section>
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
  log: (event: string, extra?: EventProperties, beacon?: boolean) => unknown;
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
      <a
        className="dv2-invite-cta"
        href={invite.panelHref}
        {...cta(`invite_panel_${place}`, `invite_${place}`, "panel_visit")}
        onClick={() => log("demo_agency_cta_clicked", { origen: `demo_invitacion_${place}`, cta_id: `invite_panel_${place}`, cta_location: `invite_${place}` }, true)}
      >
        Ingresar a mi panel
      </a>
      <small>
        <Lock size={14} aria-hidden="true" /> Sin crear cuenta todavía: la creás cuando quieras guardar, y conservás las fotos y ambientaciones que estás viendo.
      </small>
      <small>{freeCreditsLine(invite.freeCredits)}</small>
    </section>
  );
}

function OwnerHeader({
  demo,
  owner,
  log,
  pricesOn,
  onPrices,
  onDemo,
}: {
  demo: PublicDemo;
  owner: OwnerMode;
  log: (event: string, extra?: EventProperties, beacon?: boolean) => unknown;
  /** The plans are the section on screen, instead of the property. */
  pricesOn: boolean;
  onPrices: (origin: string) => void;
  onDemo: (method: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  // «Activar mi cuenta gratis» is the invitation's sign-up; every other way opens the panel's visit. Each keeps its own id and what it was meant to open.
  const INTENT: Record<string, string> = {
    inicio: "panel_home",
    imagenes: "panel_images",
    crear_movil: "create_property",
    crear: "create_property",
    guardar: "save_panel",
  };
  const go = (origin: string) => ({
    href: origin === "guardar" ? owner.href : owner.panelHref,
    ...cta(`owner_${origin}`, origin === "guardar" ? "owner_bar" : "owner_menu", origin === "guardar" ? "signup_invitation" : "panel_visit", "habita_b2b", { intent: INTENT[origin] }),
    onClick: () => log("demo_agency_cta_clicked", { origen: `demo_encabezado_${origin}`, cta_id: `owner_${origin}`, cta_intent: INTENT[origin] }, true),
  });
  const versions = demo.photos.reduce((n, p) => n + p.versions.length, 0);
  return (
    <header className="dv2-owner">
      <div className="dv2-owner-bar">
        <div className="dv2-owner-brand">
          <span className="dv2-owner-habita" aria-label="Habita">
            <House size={24} aria-hidden="true" />
            <span aria-hidden="true">HABITA</span>
          </span>
          <span className="dv2-owner-pill">Demo para inmobiliaria</span>
        </div>
        <div className="dv2-owner-ctas">
          <a
            href={owner.pricesHref}
            className={`dv2-owner-prices ${pricesOn ? "is-on" : ""}`}
            aria-current={pricesOn ? "page" : undefined}
            {...cta("owner_nav_pricing", "owner_bar", "pricing_section", "navigation")}
            onClick={(e) => {
              e.preventDefault();
              if (pricesOn) onDemo("nav");
              else onPrices("encabezado");
            }}
          >
            <Tag size={16} aria-hidden="true" /> Precios
          </a>
          <a
            href={owner.panelHref}
            className="dv2-owner-prices"
            {...cta("owner_nav_panel", "owner_bar", "panel_visit", "navigation")}
            onClick={() => log("demo_agency_cta_clicked", { origen: "demo_encabezado_panel", cta_id: "owner_nav_panel", cta_intent: "panel_home" }, true)}
          >
            <House size={16} aria-hidden="true" /> Mi panel
          </a>
          <a className="dv2-owner-save" {...go("guardar")}>
            Activar mi cuenta gratis
          </a>
          <button type="button" className="dv2-owner-menu-button" aria-label="Abrir el menú" aria-expanded={open} onClick={() => setOpen(true)}>
            <Menu size={22} aria-hidden="true" />
          </button>
        </div>
      </div>
      {open && (
        <div className="dv2-owner-drawer-backdrop" onClick={() => setOpen(false)}>
          <nav className="dv2-owner-drawer" aria-label="Tu panel de demostración" onClick={(e) => e.stopPropagation()}>
            <div className="dv2-owner-drawer-head">
              <span>
                <small>Demo para</small>
                <strong>{demo.agencyName}</strong>
              </span>
              <button ref={closeRef} type="button" className="dv2-owner-menu-button" aria-label="Cerrar el menú" onClick={() => setOpen(false)}>
                <X size={22} aria-hidden="true" />
              </button>
            </div>
            <a
              href={owner.panelHref}
              {...cta("owner_menu_panel", "owner_menu", "panel_visit", "navigation")}
              onClick={() => log("demo_agency_cta_clicked", { origen: "demo_menu_panel", cta_id: "owner_menu_panel", cta_intent: "panel_home" }, true)}
            >
              <House size={18} aria-hidden="true" /> Continuar en mi panel
            </a>
            <a
              href={pricesOn ? owner.demoHref : "#propiedad"}
              className={pricesOn ? undefined : "is-on"}
              {...cta("owner_my_properties", "owner_menu", "section_property", "navigation")}
              onClick={(e) => {
                setOpen(false);
                if (!pricesOn) return;
                e.preventDefault();
                onDemo("nav");
              }}
            >
              <LayoutGrid size={18} aria-hidden="true" /> Mis demostraciones <span className="dv2-owner-count">1</span>
            </a>
            <a href="#otra-propiedad" {...cta("owner_create_anchor", "owner_menu", "create_property", "navigation")} onClick={() => setOpen(false)}>
              <Plus size={18} aria-hidden="true" /> Probar con otra propiedad
            </a>
            <a {...go("imagenes")}>
              <ImageIcon size={18} aria-hidden="true" /> Estudio de imágenes
            </a>
            <a
              href={owner.pricesHref}
              {...cta("owner_menu_pricing", "owner_menu", "pricing_section", "navigation")}
              onClick={(e) => {
                e.preventDefault();
                setOpen(false);
                onPrices("menu");
              }}
            >
              <Tag size={18} aria-hidden="true" /> Precios
            </a>
            <a href={owner.buyerHref} {...cta("owner_buyer_view", "owner_menu", "demo_buyer_view", "navigation")} onClick={() => log("demo_owner_buyer_view", {}, true)}>
              <Eye size={18} aria-hidden="true" /> Ver como comprador
            </a>
            <p className="dv2-owner-drawer-note">
              <CircleDollarSign size={16} aria-hidden="true" />
              {freeCreditsLine(owner.freeCredits)}{" "}
              {versions ? `${versions} ${versions === 1 ? "versión lista" : "versiones listas"} para descargar gratis.` : ""}
            </p>
            <a className="dv2-owner-save is-block" {...go("guardar")}>
              Activar mi cuenta gratis
            </a>
          </nav>
        </div>
      )}
    </header>
  );
}

/**
 * What the agency takes from its demo, without signing up: every version
 * ready, free, one link each (the true count), and the buyers' link to share
 * (never the presentation link: it carries the invitation).
 */
function OwnerValue({ demo, token, log }: { demo: PublicDemo; token: string; log: (event: string, extra?: EventProperties, beacon?: boolean) => unknown }) {
  const [shared, setShared] = useState("");
  const ready = demo.photos.flatMap((p, i) => p.versions.map((v) => ({ photo: p, index: i, version: v })));
  const name = (style: string) => demo.styles.find((s) => s.id === style)?.name ?? (style === RETOUCH_STYLE ? "Retocada" : demoStyleName(style));
  async function share() {
    const url = `${window.location.origin}/demo/${token}`;
    log("demo_owner_share", { method: typeof navigator.share === "function" ? "native" : "copy" });
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: demo.title, text: `${demo.title} · ${demo.agencyName}`, url });
        setShared("");
      } else {
        await navigator.clipboard.writeText(url);
        setShared("Enlace copiado: es la ficha para compradores.");
      }
    } catch {
      // Cancelled by the visitor.
    }
  }
  return (
    <section className="dv2-value" aria-label="Llevate el material">
      <details className="dv2-value-download" onToggle={(e) => e.currentTarget.open && log("demo_owner_download_list", { versions: ready.length })}>
        <summary {...cta("owner_download_all", "value_actions", "file_download", "habita_b2b")}>
          <Download size={22} aria-hidden="true" />
          <span>
            <strong>Descargar imágenes</strong>
            <small className="dv2-sr">{ready.length ? `${ready.length} ${ready.length === 1 ? "lista" : "listas"} para publicar, gratis` : "Todavía no hay versiones listas"}</small>
          </span>
        </summary>
        {ready.length > 0 && (
          <ul>
            {ready.map(({ photo, index, version }) => (
              <li key={`${photo.id}:${version.style}`}>
                <a
                  href={publicImageUrl(token, photo.id, version, 2048)}
                  download={`${fileSlug(`${demo.title}-foto-${index + 1}-${name(version.style)}`)}.jpg`}
                  onClick={() => log("demo_owner_download", { estilo: version.style, photo_id: photo.id, style_id: version.style, origen: "descargar_todas" })}
                >
                  <img src={publicImageUrl(token, photo.id, version, 480)} alt="" loading="lazy" />
                  <span>
                    Foto {index + 1}
                    {photo.label ? ` · ${photo.label}` : ""} · {name(version.style)}
                  </span>
                  <Download size={16} aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </details>
      <button type="button" className="dv2-value-share" onClick={() => void share()} {...cta("owner_share", "value_actions", "share_listing", "habita_b2b")}>
        <Share2 size={22} aria-hidden="true" />
        <span>
          <strong>Compartir ficha</strong>
          <small className="dv2-sr">Con tus compradores</small>
        </span>
      </button>
      {shared && (
        <p className="dv2-note" role="status">
          {shared}
        </p>
      )}
    </section>
  );
}


/**
 * "¿Querés probarlo con otra propiedad?": the second property is where an
 * agency starts using Habita on its own. Its address is kept for the panel,
 * which opens first; the account is asked when the property is saved.
 */
function AnotherProperty({ owner, log }: { owner: OwnerMode; log: (event: string, extra?: EventProperties, beacon?: boolean) => unknown }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  return (
    <section id="otra-propiedad" className="dv2-another" aria-labelledby="dv2-another-title">
      <h2 id="dv2-another-title">
        <Link2Icon size={20} aria-hidden="true" /> ¿Querés probarlo con otra propiedad?
      </h2>
      <p>Pegá el enlace de una publicación y generá tu propio antes y después.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          let host: string;
          try {
            const u = new URL(url.trim());
            if (!/^https?:$/.test(u.protocol)) throw new Error("protocol");
            host = u.hostname.replace(/^www\./, "");
          } catch {
            setError("Pegá el enlace completo de la publicación (empieza con https://).");
            return;
          }
          try {
            localStorage.setItem(PENDING_IMPORT_KEY, JSON.stringify({ url: url.trim(), at: Date.now() }));
          } catch {
            /* Private mode: the panel asks for the link again. */
          }
          // Only the site's host, never the pasted address.
          track("second_property_import_started", { stage: "demo_before_signup", source: host });
          log("demo_agency_cta_clicked", { origen: "otra_propiedad", cta_id: "owner_another_property", cta_intent: "create_property" }, true);
          // The panel (its visit, or the agency's own if signed in) continues the import with this same link; saving it asks for the account.
          window.location.assign(withIntent(owner.panelHref, { kind: "import" }));
        }}
      >
        <label className="dv2-sr" htmlFor="dv2-another-url">
          Enlace de la publicación
        </label>
        <input id="dv2-another-url" type="url" inputMode="url" placeholder="Pegá el enlace de una publicación…" value={url} onChange={(e) => (setUrl(e.target.value), setError(""))} required />
        <button type="submit" {...cta("owner_another_property", "another_property", "create_property", "habita_b2b")}>
          Probar con otra propiedad
        </button>
      </form>
      {error && (
        <p className="dv2-note is-error" role="alert">
          {error}
        </p>
      )}
      <small>Para guardarla te pedimos crear tu acceso: la propiedad de esta demo queda en tu panel.</small>
    </section>
  );
}
