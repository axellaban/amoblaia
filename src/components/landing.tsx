"use client";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Studio } from "./studio";
import { StagePicker } from "./stage-picker";
import {
  ArrowUp,
  Check,
  ChevronDown,
  CircleHelp,
  Clock,
  Image as ImageIcon,
  MousePointerClick,
  RefreshCw,
  Rocket,
  Settings,
  Sofa,
  Sparkles,
  Target,
  Upload,
  Wallet,
  WandSparkles,
  X,
} from "lucide-react";
import { rooms, styles } from "@/lib/catalog";
import { exampleRooms, exampleStyles, examplePath } from "@/lib/examples";

// Layout and copy follow the reference landing section by section; figures
// (minutes, ten styles, prices in pesos) are amoblaIA's own.
const STARTING_PRICE = "$20.000"; // Inicial, monthly: keep in sync with the products table.
const roomName = (id: string) => rooms.find((r) => r.id === id)?.name || id;
const styleName = (id: string) =>
  id === "original" ? "Original" : styles.find((s) => s.id === id)?.name || id;
const highlights = [
  "Bajo costo",
  "Resultados en minutos",
  "Retiro de muebles",
  "10 estilos de diseño",
  "8 tipos de ambientes",
];
const faqs: [string, ReactNode][] = [
  [
    "¿Qué es el amoblamiento virtual?",
    <>
      <p>
        El amoblamiento virtual (virtual staging) es un método económico para
        que los agentes inmobiliarios hagan que las propiedades resulten más
        atractivas para los posibles compradores. En lugar de usar técnicas
        tradicionales de ambientación, en las que los muebles y la decoración se
        llevan y se acomodan físicamente, se usa tecnología digital para agregar
        muebles, decoración y otros elementos de diseño a un ambiente. Esto se
        hace mediante software, creando una representación virtual de un espacio
        totalmente amoblado y decorado.
      </p>
      <p>
        Con el amoblamiento virtual, los agentes inmobiliarios pueden aumentar
        el valor percibido de una propiedad y hacerla más atractiva para los
        posibles compradores, mostrándoles cómo podría verse el espacio
        totalmente amoblado y decorado.
      </p>
      <p>
        Además, el amoblamiento virtual puede ayudar a que las propiedades se
        destaquen en los portales inmobiliarios, con imágenes atractivas que
        ayudan a los compradores a imaginarse viviendo en ese espacio.
      </p>
    </>,
  ],
  [
    "¿Por qué elegir amoblamiento virtual en lugar de amoblamiento físico?",
    <>
      <p>
        Las ventajas del amoblamiento virtual en cuanto a ahorro de costos son
        bastante claras. Al eliminar la necesidad de comprar muebles, contratar
        decoradores, trasladar la decoración y dedicar tiempo a ambientar una
        casa, el amoblamiento virtual puede reducir significativamente los
        costos en comparación con la ambientación tradicional.
      </p>
      <p>
        Además, las opciones de amoblamiento virtual son más flexibles que los
        métodos tradicionales. No hay límites en los estilos de muebles que se
        pueden agregar, porque los muebles virtuales no dependen de un depósito
        ni de un flete. Esto permite una variedad mucho más amplia de opciones.
      </p>
    </>,
  ],
  [
    "¿Qué es el amoblamiento virtual con IA?",
    <>
      <p>
        El amoblamiento virtual con IA es cuando una inteligencia artificial
        agrega muebles a una foto automáticamente, en lugar de un diseñador.
        amoblaIA puede agregar muebles atractivos y realistas, con iluminación
        natural, a la foto de un ambiente, respetando paredes, aberturas, pisos
        y perspectiva.
      </p>
      <p>
        Al mismo tiempo, el amoblamiento virtual con IA es mucho más rápido que
        el que hace un diseñador: reduce la espera de días a minutos y baja
        mucho el costo de cada imagen. Revisá siempre el resultado antes de
        publicarlo.
      </p>
    </>,
  ],
  [
    "¿Qué tipo de fotos aceptan?",
    <p>
      Actualmente amoblamos livings, dormitorios, comedores, cocinas, home
      offices, patios y balcones, monoambientes y quinchos. Ofrecemos diez
      estilos de muebles para elegir. Si el ambiente ya tiene muebles u objetos,
      podemos vaciarlo o reemplazar los muebles existentes por otros nuevos.
      Aceptamos fotos JPG, PNG o WebP de hasta 10 MB.
    </p>,
  ],
  [
    "¿Cuánto tarda el amoblamiento virtual con IA?",
    <p>
      Procesar la imagen y generar la versión amoblada lleva unos minutos. Podés
      cerrar la pestaña: el resultado queda guardado.
    </p>,
  ],
  [
    "¿Qué tan grande es su catálogo de muebles?",
    <p>
      Nuestro amoblamiento virtual con IA no trabaja con un catálogo de muebles
      predefinido. Analiza cada ambiente y, según el estilo y el tipo de
      ambiente, genera los muebles que mejor se adaptan. Por eso, dos ambientes
      nunca van a tener los mismos muebles.
    </p>,
  ],
];

function Eyebrow({
  icon: Icon,
  children,
}: {
  icon: typeof Check;
  children: ReactNode;
}) {
  return (
    <div className="hx-eyebrow">
      <span>
        <Icon size={18} />
      </span>
      {children}
    </div>
  );
}

export function Landing({
  scenes,
  trial,
}: {
  scenes: string[];
  trial: boolean;
}) {
  // No registration is required for the free generation flow.
  const has = (room: string, style: string) =>
    scenes.includes(`${room}-${style === "original" ? "before" : style}`);
  // Only rooms with an empty photo and at least one staged version are shown.
  const sceneRooms = exampleRooms.filter(
    (r) => has(r, "original") && exampleStyles.some((s) => has(r, s)),
  );
  const optionsFor = (room: string) =>
    ["original", ...exampleStyles].filter((s) => has(room, s));
  const [room, setRoom] = useState<string>(
    sceneRooms.includes("bedroom") ? "bedroom" : sceneRooms[0] || "living",
  );
  const [style, setStyle] = useState("midcentury");
  const [scene, setScene] = useState<string>(sceneRooms[0] || room);
  const [sceneStyle, setSceneStyle] = useState("original");
  const [uploading, setUploading] = useState(false);
  const [faq, setFaq] = useState<number | null>(null);
  const heroStyle = has(room, style) ? style : optionsFor(room)[1];
  const stepRoom = has("living", "modern") ? "living" : sceneRooms[0];

  const upload = (
    <>
      {trial ? (
        <span>
          Subí una imagen <b>gratis</b>
        </span>
      ) : (
        <span>Probá el estudio</span>
      )}
      <Upload size={17} />
    </>
  );
  const note = trial
    ? "Sin registro | Sin tarjeta de crédito"
    : "Explorá ejemplos sin registrarte";
  const ctaBlock = (className = "") => (
    <div className={`hx-cta ${className}`}>
      <Link href="/estudio" className="hx-button">
        {upload}
      </Link>
      <span>{note}</span>
    </div>
  );

  return (
    <div className="hx">
      <section className="hx-hero">
        {uploading ? (
          <div className="hx-container">
            <Studio embedded onClose={() => setUploading(false)} />
          </div>
        ) : (
          <div className="hx-container hx-hero-grid">
            <div>
              <p className="hx-badge">
                Hecho para <b>inmobiliarias de Argentina</b>
              </p>
              <h1>Amoblamiento virtual con un clic</h1>
              <h2>
                Subí una foto y nuestra IA <b>agregará muebles en minutos.</b>
              </h2>
              <div className="hx-cta">
                <button
                  className="hx-button"
                  onClick={() =>
                    trial ? setUploading(true) : location.assign("/estudio")
                  }
                >
                  {upload}
                </button>
                <span>{note}</span>
              </div>
            </div>
            <div className="hx-hero-stage">
              <img
                key={`${room}-${heroStyle}`}
                src={examplePath(room, heroStyle)}
                alt={`${roomName(room)}, ${styleName(heroStyle)}`}
              />
              <StagePicker
                className="stage-room"
                label="Ambiente"
                value={room}
                onChange={setRoom}
                options={sceneRooms.map((r) => ({
                  value: r,
                  label: roomName(r),
                }))}
              />
              <StagePicker
                className="stage-style"
                label="Estilo"
                value={heroStyle}
                onChange={setStyle}
                options={optionsFor(room).map((s) => ({
                  value: s,
                  label: styleName(s),
                }))}
              />
            </div>
          </div>
        )}
        <div className="hx-container hx-highlights">
          {highlights.map((h) => (
            <span key={h}>
              <Check size={18} /> {h}
            </span>
          ))}
        </div>
      </section>

      <div className="hx-body">
        <section className="hx-container hx-gallery">
          <div className="hx-gallery-copy">
            <Eyebrow icon={ImageIcon}>Galería</Eyebrow>
            <h2>
              <b>Mirá la transformación:</b> galería de antes y después
            </h2>
            <p>
              Mirá cómo amoblaIA transforma espacios poco atractivos en
              propiedades atractivas y <b>listas para publicar en minutos.</b>
            </p>
            <Link href="/galeria" className="hx-button-outline">
              Ver galería
            </Link>
          </div>
          <div className="hx-gallery-view">
            <div className="hx-gallery-stage">
              <img
                key={`${scene}-${sceneStyle}`}
                src={examplePath(scene, sceneStyle)}
                alt={`${roomName(scene)}, ${styleName(sceneStyle)}`}
                loading="lazy"
              />
              <span className="hx-room-tag">{roomName(scene)}</span>
              <div className="hx-style-tabs">
                {optionsFor(scene).map((s) => (
                  <button
                    key={s}
                    className={s === sceneStyle ? "selected" : ""}
                    aria-pressed={s === sceneStyle}
                    onClick={() => setSceneStyle(s)}
                  >
                    {styleName(s)}
                  </button>
                ))}
              </div>
              <StagePicker
                className="hx-style-picker"
                label="Estilo"
                value={sceneStyle}
                onChange={setSceneStyle}
                options={optionsFor(scene).map((s) => ({
                  value: s,
                  label: styleName(s),
                }))}
              />
            </div>
            <div className="hx-thumbs">
              {sceneRooms.map((r) => (
                <button
                  key={r}
                  className={r === scene ? "selected" : ""}
                  onClick={() => {
                    setScene(r);
                    setSceneStyle("original");
                  }}
                  aria-label={roomName(r)}
                  aria-pressed={r === scene}
                >
                  <img src={examplePath(r, "original")} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="hx-container hx-stats">
          {[
            [
              "Interés de compradores",
              <>
                <b>El 83 % de los agentes de compradores</b> cree que ambientar
                una vivienda ayuda a que los compradores la imaginen como su
                futuro hogar.
              </>,
            ],
            [
              "Ventas más rápidas",
              <>
                Las viviendas ambientadas <b>se venden más rápido</b> que las
                que no lo están.
              </>,
            ],
            [
              "Mejores ofertas",
              <>
                Las viviendas con amoblamiento virtual{" "}
                <b>se venden a un precio mayor</b> en promedio.
              </>,
            ],
          ].map(([title, text]) => (
            <article key={title as string}>
              <h3>
                {title}
                <span>
                  <ArrowUp size={16} />
                </span>
              </h3>
              <p>{text}</p>
            </article>
          ))}
        </section>

        <section className="hx-container-wide">
          <div className="hx-dark-box hx-simplified">
            <div className="hx-simplified-copy">
              <div className="hx-heading">
                <Eyebrow icon={Sofa}>Amoblamiento simplificado</Eyebrow>
                <h2>
                  Vendé sin esfuerzo con <b>amoblamiento con IA</b>
                </h2>
              </div>
              {ctaBlock("hx-desktop")}
            </div>
            <div className="hx-feature-grid">
              {[
                [
                  MousePointerClick,
                  "Fácil de usar",
                  <>
                    Quitá los muebles existentes y agregá muebles nuevos{" "}
                    <b>con un solo clic.</b>
                  </>,
                ],
                [
                  Clock,
                  "Resultados rápidos",
                  <>
                    Obtené tus fotos listas para publicar en{" "}
                    <b>solo unos minutos.</b> Sin esperar más a los diseñadores.
                  </>,
                ],
                [
                  Wallet,
                  "Precio bajo",
                  <>
                    Desde <b>solo {STARTING_PRICE} por mes</b> podés amoblar
                    virtualmente 6 imágenes. Es más barato de lo que la mayoría
                    de las agencias cobra por una sola imagen.
                  </>,
                ],
                [
                  RefreshCw,
                  "Regeneraciones ilimitadas",
                  <>
                    ¿Tenías otra idea en mente? En lugar de ir y venir con un
                    diseñador,{" "}
                    <b>obtené más diseños en minutos sin costo adicional.</b>
                  </>,
                ],
              ].map(([Icon, title, text]) => {
                const I = Icon as typeof Check;
                return (
                  <article key={title as string}>
                    <I size={26} />
                    <h3>{title as string}</h3>
                    <p>{text as ReactNode}</p>
                  </article>
                );
              })}
            </div>
            {ctaBlock("hx-mobile")}
          </div>
        </section>

        <section className="hx-container hx-steps-section">
          <div className="hx-center">
            <Eyebrow icon={Settings}>Cómo funciona</Eyebrow>
            <h2>
              Resultados listos para publicar <b>en minutos</b>
            </h2>
            <p>
              Seguí <b>tres simples pasos</b> para convertir las fotos de tu
              propiedad en imágenes impactantes que atraigan compradores y hagan
              que tus publicaciones se destaquen
            </p>
          </div>
          <div className="hx-steps">
            {[
              [
                "Subí tu imagen",
                "Aceptamos fotos amobladas y sin amoblar.",
                "original",
              ],
              [
                "Magia de IA",
                "Nuestra IA rediseña tu espacio en minutos.",
                "original",
              ],
              [
                "Descargá y destacá",
                "Descargá la foto amoblada y usala donde quieras.",
                "modern",
              ],
            ].map(([title, text, s], i) => (
              <article key={title}>
                <div className="hx-step-head">
                  <h3>{title}</h3>
                  <span>{i + 1}</span>
                </div>
                <p>{text}</p>
                <div className="hx-step-image">
                  <img src={examplePath(stepRoom, s)} alt="" loading="lazy" />
                  {i === 1 && (
                    <span className="hx-step-busy">
                      <WandSparkles size={18} /> Agregando muebles...
                    </span>
                  )}
                  {i === 2 && (
                    <span className="hx-step-done">
                      <Sparkles size={18} /> ¡Tus publicaciones nunca se vieron
                      tan bien!
                    </span>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="hx-container hx-why">
          <div className="hx-center">
            <Eyebrow icon={Rocket}>Cómo se destaca nuestro servicio</Eyebrow>
            <h2>
              <b>¿Por qué elegirnos?</b> La ventaja de amoblaIA
            </h2>
          </div>
          <div className="hx-compare">
            <span className="hx-vs">VS</span>
            <div className="hx-compare-us">
              <div className="hx-compare-title">
                <span>
                  <b>amobla</b>IA
                </span>
              </div>
              {[
                ["Resultados rápidos", "listos en minutos"],
                ["Amoblamiento sin esfuerzo", "simple e intuitivo"],
                ["Económico", `desde ${STARTING_PRICE} por mes`],
                ["Regeneraciones ilimitadas", "hasta que quedes conforme"],
                [
                  "IA de alta precisión",
                  "no altera la distribución del ambiente",
                ],
                ["Publicación transparente", "sin tergiversar la propiedad"],
              ].map(([b, t]) => (
                <p key={b}>
                  <Check size={20} strokeWidth={3} />
                  <span>
                    <b>{b}:</b> {t}
                  </span>
                </p>
              ))}
            </div>
            <div className="hx-compare-them">
              <div className="hx-compare-title">
                <h4>Otros</h4>
              </div>
              {[
                ["Varios días", "entrega exprés con costo extra"],
                ["Instrucciones tediosas", "lleva tiempo"],
                ["Caro", "desde US$20 por foto"],
                ["Revisiones limitadas", "tardan varios días"],
                ["Error humano", "calidad distinta cada vez"],
                ["Se exceden", "a veces cambian demasiado"],
              ].map(([b, t]) => (
                <p key={b}>
                  <X size={20} strokeWidth={3} />
                  <span>
                    <b>{b}:</b> {t}
                  </span>
                </p>
              ))}
            </div>
          </div>
        </section>

        <section className="hx-container hx-faq" id="preguntas">
          <div>
            <Eyebrow icon={CircleHelp}>Preguntas frecuentes</Eyebrow>
            <h2>
              <b>¿Tenés preguntas?</b>
              <br />
              Tenemos respuestas
            </h2>
          </div>
          <div className="hx-faq-list">
            {faqs.map(([q, a], i) => (
              <div className={faq === i ? "open" : ""} key={q}>
                <h3>
                  <button
                    onClick={() => setFaq(faq === i ? null : i)}
                    aria-expanded={faq === i}
                    aria-controls={`faq-${i}`}
                  >
                    {q}
                    <ChevronDown size={22} />
                  </button>
                </h3>
                <div id={`faq-${i}`} hidden={faq !== i}>
                  {a}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="hx-container-wide">
          <div className="hx-dark-box hx-final">
            <div className="hx-final-copy">
              <div className="hx-heading">
                <Eyebrow icon={Target}>Empezá ahora</Eyebrow>
                <h2>
                  ¿Listo para <b>transformar tus publicaciones?</b>
                </h2>
                <p>
                  Descubrí cómo nuestras soluciones de amoblamiento rápidas y
                  económicas pueden aumentar el interés de los compradores,
                  acelerar las ventas y conseguir mejores ofertas.
                  <br />
                  <br />
                  <b>
                    ¡No dejes que tus propiedades pasen desapercibidas: hacé que
                    se destaquen y se vendan más rápido!
                  </b>
                </p>
              </div>
              {ctaBlock("hx-desktop")}
            </div>
            <div className="hx-final-visual">
              <img src="/home/cierre.webp" alt="" loading="lazy" />
              <div className="hx-includes">
                <p>Incluye</p>
                {highlights.slice(0, 4).map((h) => (
                  <span key={h}>
                    <Check size={18} /> {h}
                  </span>
                ))}
              </div>
            </div>
            {ctaBlock("hx-mobile")}
          </div>
        </section>
      </div>
    </div>
  );
}
