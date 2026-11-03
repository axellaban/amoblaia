"use client";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Box,
  Clapperboard,
  Film,
  Globe,
  Image as ImageIcon,
  Images,
  MousePointerClick,
  Pause,
  Play,
  Share2,
  Smartphone,
  Upload,
} from "lucide-react";
import { Comparison } from "./comparison";
import { rooms, styles } from "@/lib/catalog";
import { exampleRooms, exampleStyles, examplePath } from "@/lib/examples";

// The home's value proposition: one property, many ways to show it (an
// interactive demo, the image studio and videos), for the agency's web, its
// visits and its social networks. Every picture is one of the site's own
// examples (public/ejemplos); none is presented as a client's work.

const START = "/panel/empezar";
const roomName = (id: string) => rooms.find((r) => r.id === id)?.name || id;
const styleName = (id: string) =>
  id === "original" ? "Original" : styles.find((s) => s.id === id)?.name || id;

type Has = (room: string, style: string) => boolean;

/** Reduced motion: the reel and the demo do not move on their own. */
function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(q.matches);
    sync();
    q.addEventListener("change", sync);
    return () => q.removeEventListener("change", sync);
  }, []);
  return reduced;
}

/**
 * What a video made in habita. looks like: the photos one after another with
 * a slow camera movement. It is an animation of the examples, not an MP4, so
 * it says «Vista ilustrativa» and has a pause button (WCAG 2.2.2).
 */
function Reel({
  frames,
  vertical = false,
  strip = false,
  label = "Vista ilustrativa de un video",
}: {
  frames: string[];
  vertical?: boolean;
  strip?: boolean;
  label?: string;
}) {
  const reduced = useReducedMotion();
  const [paused, setPaused] = useState(false);
  const [i, setI] = useState(0);
  const playing = !paused && !reduced && frames.length > 1;
  useEffect(() => {
    if (!playing) return;
    const t = window.setInterval(() => setI((n) => (n + 1) % frames.length), 3200);
    return () => window.clearInterval(t);
  }, [playing, frames.length]);
  if (!frames.length) return null;
  return (
    <div className={`hb-reel ${vertical ? "is-vertical" : ""} ${playing ? "is-playing" : ""}`}>
      <div className="hb-reel-frames" role="img" aria-label={label}>
        {frames.map((src, n) => (
          <img key={src} src={src} alt="" loading="lazy" className={n === i ? "is-on" : ""} />
        ))}
      </div>
      {vertical && <span className="hb-reel-format"><Smartphone size={13} aria-hidden="true" /> 9:16</span>}
      <button
        type="button"
        className="hb-reel-toggle"
        onClick={() => setPaused(playing)}
        aria-label={playing ? "Pausar la vista del video" : "Reproducir la vista del video"}
        disabled={reduced || frames.length < 2}
      >
        {playing ? <Pause size={20} /> : <Play size={20} />}
      </button>
      {strip && (
        <div className="hb-reel-strip" aria-hidden="true">
          {frames.map((src, n) => (
            <img key={src} src={src} alt="" loading="lazy" className={n === i ? "is-on" : ""} />
          ))}
        </div>
      )}
      <span className="hb-reel-progress" aria-hidden="true">
        <span key={`${i}-${playing}`} />
      </span>
    </div>
  );
}

/**
 * A miniature of the buyer's demo: the rooms of one property and its styles,
 * as the client sees them on a phone. It works: tapping changes the photo.
 */
function DemoViewer({
  has,
  demoRooms,
  compact = false,
}: {
  has: Has;
  demoRooms: string[];
  compact?: boolean;
}) {
  const [room, setRoom] = useState(demoRooms[0]);
  const [style, setStyle] = useState("modern");
  const options = ["original", ...exampleStyles.filter((s) => ["modern", "scandinavian", "classic", "minimalist"].includes(s))].filter((s) => has(room, s));
  const current = options.includes(style) ? style : options[1] || options[0];
  if (!room) return null;
  return (
    <div className={`hb-demo ${compact ? "is-compact" : ""}`}>
      <div className="hb-demo-photo">
        <img key={`${room}-${current}`} src={examplePath(room, current)} alt={`${roomName(room)}, ${styleName(current)}`} />
        <div className="hb-demo-styles" role="group" aria-label="Estilo">
          {options.map((s) => (
            <button key={s} type="button" aria-pressed={s === current} onClick={() => setStyle(s)}>
              {styleName(s)}
            </button>
          ))}
        </div>
      </div>
      <div className="hb-demo-rooms" role="group" aria-label="Ambiente">
        {demoRooms.map((r) => (
          <button key={r} type="button" aria-pressed={r === room} onClick={() => setRoom(r)}>
            <img src={examplePath(r, "original")} alt="" loading="lazy" />
            <span>{roomName(r)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Pill({ icon: Icon, children }: { icon: typeof Play; children: ReactNode }) {
  return (
    <span className="hb-pill">
      <Icon size={15} aria-hidden="true" /> {children}
    </span>
  );
}

export function Landing({ scenes, trial }: { scenes: string[]; trial: boolean }) {
  const has: Has = (room, style) =>
    scenes.includes(`${room}-${style === "original" ? "before" : style}`);
  const sceneRooms: string[] = exampleRooms.filter((r) => has(r, "original") && exampleStyles.some((s) => has(r, s)));
  const pick = (room: string, ...wanted: string[]) => wanted.find((s) => has(room, s)) || exampleStyles.find((s) => has(room, s)) || "original";
  const lead = sceneRooms.includes("living") ? "living" : sceneRooms[0] || "living";
  const leadStyle = pick(lead, "scandinavian", "modern");
  // The rooms of the demo, in the order a visit walks through them.
  const demoRooms = ["living", "kitchen", "bedroom", "dining", "outdoor"].filter((r) => sceneRooms.includes(r)).slice(0, 4);
  const reel = ["living", "kitchen", "bedroom", "dining", "outdoor"]
    .filter((r) => sceneRooms.includes(r))
    .slice(0, 4)
    .map((r) => examplePath(r, pick(r, "modern", "scandinavian")));
  const second = sceneRooms.includes("bedroom") ? "bedroom" : sceneRooms[1] || lead;
  const [view, setView] = useState<"demo" | "compare" | "video">("compare");

  return (
    <div className="hb">
      {/* 1. Hero: the promise and the three ways of showing a property. */}
      <section className="hb-hero">
        <div className="hb-wrap hb-hero-grid">
          <div className="hb-hero-copy">
            <p className="hb-kicker">Marketing inmobiliario con IA</p>
            <h1>Que tus clientes se imaginen viviendo ahí.</h1>
            <p className="hb-lead">
              Creá demostraciones interactivas, transformá tus imágenes y generá
              videos para tu web, tus visitas y tus redes.
            </p>
            <div className="hb-actions">
              <Link href={START} className="hb-btn">
                Empezar con una propiedad <ArrowRight size={18} aria-hidden="true" />
              </Link>
              <a href="#experiencia" className="hb-link">
                Ver demo interactiva <ArrowUpRight size={17} aria-hidden="true" />
              </a>
            </div>
          </div>
          <div className="hb-hero-visual">
            <div className="hb-hero-stage" id="hb-hero-stage">
              {view === "compare" && (
                <Comparison
                  before={examplePath(lead, "original")}
                  after={examplePath(lead, leadStyle)}
                  beforeLabel="Original"
                  afterLabel="Propuesta con IA"
                  alt={`${roomName(lead)} ambientado con IA, estilo ${styleName(leadStyle)}`}
                  beforeAlt={`${roomName(lead)} vacío, la foto original`}
                  initial={50}
                  teach
                />
              )}
              {view === "demo" && <DemoViewer has={has} demoRooms={demoRooms} />}
              {view === "video" && <Reel frames={reel} strip />}
              {/* Desktop only: the same property as a video and on a phone. */}
              <div className="hb-hero-float hb-hero-float-video" aria-hidden="true">
                <img src={examplePath(second, pick(second, "modern", "scandinavian"))} alt="" />
                <span><Play size={16} /></span>
              </div>
              <div className="hb-hero-float hb-hero-phone" aria-hidden="true">
                <b>habita.</b>
                <img src={examplePath(lead, pick(lead, "modern"))} alt="" />
                <i>
                  {demoRooms.slice(0, 3).map((r) => (
                    <img key={r} src={examplePath(r, "original")} alt="" />
                  ))}
                </i>
              </div>
            </div>
            <p className="hb-hero-note">Una propiedad. Muchas formas de mostrar su potencial.</p>
            <div className="hb-tabs" role="group" aria-label="Formas de mostrar la propiedad">
              {(
                [
                  ["demo", Box, "Demo interactiva"],
                  ["compare", ImageIcon, "Antes / después"],
                  ["video", Play, "Video"],
                ] as const
              ).map(([id, Icon, label]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={view === id}
                  aria-controls="hb-hero-stage"
                  onClick={() => setView(id)}
                >
                  <Icon size={17} aria-hidden="true" /> {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 2. The three products. */}
      <section className="hb-section" id="crear" aria-labelledby="hb-crear">
        <div className="hb-wrap">
          <header className="hb-head">
            <h2 id="hb-crear">Una propiedad. Todo su potencial.</h2>
            <p>Elegí qué querés crear. Compartilo donde tus clientes lo van a ver.</p>
          </header>
          <div className="hb-products">
            <article className="hb-card">
              <div className="hb-card-media">
                <DemoViewer has={has} demoRooms={demoRooms.slice(0, 1)} compact />
              </div>
              <h3>Demostraciones interactivas</h3>
              <p>Una ficha para recorrer, cambiar el estilo de cada ambiente y compartir por WhatsApp.</p>
              <Link href={START} className="hb-more">
                Crear mi demo <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </article>
            <article className="hb-card">
              <div className="hb-card-media hb-split" aria-hidden="true">
                <span>
                  <img src={examplePath(second, "original")} alt="" loading="lazy" />
                  <em>Antes</em>
                </span>
                <span>
                  <img src={examplePath(second, pick(second, "scandinavian", "modern"))} alt="" loading="lazy" />
                  <em>Después</em>
                </span>
              </div>
              <h3>Estudio de imágenes</h3>
              <p>Amoblá, vaciá o mejorá tus fotos y descargalas listas para publicar.</p>
              <Link href="/estudio" className="hb-more">
                {trial ? "Probalo gratis" : "Explorar el estudio"} <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </article>
            <article className="hb-card">
              <div className="hb-card-media">
                <Reel frames={reel} vertical />
              </div>
              <h3>Videos</h3>
              <p>Convertí las fotos en recorridos y videos verticales u horizontales, con música y tu marca.</p>
              <Link href="/panel/video" className="hb-more">
                Crear un video <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </article>
          </div>
        </div>
      </section>

      {/* 3. The demo, before, during and after the visit. */}
      <section className="hb-section hb-visit" id="experiencia" aria-labelledby="hb-visit">
        <div className="hb-wrap hb-visit-grid">
          <div className="hb-visit-copy">
            <h2 id="hb-visit">Una experiencia que acompaña cada visita.</h2>
            <p>
              Compartí una demo que tus clientes puedan recorrer y reenviar. Probala:
              tocá un ambiente o un estilo.
            </p>
          </div>
          <div className="hb-device" aria-label="Demo de ejemplo, como la ve un comprador">
            <div className="hb-device-bar" aria-hidden="true">
              <b>habita.</b>
              <span>Departamento de ejemplo</span>
            </div>
            <DemoViewer has={has} demoRooms={demoRooms} />
            <small>Vista ilustrativa con fotos de ejemplo</small>
          </div>
          <ol className="hb-moments">
            {[
              ["Antes de la visita", "Despertá interés y compartí la demo."],
              ["Durante la visita", "Ayudá a imaginar cómo podrían vivir ahí."],
              ["Después de la visita", "Retomá la conversación con una propuesta."],
            ].map(([title, text], n) => (
              <li key={title}>
                <span>0{n + 1}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* 4. Where each result goes. */}
      <section className="hb-section" aria-labelledby="hb-uses">
        <div className="hb-wrap">
          <header className="hb-head">
            <h2 id="hb-uses">De una foto a muchas posibilidades.</h2>
          </header>
          <div className="hb-uses">
            <article className="hb-use">
              <Comparison
                before={examplePath(lead, "original")}
                after={examplePath(lead, pick(lead, "modern", "scandinavian"))}
                beforeLabel="Original"
                afterLabel="Ambientada con IA"
                alt={`${roomName(lead)} ambientado con IA`}
                beforeAlt={`${roomName(lead)} vacío`}
                initial={50}
              />
              <h3>Imágenes que muestran el potencial</h3>
              <p>Transformá tus fotos y mostrá cómo puede verse el espacio.</p>
            </article>
            <article className="hb-use">
              <Reel frames={reel} strip />
              <h3>Dale movimiento a tus propiedades</h3>
              <p>Convertí tus imágenes en videos que transmiten el espacio real.</p>
              <div className="hb-pills">
                <Pill icon={Film}>Clásico</Pill>
                <Pill icon={ImageIcon}>Foto en movimiento</Pill>
                <Pill icon={Clapperboard}>Recorrido cinematográfico</Pill>
              </div>
            </article>
            <article className="hb-use hb-use-web">
              <h3>Dale vida a tu web</h3>
              <p>Sumá demos, imágenes mejoradas y videos al sitio de tu inmobiliaria.</p>
              <div className="hb-browser" aria-hidden="true">
                <div className="hb-browser-bar">
                  <i /><i /><i />
                  <span>Propiedades · Nosotros · Contacto</span>
                </div>
                <div className="hb-browser-hero">
                  <img src={examplePath(lead, pick(lead, "modern"))} alt="" loading="lazy" />
                  <div>
                    <strong>Departamento de 3 ambientes</strong>
                    <em>Explorá esta propiedad <ArrowRight size={13} /></em>
                  </div>
                </div>
              </div>
              <p className="hb-use-foot">
                <Globe size={15} aria-hidden="true" /> Imágenes · Videos · Acceso a tu demo
              </p>
            </article>
            <article className="hb-use hb-use-social">
              <h3>Expandí tu audiencia</h3>
              <p>Mostrá tus propiedades en redes con contenido que se detiene a mirar.</p>
              <div className="hb-posts" aria-hidden="true">
                <span className="is-square"><img src={examplePath(second, pick(second, "modern"))} alt="" loading="lazy" /></span>
                <span className="is-story">
                  <img src={examplePath(lead, pick(lead, "scandinavian", "modern"))} alt="" loading="lazy" />
                  <Play size={18} />
                </span>
                <span className="is-portrait">
                  <img src={examplePath(sceneRooms.includes("dining") ? "dining" : lead, pick(sceneRooms.includes("dining") ? "dining" : lead, "modern"))} alt="" loading="lazy" />
                </span>
              </div>
              <p className="hb-use-foot">
                <Images size={15} aria-hidden="true" /> Fotos · Reels · Stories · Posts
              </p>
            </article>
          </div>
        </div>
      </section>

      {/* 5. How it starts. */}
      <section className="hb-section hb-steps-section" id="como-funciona" aria-labelledby="hb-steps">
        <div className="hb-wrap">
          <header className="hb-head">
            <h2 id="hb-steps">Empezá con lo que ya tenés.</h2>
          </header>
          <ol className="hb-steps">
            {[
              [Upload, "Subí fotos o importá una propiedad", "Pegá el enlace de tu publicación y traemos las fotos."],
              [MousePointerClick, "Elegí qué querés crear", "Una demo, imágenes ambientadas o un video."],
              [Share2, "Descargá o compartí el resultado", "En tu web, por WhatsApp o en tus redes."],
            ].map(([Icon, title, text], n) => {
              const I = Icon as typeof Upload;
              return (
                <li key={title as string}>
                  <span className="hb-step-icon"><I size={22} aria-hidden="true" /></span>
                  <div>
                    <h3><span>{n + 1}.</span> {title as string}</h3>
                    <p>{text as string}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      {/* 6. Why it matters: industry figures, never habita.'s own results. */}
      <section className="hb-wrap-wide" aria-labelledby="hb-why">
        <div className="hb-why">
          <h2 id="hb-why">Por qué es importante para tu negocio</h2>
          <div className="hb-stats">
            {[
              ["83 %", "de los agentes de compradores", "dice que ambientar ayuda a imaginar la propiedad como un futuro hogar."],
              ["49 %", "de los agentes de vendedores", "vio que ambientar redujo el tiempo de la propiedad en el mercado."],
              ["29 %", "de los agentes de vendedores", "recibió ofertas entre 1 % y 10 % más altas con la propiedad ambientada."],
            ].map(([n, who, what]) => (
              <div key={what}>
                <strong>{n}</strong>
                <b>{who}</b>
                <p>{what}</p>
              </div>
            ))}
          </div>
          <p className="hb-source">
            Fuente:{" "}
            <a
              href="https://www.nar.realtor/press-releases/nar-report-reveals-home-staging-boosts-sale-prices-and-reduces-time-on-market"
              target="_blank"
              rel="noopener noreferrer"
            >
              NAR, 2025 Profile of Home Staging
            </a>{" "}
            (Estados Unidos). Se refieren al staging en general; no son resultados medidos de habita.
          </p>
        </div>
      </section>

      {/* 7. Close. */}
      <section className="hb-wrap hb-final">
        <h2>Tu próxima propiedad tiene mucho para mostrar.</h2>
        <Link href={START} className="hb-btn">
          Empezar con una propiedad <ArrowRight size={18} aria-hidden="true" />
        </Link>
      </section>
    </div>
  );
}
