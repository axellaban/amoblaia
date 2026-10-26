"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Pause,
  Play,
  Share2,
  Sparkles,
  X,
} from "lucide-react";
import { Comparison } from "./comparison";
import { registerSuperProperties, track } from "@/lib/analytics";
import {
  adminPhotoUrl,
  ctaHref,
  DEMO_REF_KEY,
  DEMO_TEXT,
  publicImageUrl,
  type PhotoVersion,
  type PublicDemo,
  type PublicPhoto,
} from "@/lib/demos/shared";

type Source = { kind: "public"; token: string } | { kind: "preview" };
/** A style id, or "original". */
type Choice = string;
const ORIGINAL = "original";
/** Like Zillow's ?vsxlb=1: a link that opens the page straight in the staging viewer. */
const VIEWER_PARAM = "ambientar";
const SLIDE_MS = 5000;

function urlFor(source: Source, photoId: string, version: PhotoVersion | null, width: number) {
  return source.kind === "public"
    ? publicImageUrl(source.token, photoId, version, width)
    : adminPhotoUrl(photoId, version, width);
}
const versionOf = (photo: PublicPhoto, choice: Choice) =>
  choice === ORIGINAL ? null : (photo.versions.find((v) => v.style === choice) ?? null);

/**
 * The commercial demo as the agency sees it: a full-width slideshow of the
 * photos in the main style, and a staging viewer to compare every photo in
 * each style the demo offers. The admin preview renders this same component,
 * only with images served from the admin route.
 */
export function DemoView({ demo, source }: { demo: PublicDemo; source: Source }) {
  const photos = demo.photos;
  const main = demo.styles[0]?.id ?? ORIGINAL;
  const styleNames = useMemo(
    () => Object.fromEntries(demo.styles.map((s) => [s.id, s.name])) as Record<string, string>,
    [demo.styles],
  );
  const staged = useMemo(() => photos.filter((p) => p.versions.length).length, [photos]);
  const analytics = useMemo(
    () => ({
      demo_id: demo.id,
      inmobiliaria_id: demo.agencyId,
      fotos: photos.length,
      ambientadas: staged,
      estilos: demo.styles.length,
    }),
    [demo.id, demo.agencyId, photos.length, staged, demo.styles.length],
  );
  const [slide, setSlide] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [viewer, setViewer] = useState<{ index: number; choice: Choice } | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const coverIndex = Math.max(0, photos.findIndex((p) => p.id === demo.cover?.id));

  useEffect(() => {
    if (source.kind !== "public") return;
    track("demo_vista", analytics);
    registerSuperProperties({ demo_id: demo.id, demo_inmobiliaria_id: demo.agencyId });
    try {
      localStorage.setItem(
        DEMO_REF_KEY,
        JSON.stringify({ demoId: demo.id, agencyId: demo.agencyId, at: Date.now() }),
      );
    } catch {
      /* Private mode or blocked storage: attribution then relies on the CTA link. */
    }
  }, [source.kind, demo.id, demo.agencyId, analytics]);

  const open = useCallback(
    (index: number, choice: Choice, from: string) => {
      opener.current = document.activeElement as HTMLElement | null;
      setViewer({ index, choice });
      if (source.kind === "public") track("demo_visor_abierto", { ...analytics, desde: from });
      const url = new URL(window.location.href);
      url.searchParams.set(VIEWER_PARAM, "1");
      window.history.replaceState(null, "", url);
    },
    [analytics, source.kind],
  );
  const close = useCallback(() => {
    setViewer(null);
    const url = new URL(window.location.href);
    url.searchParams.delete(VIEWER_PARAM);
    window.history.replaceState(null, "", url);
    opener.current?.focus();
  }, []);
  // A shared link with ?ambientar=1 opens on the viewer, like the CTA.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has(VIEWER_PARAM) && photos.length)
      setViewer({ index: coverIndex, choice: main });
    // Only on arrival.
  }, []);
  // Reduced motion: the slideshow starts paused.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setPlaying(false);
  }, []);
  useEffect(() => {
    if (!playing || viewer || photos.length < 2) return;
    const timer = setTimeout(() => setSlide((i) => (i + 1) % photos.length), SLIDE_MS);
    return () => clearTimeout(timer);
  }, [playing, viewer, slide, photos.length]);

  const hero = photos[slide];
  const heroVersion = hero ? versionOf(hero, main) ?? hero.versions[0] ?? null : null;
  const cover = photos[coverIndex];
  const coverStaged = cover ? versionOf(cover, main) : null;
  const teaser = cover ? [ORIGINAL, ...cover.versions.map((v) => v.style)] : [];

  async function share() {
    const url = window.location.href.split("?")[0];
    try {
      if (navigator.share) await navigator.share({ title: demo.title, url });
      else await navigator.clipboard.writeText(url);
    } catch {
      /* Cancelled by the visitor. */
    }
  }

  return (
    <div className="dv-page">
      <section className="dv-hero" aria-label="Fotos de la propiedad">
        {hero ? (
          <img
            key={`${hero.id}-${heroVersion?.v ?? "o"}`}
            className="dv-hero-img"
            src={urlFor(source, hero.id, heroVersion, 2048)}
            alt={`${hero.label}${heroVersion ? `: ambientación virtual ${styleNames[heroVersion.style] ?? ""}` : ""}`}
          />
        ) : (
          <div className="dv-hero-empty">Esta demo todavía no tiene fotos.</div>
        )}
        <div className="dv-hero-shade" aria-hidden="true" />
        <div className="dv-hero-top">
          <span className="dv-pill">
            <b>
              amobla<span>IA</span>
            </b>
            <span className="dv-pill-muted">· Muestra para {demo.agencyName}</span>
          </span>
          {source.kind === "public" && (
            <button type="button" className="dv-pill dv-pill-button" onClick={share}>
              <Share2 size={17} aria-hidden="true" /> Compartir
            </button>
          )}
        </div>
        {hero && (
          <div className="dv-hero-bottom">
            <nav className="dv-tiles" aria-label="Accesos de la galería">
              {coverStaged && (
                <button type="button" className="dv-tile" onClick={() => open(coverIndex, main, "portada")}>
                  <span className="dv-tile-img">
                    <img src={urlFor(source, cover.id, coverStaged, 480)} alt="" />
                    <span className="dv-new">Nuevo</span>
                  </span>
                  Ambientación virtual
                </button>
              )}
              <button type="button" className="dv-tile" onClick={() => open(0, ORIGINAL, "fotos")}>
                <span className="dv-tile-img">
                  <img src={urlFor(source, photos[0].id, null, 480)} alt="" />
                </span>
                Fotos ({photos.length})
              </button>
            </nav>
            {photos.length > 1 && (
              <div className="dv-progress">
                <button
                  type="button"
                  className="dv-play"
                  aria-label={playing ? "Pausar el pase de fotos" : "Reanudar el pase de fotos"}
                  onClick={() => setPlaying((p) => !p)}
                >
                  {playing ? <Pause size={18} /> : <Play size={18} />}
                </button>
                <ol>
                  {photos.map((p, i) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        aria-label={`Ver ${p.label}`}
                        aria-current={i === slide ? "true" : undefined}
                        onClick={() => setSlide(i)}
                      >
                        <span
                          className={i === slide ? (playing && !viewer ? "is-running" : "is-on") : ""}
                          style={{ animationDuration: `${SLIDE_MS}ms` }}
                        />
                      </button>
                    </li>
                  ))}
                </ol>
                <span className="dv-caption">
                  {heroVersion ? styleNames[heroVersion.style] : DEMO_TEXT.original}
                </span>
              </div>
            )}
          </div>
        )}
      </section>

      <div className="dv-body container">
        <main className="dv-main">
          <div className="dv-agency">
            <strong>{demo.agencyName}</strong>
            <span>Muestra de ambientación virtual</span>
          </div>
          <div className="dv-title">
            {staged > 0 && (
              <span className="dv-badge">
                <span aria-hidden="true" /> {DEMO_TEXT.badge}
              </span>
            )}
            <h1>{demo.title}</h1>
            {demo.location && (
              <p className="dv-location">
                <MapPin size={18} aria-hidden="true" /> {demo.location}
              </p>
            )}
          </div>
          <p className="dv-description">{demo.description || `${DEMO_TEXT.headline}.`}</p>

          {staged > 0 && cover && (
            <section className="dv-teaser" aria-labelledby="dv-teaser-title">
              <div className="dv-teaser-head">
                <div>
                  <h2 id="dv-teaser-title">Mirala ambientada</h2>
                  <p>
                    {staged} {staged === 1 ? "foto" : "fotos"} ·{" "}
                    {demo.styles.length === 1
                      ? `estilo ${demo.styles[0].name}`
                      : `${demo.styles.length} estilos: ${demo.styles.map((s) => s.name).join(", ")}`}
                  </p>
                </div>
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => open(coverIndex, main, "boton")}
                >
                  <Sparkles size={18} aria-hidden="true" /> Ver ambientación virtual
                </button>
              </div>
              <ul className="dv-teaser-grid">
                {teaser.map((choice) => (
                  <li key={choice}>
                    <button type="button" onClick={() => open(coverIndex, choice, "miniatura")}>
                      <img src={urlFor(source, cover.id, versionOf(cover, choice), 480)} alt="" loading="lazy" />
                      {choice === ORIGINAL ? DEMO_TEXT.original : styleNames[choice]}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="dv-footnote">{DEMO_TEXT.disclaimer}</p>
        </main>

        <aside className="dv-aside">
          <span>Muestra preparada por</span>
          <strong className="dv-logo">
            amobla<span>IA</span>
          </strong>
          <p>
            {DEMO_TEXT.ctaTitle} {DEMO_TEXT.ctaBody}
          </p>
          <Link
            href={ctaHref(demo.id, demo.agencyId)}
            className="button button-outline button-large"
            onClick={() => source.kind === "public" && track("demo_cta_click", analytics, true)}
          >
            {DEMO_TEXT.ctaButton} <ArrowRight size={18} />
          </Link>
        </aside>
      </div>

      {viewer && photos.length > 0 && (
        <StagingViewer
          demo={demo}
          source={source}
          styleNames={styleNames}
          index={viewer.index}
          choice={viewer.choice}
          onChange={(index, choice) => {
            if (choice !== viewer.choice && source.kind === "public")
              track("demo_estilo", { ...analytics, estilo: choice });
            setViewer({ index, choice });
          }}
          onClose={close}
          onCta={() => source.kind === "public" && track("demo_cta_click", analytics, true)}
        />
      )}
    </div>
  );
}

/** "Ambientá este espacio": one photo at a time, with every style it was staged in. */
function StagingViewer({
  demo,
  source,
  styleNames,
  index,
  choice,
  onChange,
  onClose,
  onCta,
}: {
  demo: PublicDemo;
  source: Source;
  styleNames: Record<string, string>;
  index: number;
  choice: Choice;
  onChange: (index: number, choice: Choice) => void;
  onClose: () => void;
  onCta: () => void;
}) {
  const photos = demo.photos;
  const photo = photos[index] ?? photos[0];
  // The chosen style stays while moving between photos; a photo without it shows as is.
  const version = versionOf(photo, choice);
  const shown = version ? choice : ORIGINAL;
  const [ratios, setRatios] = useState<Record<string, number>>({});
  const closeButton = useRef<HTMLButtonElement>(null);
  const go = useCallback(
    (step: number) => onChange((index + step + photos.length) % photos.length, choice),
    [index, choice, photos.length, onChange],
  );

  useEffect(() => {
    closeButton.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select")) return;
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onClose]);
  // The next photo starts loading before it is needed.
  useEffect(() => {
    const next = photos[(index + 1) % photos.length];
    if (!next || next === photo) return;
    const img = new Image();
    img.src = urlFor(source, next.id, versionOf(next, choice), 1600);
  }, [index, photos, photo, choice, source]);

  const ratio = ratios[photo.id] ?? 4 / 3;
  const options = [ORIGINAL, ...photo.versions.map((v) => v.style)];
  return (
    <div className="dv-viewer" role="dialog" aria-modal="true" aria-labelledby="dv-viewer-title">
      <header className="dv-viewer-head">
        <h2 id="dv-viewer-title">
          <Sparkles size={22} aria-hidden="true" /> Ambientá este espacio
        </h2>
        <button ref={closeButton} type="button" className="dv-icon" aria-label="Cerrar" onClick={onClose}>
          <X size={24} />
        </button>
      </header>
      <div className="dv-viewer-body">
        <section className="dv-viewer-photo" aria-label={`${photo.label}, foto ${index + 1} de ${photos.length}`}>
          <div className="dv-viewer-stage">
            {/* Measures the real proportions so nothing of the frame is cropped. */}
            <img
              className="dv-measure"
              src={urlFor(source, photo.id, null, 480)}
              alt=""
              aria-hidden="true"
              onLoad={(e) => {
                const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
                if (w && h) setRatios((r) => (r[photo.id] ? r : { ...r, [photo.id]: w / h }));
              }}
            />
            <div className="dv-frame" style={{ "--ratio": String(ratio) } as React.CSSProperties}>
              {version ? (
                <Comparison
                  key={`${photo.id}-${shown}`}
                  before={urlFor(source, photo.id, null, 1600)}
                  after={urlFor(source, photo.id, version, 1600)}
                  alt={`${photo.label}: ambientación virtual ${styleNames[shown]}`}
                  beforeAlt={`${photo.label}: foto original`}
                  beforeLabel={DEMO_TEXT.original}
                  afterLabel={`Ambientación virtual · ${styleNames[shown]}`}
                  initial={50}
                />
              ) : (
                <img
                  key={photo.id}
                  className="dv-single"
                  src={urlFor(source, photo.id, null, 1600)}
                  alt={`${photo.label}: foto original`}
                />
              )}
            </div>
            {photos.length > 1 && (
              <>
                <button type="button" className="dv-nav dv-prev" aria-label="Foto anterior" onClick={() => go(-1)}>
                  <ChevronLeft size={26} />
                </button>
                <button type="button" className="dv-nav dv-next" aria-label="Foto siguiente" onClick={() => go(1)}>
                  <ChevronRight size={26} />
                </button>
              </>
            )}
          </div>
          <div className="dv-viewer-meta">
            <span>
              <strong>{photo.label}</strong> · Foto {index + 1} de {photos.length}
            </span>
            {photos.length > 1 && photos.length <= 20 && (
              <span className="dv-dots" aria-hidden="true">
                {photos.map((p, i) => (
                  <span key={p.id} className={i === index ? "is-on" : ""} />
                ))}
              </span>
            )}
          </div>
        </section>

        <aside className="dv-viewer-side" aria-labelledby="dv-styles-title">
          <h3 id="dv-styles-title">Elegí un estilo</h3>
          {photo.versions.length ? (
            <div className="dv-styles" role="radiogroup" aria-labelledby="dv-styles-title">
              {options.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={shown === id}
                  className={shown === id ? "is-on" : ""}
                  onClick={() => onChange(index, id)}
                >
                  <img src={urlFor(source, photo.id, versionOf(photo, id), 480)} alt="" loading="lazy" />
                  <span>{id === ORIGINAL ? DEMO_TEXT.original : styleNames[id]}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="dv-plain">
              Esta foto se muestra como es, sin ambientación.
              {photos.length > 1 ? " Pasá a otra para ver los estilos." : ""}
            </p>
          )}
          <p className="dv-viewer-note">{DEMO_TEXT.disclaimer}</p>
          <Link href={ctaHref(demo.id, demo.agencyId)} className="button button-primary" onClick={onCta}>
            Quiero esto para mis propiedades
          </Link>
        </aside>
      </div>
      <span className="dv-sr" aria-live="polite">
        {photo.label}: {shown === ORIGINAL ? DEMO_TEXT.original : `ambientación ${styleNames[shown]}`}
      </span>
    </div>
  );
}
