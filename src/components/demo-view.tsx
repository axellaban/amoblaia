"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Info,
  MapPin,
  Sparkles,
} from "lucide-react";
import { Comparison } from "./comparison";
import { registerSuperProperties, track } from "@/lib/analytics";
import {
  adminPhotoUrl,
  ctaHref,
  DEMO_REF_KEY,
  DEMO_TEXT,
  publicImageUrl,
  type PublicDemo,
  type PublicPhoto,
} from "@/lib/demos/shared";

type Source = { kind: "public"; token: string } | { kind: "preview" };
type View = "compare" | "staged" | "original";

function urlFor(source: Source, photo: PublicPhoto, variant: "original" | "staged", width: number) {
  return source.kind === "public"
    ? publicImageUrl(source.token, photo, variant, width)
    : adminPhotoUrl(photo.id, variant, width, photo.version);
}

/**
 * The commercial demo as the agency sees it. The admin preview renders this
 * same component, only with images served from the admin route.
 */
export function DemoView({ demo, source }: { demo: PublicDemo; source: Source }) {
  const [index, setIndex] = useState(0);
  // Kept while moving between photos, so a visitor comparing keeps comparing.
  const [view, setView] = useState<View>("compare");
  const [ratios, setRatios] = useState<Record<string, number>>({});
  const photos = demo.photos;
  const photo = photos[index];
  const stagedCount = useMemo(() => photos.filter((p) => p.staged).length, [photos]);
  const analytics = useMemo(
    () => ({
      demo_id: demo.id,
      inmobiliaria_id: demo.agencyId,
      fotos: photos.length,
      ambientadas: stagedCount,
    }),
    [demo.id, demo.agencyId, photos.length, stagedCount],
  );

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

  const go = useCallback(
    (step: number) =>
      setIndex((i) => (photos.length ? (i + step + photos.length) % photos.length : 0)),
    [photos.length],
  );
  // Arrow keys move between photos, except while the slider has the focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);
  // The next photo starts loading before it is needed.
  useEffect(() => {
    const next = photos[(index + 1) % Math.max(1, photos.length)];
    if (!next || next === photo) return;
    const img = new Image();
    img.src = urlFor(source, next, next.staged ? "staged" : "original", 1600);
  }, [index, photos, photo, source]);

  const measure = (id: string) => (e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
    if (w && h) setRatios((r) => (r[id] ? r : { ...r, [id]: w / h }));
  };
  const ratio = photo ? ratios[photo.id] ?? 4 / 3 : 4 / 3;
  const shown: View = photo?.staged ? view : "original";

  return (
    <div className="demo-page">
      <section className="demo-hero">
        <div className="container">
          <span className="eyebrow">Muestra para {demo.agencyName}</span>
          <h1>{demo.title}</h1>
          {demo.location && (
            <p className="demo-location">
              <MapPin size={17} aria-hidden="true" /> {demo.location}
            </p>
          )}
          <p className="demo-headline">{DEMO_TEXT.headline}.</p>
          {demo.description && <p className="demo-description">{demo.description}</p>}
        </div>
      </section>

      <section className="demo-gallery container" aria-label="Galería de la propiedad">
        <p className="demo-disclaimer" role="note">
          <Info size={18} aria-hidden="true" />
          {DEMO_TEXT.disclaimer}
        </p>
        {!photo ? (
          <p className="demo-empty">Esta demo todavía no tiene fotos.</p>
        ) : (
          <>
            <div className="demo-toolbar">
              <div>
                <strong>{photo.label}</strong>
                <span>
                  {index + 1} de {photos.length}
                </span>
              </div>
              {photo.staged ? (
                <div className="demo-toggle" role="group" aria-label="Cómo ver la foto">
                  {(
                    [
                      ["compare", "Comparar"],
                      ["staged", "Ambientación IA"],
                      ["original", "Foto original"],
                    ] as const
                  ).map(([id, name]) => (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={view === id}
                      className={view === id ? "is-active" : ""}
                      onClick={() => setView(id)}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              ) : (
                <span className="demo-plain-note">Foto original, sin ambientación</span>
              )}
            </div>
            <div
              className="demo-stage"
              style={{ "--ratio": String(ratio) } as React.CSSProperties}
            >
              {/* Measures the real proportions so nothing of the frame is cropped. */}
              <img
                className="demo-measure"
                src={urlFor(source, photo, "original", 480)}
                alt=""
                aria-hidden="true"
                onLoad={measure(photo.id)}
              />
              {shown === "compare" ? (
                <Comparison
                  key={photo.id}
                  before={urlFor(source, photo, "original", 1600)}
                  after={urlFor(source, photo, "staged", 1600)}
                  alt={`${photo.label}: ambientación virtual con IA`}
                  beforeAlt={`${photo.label}: foto original`}
                  beforeLabel={DEMO_TEXT.original}
                  afterLabel={DEMO_TEXT.badge}
                  initial={50}
                />
              ) : (
                <figure className="demo-single">
                  <img
                    key={`${photo.id}-${shown}`}
                    src={urlFor(source, photo, shown, 1600)}
                    alt={`${photo.label}: ${shown === "staged" ? "ambientación virtual con IA" : "foto original"}`}
                  />
                  <figcaption className={shown === "staged" ? "is-ai" : ""}>
                    {shown === "staged" ? (
                      <>
                        <Sparkles size={14} aria-hidden="true" /> {DEMO_TEXT.badge}
                      </>
                    ) : (
                      DEMO_TEXT.original
                    )}
                  </figcaption>
                </figure>
              )}
              {photos.length > 1 && (
                <>
                  <button
                    type="button"
                    className="demo-nav demo-prev"
                    aria-label="Foto anterior"
                    onClick={() => go(-1)}
                  >
                    <ChevronLeft size={24} />
                  </button>
                  <button
                    type="button"
                    className="demo-nav demo-next"
                    aria-label="Foto siguiente"
                    onClick={() => go(1)}
                  >
                    <ChevronRight size={24} />
                  </button>
                </>
              )}
            </div>
            {shown === "compare" && (
              <p className="demo-hint">Deslizá la línea para comparar la foto original con la ambientación.</p>
            )}
            {photos.length > 1 && (
              <ol className="demo-thumbs" aria-label="Fotos de la propiedad">
                {photos.map((p, i) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      aria-current={i === index ? "true" : undefined}
                      aria-label={`${p.label}${p.staged ? ", con ambientación virtual" : ""}`}
                      className={i === index ? "is-active" : ""}
                      onClick={() => setIndex(i)}
                    >
                      <img
                        src={urlFor(source, p, p.staged ? "staged" : "original", 480)}
                        alt=""
                        loading="lazy"
                      />
                      {p.staged && (
                        <span className="demo-thumb-badge">
                          <Sparkles size={11} aria-hidden="true" /> IA
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </section>

      <section className="demo-cta container">
        <div>
          <h2>{DEMO_TEXT.ctaTitle}</h2>
          <p>{DEMO_TEXT.ctaBody}</p>
        </div>
        <Link
          href={ctaHref(demo.id, demo.agencyId)}
          className="button button-primary button-large"
          onClick={() => source.kind === "public" && track("demo_cta_click", analytics, true)}
        >
          {DEMO_TEXT.ctaButton} <ArrowRight size={18} />
        </Link>
      </section>
      <p className="demo-footnote container">{DEMO_TEXT.disclaimer}</p>
    </div>
  );
}
