"use client";
import Link from "next/link";
import { useState } from "react";
import { Studio } from "./studio";
import {
  ArrowUpRight,
  Check,
  X,
  Plus,
  Minus,
  MousePointerClick,
  Timer,
  Wallet,
  RefreshCw,
  Eye,
  Clock,
  Star,
} from "lucide-react";
import { rooms, styles } from "@/lib/catalog";
import { exampleRooms, exampleStyles, examplePath } from "@/lib/examples";
const roomName = (id: string) => rooms.find((r) => r.id === id)?.name || id;
const styleName = (id: string) =>
  id === "original" ? "Original" : styles.find((s) => s.id === id)?.name || id;
const highlights = [
  "Precio accesible",
  "Listo en minutos",
  "Retiro de muebles",
  "10 estilos de decoración",
];
const faqs = [
  [
    "¿Qué es el virtual staging?",
    "Es amoblar digitalmente la foto de una propiedad. Muestra cómo se vería el espacio habitado, sin trasladar muebles ni hacer reformas.",
  ],
  [
    "¿Por qué virtual y no un amoblamiento real?",
    "Cuesta una fracción, está listo en minutos y podés probar varios estilos sobre la misma foto. No hay fletes, alquiler de muebles ni visitas a coordinar.",
  ],
  [
    "¿Qué hace la inteligencia artificial?",
    "Recibe tu foto y la amobla respetando paredes, aberturas, pisos y perspectiva. También puede rediseñar un ambiente con muebles o vaciarlo. Revisá siempre el resultado antes de publicarlo.",
  ],
  [
    "¿Qué fotos sirven?",
    "Fotos JPG, PNG o WebP de hasta 10 MB, de ambientes vacíos o amoblados. Funcionan mejor bien iluminadas, sin personas y con las verticales derechas.",
  ],
  [
    "¿Cuánto tarda?",
    "Unos minutos por foto. Podés cerrar la pestaña: el resultado queda guardado en tu cuenta.",
  ],
  [
    "¿Cuántos estilos hay?",
    "Diez estilos, de nórdico a industrial, en ocho tipos de ambiente, incluidos monoambiente y quincho.",
  ],
];
export function Landing({
  scenes,
  trial,
}: {
  scenes: string[];
  trial: boolean;
}) {
  // No registration is required for the free generation flow.
  const cta = trial ? "Subí tu foto gratis" : "Probá el estudio";
  const ctaNote = trial
    ? "Sin registrarte · Sin tarjeta de crédito"
    : "Explorá ejemplos sin registrarte";
  const has = (room: string, style: string) =>
    scenes.includes(`${room}-${style === "original" ? "before" : style}`);
  // Only rooms with an empty photo and at least one staged version are shown.
  const heroRooms = exampleRooms.filter(
    (r) => has(r, "original") && exampleStyles.some((s) => has(r, s)),
  );
  const optionsFor = (room: string) =>
    ["original", ...exampleStyles].filter((s) => has(room, s));
  const [room, setRoom] = useState<string>(heroRooms[0] || "living");
  const [style, setStyle] = useState("modern");
  const [scene, setScene] = useState<string>(heroRooms[1] || room);
  const [sceneStyle, setSceneStyle] = useState("original");
  const [uploading, setUploading] = useState(false);
  const [faq, setFaq] = useState<number | null>(0);
  const heroStyle = has(room, style) ? style : optionsFor(room)[1];
  return (
    <>
      <section className="hero">
        {uploading ? (
          <div className="container">
            <Studio embedded onClose={() => setUploading(false)} />
          </div>
        ) : (
          <div className="container hero-grid">
            <div className="hero-copy">
              <div className="eyebrow-pill">
                <span className="live-dot" /> HECHO PARA INMOBILIARIAS DE
                ARGENTINA
              </div>
              <h1>Amoblamiento virtual con un clic</h1>
              <p>Subí una foto y nuestra IA le suma muebles en minutos.</p>
              <button
                className="button button-primary button-large"
                onClick={() => setUploading(true)}
              >
                {cta} <ArrowUpRight size={20} />
              </button>
              <div className="hero-micro">{ctaNote}</div>
            </div>
            <div className="hero-visual">
              <div className="hero-stage">
                <img
                  key={`${room}-${heroStyle}`}
                  src={examplePath(room, heroStyle)}
                  alt={`${roomName(room)}, ${styleName(heroStyle)}`}
                />
                <label className="stage-select stage-room">
                  <span className="visually-hidden">Ambiente</span>
                  <select
                    value={room}
                    onChange={(e) => setRoom(e.target.value)}
                  >
                    {heroRooms.map((r) => (
                      <option key={r} value={r}>
                        {roomName(r)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="stage-select stage-style">
                  <span className="visually-hidden">Estilo</span>
                  <select
                    value={heroStyle}
                    onChange={(e) => setStyle(e.target.value)}
                  >
                    {optionsFor(room).map((s) => (
                      <option key={s} value={s}>
                        {styleName(s)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="image-caption">
                Escenas ilustrativas creadas con IA.
              </p>
            </div>
          </div>
        )}
        <div className="container highlights">
          {highlights.map((h) => (
            <span key={h}>
              <Check size={16} /> {h}
            </span>
          ))}
        </div>
      </section>
      <section className="section showcase">
        <div className="container showcase-layout">
          <div>
            <span className="eyebrow">GALERÍA</span>
            <h2>
              Mirá la transformación:
              <br />
              <span>antes y después.</span>
            </h2>
            <p>
              Ambientes vacíos que pasan a estar listos para publicar, en
              minutos.
            </p>
            <Link href="/galeria" className="button button-outline">
              Ver galería
            </Link>
          </div>
          <div>
            <div className="showcase-stage">
              <img
                key={`${scene}-${sceneStyle}`}
                src={examplePath(scene, sceneStyle)}
                alt={`${roomName(scene)}, ${styleName(sceneStyle)}`}
                loading="lazy"
              />
              <span className="showcase-tag">{roomName(scene)}</span>
              <div className="showcase-tabs">
                {optionsFor(scene).map((s) => (
                  <button
                    key={s}
                    className={s === sceneStyle ? "selected" : ""}
                    onClick={() => setSceneStyle(s)}
                  >
                    {styleName(s)}
                  </button>
                ))}
              </div>
            </div>
            <div className="showcase-thumbs">
              {heroRooms.map((r) => (
                <button
                  key={r}
                  className={r === scene ? "selected" : ""}
                  onClick={() => {
                    setScene(r);
                    setSceneStyle("original");
                  }}
                  aria-label={roomName(r)}
                >
                  <img src={examplePath(r, "original")} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
      <section className="section impact">
        <div className="container impact-grid">
          {[
            [
              Eye,
              "Más interés",
              "Los compradores se imaginan viviendo ahí desde la primera foto.",
            ],
            [
              Clock,
              "Se entiende de un vistazo",
              "Escala, uso y circulación de cada ambiente, sin que nadie tenga que adivinar.",
            ],
            [
              Star,
              "Tu publicación se destaca",
              "Ambientes con vida entre listados de cuartos vacíos.",
            ],
          ].map(([Icon, title, text]) => {
            const I = Icon as typeof Eye;
            return (
              <article key={title as string}>
                <h3>
                  {title as string} <I size={18} />
                </h3>
                <p>{text as string}</p>
              </article>
            );
          })}
        </div>
      </section>
      <section className="section">
        <div className="container simple-block">
          <div>
            <span className="eyebrow">STAGING SIMPLE</span>
            <h2>
              Vendé con ambientes
              <br />
              <span>listos para habitar.</span>
            </h2>
            <Link
              href="/estudio"
              className="button button-primary button-large"
            >
              {cta} <ArrowUpRight size={20} />
            </Link>
            <small>{ctaNote}</small>
          </div>
          <div className="simple-cards">
            {[
              [
                MousePointerClick,
                "Fácil de usar",
                "Sacá los muebles que sobran y sumá los nuevos con un clic.",
              ],
              [
                Timer,
                "Listo en minutos",
                "Sin esperar días a un diseñador ni coordinar entregas.",
              ],
              [
                Wallet,
                "Precio accesible",
                "Planes mensuales en pesos, por una fracción de lo que cuesta un render tradicional.",
              ],
              [
                RefreshCw,
                "Regeneraciones incluidas",
                "Probá nuevas propuestas sobre la misma foto durante tu período pago, sin consumir otro original.",
              ],
            ].map(([Icon, title, text]) => {
              const I = Icon as typeof Eye;
              return (
                <article key={title as string}>
                  <I size={22} />
                  <h3>{title as string}</h3>
                  <p>{text as string}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>
      <section className="section" id="como-funciona">
        <div className="container">
          <div className="center-heading">
            <span className="eyebrow">CÓMO FUNCIONA</span>
            <h2>
              Fotos listas para publicar,
              <br />
              <span>en tres pasos.</span>
            </h2>
          </div>
          <div className="step-cards">
            {[
              [
                "Subí tu foto",
                "Sirven ambientes vacíos o amoblados.",
                "JPG, PNG o WebP",
              ],
              [
                "La IA lo amobla",
                "Elegí ambiente y estilo; el resto lo hace la IA.",
                "Amoblando…",
              ],
              [
                "Descargá y publicá",
                "Bajá la imagen y usala en tus portales y redes.",
                "Lista para publicar",
              ],
            ].map(([title, text, chip], i) => (
              <article key={title}>
                <h3>
                  {title} <span>{i + 1}</span>
                </h3>
                <p>{text}</p>
                <small>{chip}</small>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section className="section compare-section">
        <div className="container">
          <div className="center-heading">
            <span className="eyebrow">POR QUÉ AMOBLAIA</span>
            <h2>
              La diferencia,
              <br />
              <span>punto por punto.</span>
            </h2>
          </div>
          <div className="compare">
            <div className="compare-us">
              <h3>amoblaIA</h3>
              <ul>
                {[
                  ["Rápido", "listo en minutos"],
                  ["Simple", "subís, elegís y listo"],
                  ["Accesible", "planes mensuales en pesos"],
                  ["Flexible", "regeneraciones incluidas"],
                  ["Fiel", "respeta la arquitectura de la foto"],
                  ["Transparente", "etiqueta de amoblamiento virtual"],
                ].map(([b, t]) => (
                  <li key={b}>
                    <Check size={17} />
                    <span>
                      <strong>{b}:</strong> {t}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <span className="compare-vs">VS</span>
            <div className="compare-them">
              <h3>Render tradicional</h3>
              <ul>
                {[
                  ["Lento", "varios días de espera"],
                  ["Engorroso", "idas y vueltas con instrucciones"],
                  ["Caro", "pagás cada imagen por separado"],
                  ["Rígido", "pocas revisiones incluidas"],
                  ["Variable", "depende de cada diseñador"],
                  ["Excesivo", "a veces cambia más de lo pedido"],
                ].map(([b, t]) => (
                  <li key={b}>
                    <X size={17} />
                    <span>
                      <strong>{b}:</strong> {t}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>
      <section className="section faq-section" id="preguntas">
        <div className="container faq-layout">
          <div>
            <span className="eyebrow">PREGUNTAS FRECUENTES</span>
            <h2>
              ¿Tenés dudas?
              <br />
              <span>Te respondemos.</span>
            </h2>
          </div>
          <div className="faq-list">
            {faqs.map(([q, a], i) => (
              <div className={`faq-item ${faq === i ? "open" : ""}`} key={q}>
                <h3>
                  <button
                    onClick={() => setFaq(faq === i ? null : i)}
                    aria-expanded={faq === i}
                    aria-controls={`faq-${i}`}
                  >
                    {q}
                    {faq === i ? <Minus size={18} /> : <Plus size={18} />}
                  </button>
                </h3>
                <div id={`faq-${i}`} hidden={faq !== i}>
                  <p>{a}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="cta-section">
        <div className="container cta-layout">
          <div>
            <span className="eyebrow">EMPEZÁ HOY</span>
            <h2>
              Tu propiedad tiene potencial.
              <br />
              <span>Hagamos que se vea.</span>
            </h2>
            <Link href="/estudio" className="button button-light button-large">
              {cta} <ArrowUpRight size={21} />
            </Link>
            <p>{ctaNote}</p>
          </div>
          <div className="cta-includes">
            <strong>Incluye</strong>
            {highlights.map((h) => (
              <span key={h}>
                <Check size={16} /> {h}
              </span>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
