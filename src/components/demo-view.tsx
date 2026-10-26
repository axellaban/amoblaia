"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Info,
  Mail,
  MapPin,
  Maximize2,
  MessageCircle,
  Minimize2,
  Phone,
  RotateCw,
  Sparkles,
} from "lucide-react";
import { Comparison } from "./comparison";
import { registerSuperProperties, track } from "@/lib/analytics";
import { contactHref, textOn } from "@/lib/demos/branding";
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
  panelTitle: "Imaginá este espacio a tu estilo",
  panelHint: "Elegí una ambientación para esta foto.",
  keepsOriginal: "La foto original se mantiene hasta que elijas un estilo.",
  original: "Original",
  staged: "Ambientado con IA",
  backToOriginal: "Volver al original",
  compare: "Comparar con original",
  illustrative:
    "Ambientación virtual realizada con inteligencia artificial: las imágenes son ilustrativas y los muebles no están incluidos en la propiedad.",
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

/**
 * The demo as the agency's own listing: its brand, its contact, the
 * property's photos in one carousel, and an optional staging of each photo.
 * Every photo opens as its clean original (except the first one in opening
 * mode B); choosing a style compares it with the original, and each photo
 * keeps its own state during the visit. Nothing here generates images: the
 * styles are versions prepared and reviewed in the panel.
 */
export function DemoView({
  demo,
  source,
  presentation = false,
}: {
  demo: PublicDemo;
  source: Source;
  /** The link for the agency: may show the "Demo preparada para…" strip. */
  presentation?: boolean;
}) {
  const { agency, photos } = demo;
  const styleNames = useMemo(
    () => Object.fromEntries(demo.styles.map((s) => [s.id, s.name])) as Record<string, string>,
    [demo.styles],
  );
  const analytics = useMemo(
    () => ({
      demo_id: demo.id,
      inmobiliaria_id: demo.agencyId,
      fotos: photos.length,
      ambientadas: photos.filter((p) => p.versions.length).length,
      version: presentation ? "presentacion" : "comprador",
    }),
    [demo.id, demo.agencyId, photos, presentation],
  );
  const [index, setIndex] = useState(0);
  // Remembered per photo during the visit. The first photo may open staged.
  const [states, setStates] = useState<Record<string, PhotoState>>(() =>
    demo.openStyle && photos[0] ? { [photos[0].id]: { style: demo.openStyle, compare: false, position: 50 } } : {},
  );
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const [retries, setRetries] = useState<Record<string, number>>({});
  const [ratios, setRatios] = useState<Record<string, number>>({});
  const [full, setFull] = useState(false);
  const [pageUrl, setPageUrl] = useState("");
  const thumbs = useRef<HTMLOListElement>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);

  const photo = photos[index];
  const state = (photo && states[photo.id]) || ORIGINAL;
  const version = photo ? versionOf(photo, state.style) : null;
  const stagedKey = photo && version ? `${photo.id}:${version.style}` : "";
  const stagedFailed = Boolean(stagedKey && failed[stagedKey]);
  // A version that fails to load leaves the original on screen.
  const showing = version && !stagedFailed ? version : null;
  const comparing = Boolean(showing && state.compare);
  const name = (style: string) => styleNames[style] ?? style;

  useEffect(() => {
    setPageUrl(window.location.href.split("?")[0]);
    if (source.kind !== "public") return;
    track("demo_vista", analytics);
    registerSuperProperties({ demo_id: demo.id, demo_inmobiliaria_id: demo.agencyId });
    try {
      localStorage.setItem(
        DEMO_REF_KEY,
        JSON.stringify({ demoId: demo.id, agencyId: demo.agencyId, at: Date.now() }),
      );
    } catch {
      /* Private mode or blocked storage. */
    }
  }, [source.kind, demo.id, demo.agencyId, analytics]);

  const setState = useCallback(
    (next: PhotoState) => photo && setStates((s) => ({ ...s, [photo.id]: next })),
    [photo],
  );
  const go = useCallback(
    (step: number) => setIndex((i) => (photos.length ? (i + step + photos.length) % photos.length : 0)),
    [photos.length],
  );
  const choose = (style: string) => {
    // Back to a style already explored on this photo: its line stays where it was.
    const same = state.style === style;
    setState({ style, compare: true, position: same ? state.position : 50 });
    if (source.kind === "public") track("demo_estilo", { ...analytics, estilo: style });
  };
  const backToOriginal = () => {
    setState(ORIGINAL);
    if (source.kind === "public") track("demo_original", analytics);
  };

  // Keyboard: arrows move between photos (not while a control has the focus), Esc leaves full screen.
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
    thumbs.current
      ?.querySelector<HTMLElement>(`[data-index="${index}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    const next = photos[(index + 1) % Math.max(1, photos.length)];
    if (next && next !== photo) new Image().src = urlFor(source, next.id, null, 1600);
  }, [index, photos, photo, source]);

  const brandStyle = {
    "--brand": agency.primary,
    "--brand-ink": textOn(agency.primary),
    "--brand-accent": agency.accent,
    "--brand-accent-ink": textOn(agency.accent),
  } as React.CSSProperties;
  const contact = agency.contact
    ? {
        kind: agency.contact.kind,
        href: contactHref(
          { contactKind: agency.contact.kind, contactValue: agency.contact.value },
          { title: demo.title, reference: demo.reference, url: demo.listingUrl || pageUrl },
        ),
      }
    : null;
  const ContactIcon =
    contact?.kind === "whatsapp" ? MessageCircle : contact?.kind === "phone" ? Phone : contact?.kind === "email" ? Mail : ArrowRight;
  const external = { target: "_blank", rel: "noopener noreferrer" } as const;
  const contactButton = contact?.href ? (
    <a
      className="dv2-contact-main"
      href={contact.href}
      {...(contact.kind === "whatsapp" || contact.kind === "url" ? external : {})}
      onClick={() => source.kind === "public" && track("demo_contacto", { ...analytics, canal: contact.kind })}
    >
      <ContactIcon size={20} aria-hidden="true" />
      <span>Consultar a {agency.name}</span>
      <ArrowRight size={18} aria-hidden="true" />
    </a>
  ) : null;

  const panel =
    photo && photo.versions.length > 0 ? (
      <section className="dv2-panel" aria-labelledby="dv2-panel-title">
        <h2 id="dv2-panel-title">{TEXT.panelTitle}</h2>
        <p className="dv2-panel-hint">{TEXT.panelHint}</p>
        <div className="dv2-options" role="radiogroup" aria-labelledby="dv2-panel-title">
          {photo.versions.map((v) => {
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
                <span>{name(v.style)}</span>
                <span className="dv2-radio" aria-hidden="true">
                  {on && <Check size={14} strokeWidth={3} />}
                </span>
              </button>
            );
          })}
        </div>
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
            <Info size={16} aria-hidden="true" /> {TEXT.keepsOriginal}
          </p>
        )}
      </section>
    ) : null;

  const ratio = photo ? (ratios[photo.id] ?? 4 / 3) : 4 / 3;
  const originalKey = photo ? `${photo.id}:o` : "";

  return (
    <div className={`dv2-page ${agency.titleFont === "serif" ? "is-serif" : ""}`} style={brandStyle}>
      {presentation && demo.banner && (
        <div className="dv2-banner" role="note">
          Demo preparada para {agency.name} ·{" "}
          <a
            href={ctaHref(demo.id, demo.agencyId)}
            {...external}
            onClick={() => source.kind === "public" && track("demo_cta_click", analytics, true)}
          >
            Por Amobla IA
          </a>
        </div>
      )}
      <header className="dv2-header">
        <div className="container">
          {agency.website ? (
            <a className="dv2-brand" href={agency.website} {...external}>
              <Brand agency={agency} />
            </a>
          ) : (
            <span className="dv2-brand">
              <Brand agency={agency} />
            </span>
          )}
          {demo.listingUrl && (
            <a className="dv2-header-link" href={demo.listingUrl} {...external}>
              Ver publicación original <ExternalLink size={15} aria-hidden="true" />
            </a>
          )}
        </div>
      </header>

      <div className="container dv2-main">
        <div className="dv2-heading">
          <div>
            {(demo.reference || demo.operation) && (
              <p className="dv2-ref">
                {[demo.operation, demo.reference && `Ref. ${demo.reference}`].filter(Boolean).join(" · ")}
              </p>
            )}
            <h1>{demo.title}</h1>
            {demo.features && <p className="dv2-features">{demo.features}</p>}
            {demo.location && (
              <p className="dv2-location">
                <MapPin size={16} aria-hidden="true" /> {demo.location}
              </p>
            )}
          </div>
          <div className="dv2-heading-side">
            {(demo.operation || demo.price) && (
              <p className="dv2-price">
                {demo.operation && <span className="dv2-chip">{demo.operation}</span>}
                {demo.price && <strong>{demo.price}</strong>}
              </p>
            )}
            {contactButton && <div className="dv2-contact-top">{contactButton}</div>}
          </div>
        </div>

        {!photo ? (
          <p className="dv2-empty">Esta propiedad todavía no tiene fotos.</p>
        ) : (
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
                {/* Measures the original's proportions: both images are shown in them, never stretched. */}
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
                      alt={`${photo.label}: ambientación ${name(showing.style)} con IA, ilustrativa`}
                      beforeAlt={`${photo.label}: foto original`}
                      beforeLabel={TEXT.original}
                      afterLabel={TEXT.staged}
                      initial={state.position}
                      onPositionChange={(position) =>
                        setStates((s) => ({ ...s, [photo.id]: { ...(s[photo.id] ?? state), position } }))
                      }
                      onAfterError={() => setFailed((f) => ({ ...f, [stagedKey]: true }))}
                    />
                  ) : (
                    <>
                      <img
                        key={`${photo.id}-${showing?.style ?? "o"}`}
                        className="dv2-photo"
                        src={urlFor(
                          source,
                          photo.id,
                          showing,
                          2048,
                          showing ? retries[stagedKey] : retries[originalKey],
                        )}
                        alt={
                          showing
                            ? `${photo.label}: ambientación ${name(showing.style)} con IA, ilustrativa`
                            : `${photo.label}: foto original`
                        }
                        draggable={false}
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
                  <button type="button" className="dv2-thumbs-step" aria-label="Foto anterior" onClick={() => go(-1)}>
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
                  <button type="button" className="dv2-thumbs-step" aria-label="Foto siguiente" onClick={() => go(1)}>
                    <ChevronRight size={18} />
                  </button>
                </div>
              )}
            </div>
            {panel && <aside className="dv2-aside">{panel}</aside>}
          </div>
        )}
        {photos.some((p) => p.versions.length) && <p className="dv2-illustrative">{TEXT.illustrative}</p>}

        {(demo.description || demo.listingUrl || agency.visitUrl) && (
          <div className="dv2-details">
            {demo.description && (
              <section className="dv2-description" aria-labelledby="dv2-desc-title">
                <h2 id="dv2-desc-title">Descripción</h2>
                <p>{demo.description}</p>
              </section>
            )}
            <section className="dv2-contact" aria-label={`Contacto con ${agency.name}`}>
              {demo.listingUrl && (
                <a
                  className="dv2-contact-link"
                  href={demo.listingUrl}
                  {...external}
                  onClick={() => source.kind === "public" && track("demo_publicacion_original", analytics)}
                >
                  Ver publicación original <ExternalLink size={16} aria-hidden="true" />
                </a>
              )}
              {agency.visitUrl && (
                <a
                  className="dv2-contact-link"
                  href={agency.visitUrl}
                  {...external}
                  onClick={() => source.kind === "public" && track("demo_visita", analytics)}
                >
                  <CalendarDays size={16} aria-hidden="true" /> Coordinar una visita
                </a>
              )}
            </section>
          </div>
        )}
      </div>

      <footer className="dv2-footer container">
        <span>
          <Sparkles size={13} aria-hidden="true" /> Tecnología de amoblaIA
        </span>
      </footer>
      {contactButton && <div className="dv2-sticky">{contactButton}</div>}
    </div>
  );
}

function Brand({ agency }: { agency: PublicDemo["agency"] }) {
  return agency.logo ? <img src={agency.logo} alt={agency.name} /> : <strong>{agency.name}</strong>;
}
