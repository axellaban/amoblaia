"use client";
import Link from "next/link";
import { useState } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  Check,
  Upload,
  Sparkles,
  Download,
  ScanLine,
  RotateCcw,
  MoveUpRight,
  Plus,
  Minus,
  ShieldCheck,
  Sofa,
  Layers,
  MousePointer2,
} from "lucide-react";
import {
  rooms,
  demoRooms,
  demoStyles,
  styles,
  afterImage,
  beforeImage,
  type RoomId,
  type StyleId,
} from "@/lib/catalog";
import { Comparison } from "./comparison";
const faqs = [
  [
    "¿Qué es el virtual staging?",
    "Es amoblar digitalmente una foto de una propiedad. Te permite mostrar cómo podría verse un espacio habitado sin trasladar muebles ni hacer una reforma.",
  ],
  [
    "¿Puedo probarlo antes de usar la IA?",
    "Sí. El estudio incluye ejemplos precargados para explorar ambientes, estilos, la comparación y las descargas sin registrarte. Están identificados como demo. Para generar con tus propias fotos necesitás iniciar sesión y tener fotos disponibles.",
  ],
  [
    "¿La IA cambia la estructura de la propiedad?",
    "El motor recibe instrucciones para conservar paredes, ventanas, pisos y perspectiva. Como toda IA generativa, puede introducir diferencias: revisá siempre el resultado y comparalo con la foto original antes de publicarlo.",
  ],
  [
    "¿Puedo cambiar o retirar los muebles existentes?",
    "Sí. Elegí Amoblar para espacios vacíos, Rediseñar para reemplazar el mobiliario o Vaciar para retirar muebles. Estas operaciones se ejecutan con IA sobre tu foto cuando tenés fotos disponibles.",
  ],
  [
    "¿Qué formatos puedo subir?",
    "Fotos JPG, PNG y WebP de hasta 10 MB. El estudio optimiza el archivo antes de enviarlo. Recomendamos fotos bien iluminadas, sin personas y con las verticales derechas.",
  ],
  [
    "¿Dónde se guardan mis proyectos?",
    "Con una cuenta, tus originales y resultados se guardan de forma privada y podés verlos en tus dispositivos. Los ejemplos demo quedan en el navegador. Al generar, enviamos la foto al proveedor de IA. Podés borrar tus proyectos desde el estudio.",
  ],
];
export function Landing() {
  const [room, setRoom] = useState<RoomId>("living");
  const [style, setStyle] = useState<StyleId>("modern");
  const [faq, setFaq] = useState<number | null>(0);
  return (
    <>
      <section className="hero">
        <div className="container hero-grid">
          <div className="hero-copy">
            <div className="eyebrow-pill">
              <span className="live-dot" /> TU PRÓXIMA PROPIEDAD, MEJOR
              PRESENTADA
            </div>
            <h1>
              No vendas un
              <br />
              espacio vacío.
              <br />
              <span>Mostrá un hogar.</span>
            </h1>
            <p>
              Amoblá tus propiedades con inteligencia artificial.
              <br className="desktop-break" /> Fotos reales. Nuevas
              posibilidades. En pocos clics.
            </p>
            <Link href="/estudio" className="button button-primary button-large">
              Amoblar mi primera foto <ArrowUpRight size={20} />
            </Link>
            <div className="hero-micro">
              <Check size={14} /> Probá los ejemplos gratis <span /> Sin tarjeta
              de crédito
            </div>
            <div className="hero-for">
              <div className="tiny-rooms">
                <img src="/ejemplos/living-modern.webp" alt="Living amoblado" />
                <img
                  src="/ejemplos/bedroom-modern.webp"
                  alt="Dormitorio amoblado"
                />
                <img
                  src="/ejemplos/living-eclectic.webp"
                  alt="Living ecléctico"
                />
              </div>
              <div>
                <strong>Pensado para quienes venden espacios.</strong>
                <span>Inmobiliarias, agentes y propietarios.</span>
              </div>
            </div>
          </div>
          <div className="hero-visual">
            <div className="visual-topline">
              <span>
                <span className="live-dot" /> DE VACÍO A INCREÍBLE
              </span>
              <span>01 / 04</span>
            </div>
            <Comparison
              before={beforeImage(room)}
              after={afterImage(room, style)}
            />
            <div className="visual-toolbar">
              <label>
                <span>AMBIENTE</span>
                <select
                  value={room}
                  onChange={(e) => setRoom(e.target.value as RoomId)}
                >
                  {rooms
                    .filter((r) =>
                      (demoRooms as readonly string[]).includes(r.id),
                    )
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                </select>
              </label>
              <div className="toolbar-divider" />
              <label>
                <span>ESTILO</span>
                <select
                  value={style}
                  onChange={(e) => setStyle(e.target.value as StyleId)}
                >
                  {styles
                    .filter((s) =>
                      (demoStyles as readonly string[]).includes(s.id),
                    )
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </select>
              </label>
              <span className="demo-caption">Ejemplo ilustrativo</span>
            </div>
            <div className="image-caption">
              <MousePointer2 size={13} /> Deslizá para ver la transformación{" "}
              <span>Tu espacio. Todo su potencial.</span>
            </div>
          </div>
        </div>
      </section>
      <div className="feature-strip">
        <div className="container">
          <span>
            <Sparkles /> Diseño fotorrealista
          </span>
          <span>
            <ScanLine /> Conservá la perspectiva
          </span>
          <span>
            <Sofa /> 10 estilos de decoración
          </span>
          <span>
            <RotateCcw /> Amoblá, rediseñá o vaciá
          </span>
        </div>
      </div>
      <section className="section gallery-teaser">
        <div className="container">
          <div className="section-header">
            <div>
              <span className="eyebrow">EL POTENCIAL ESTABA AHÍ</span>
              <h2>
                El mismo espacio.
                <br />
                <span>Otra primera impresión.</span>
              </h2>
            </div>
            <div>
              <p>
                Ayudá a tus clientes a imaginar su próximo hogar.
                <br />
                El cambio empieza con una foto.
              </p>
              <Link href="/galeria" className="text-link">
                Explorar la galería <ArrowUpRight size={18} />
              </Link>
            </div>
          </div>
          <div className="gallery-grid">
            {(["living", "bedroom"] as RoomId[]).map((r, i) => (
              <article className="gallery-card" key={r}>
                <Comparison
                  before={beforeImage(r)}
                  after={afterImage(r)}
                  compact
                />
                <div className="gallery-card-caption">
                  <div>
                    <span>0{i + 1} /</span>
                    <h3>{rooms.find((x) => x.id === r)?.name}</h3>
                  </div>
                  <span>
                    Contemporáneo cálido <ArrowUpRight size={15} />
                  </span>
                </div>
              </article>
            ))}
          </div>
          <p className="gallery-disclaimer">
            Escenas ficticias originales creadas con IA. Las imágenes de tus
            propiedades se generan individualmente.
          </p>
        </div>
      </section>
      <section className="section how-section" id="como-funciona">
        <div className="container">
          <div className="center-heading">
            <span className="eyebrow">MENOS VUELTAS. MÁS POSIBILIDADES.</span>
            <h2>
              De una foto a un hogar.
              <br />
              <span>Así de simple.</span>
            </h2>
            <p>Sin software complicado. Sin mover un solo mueble.</p>
          </div>
          <div className="steps-grid">
            {[
              {
                n: "01",
                Icon: Upload,
                title: "Subí tu espacio",
                text: "Elegí una foto de tu propiedad. Puede estar vacía o tener muebles.",
                img: "/ejemplos/living-before.webp",
              },
              {
                n: "02",
                Icon: Sparkles,
                title: "Dale tu estilo",
                text: "Elegí el ambiente y la decoración. La IA se ocupa de los detalles.",
                img: "/ejemplos/bedroom-eclectic.webp",
              },
              {
                n: "03",
                Icon: Download,
                title: "Descargá y compartí",
                text: "Compará el resultado y descargá la imagen para tu próxima publicación.",
                img: "/ejemplos/living-modern.webp",
              },
            ].map(({ n, Icon, title, text, img }) => (
              <article className="step" key={n}>
                <div className="step-image">
                  <img src={img} alt={title} loading="lazy" />
                  <span className="step-number">{n}</span>
                  <span className="step-icon">
                    <Icon size={21} />
                  </span>
                </div>
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section className="section styles-section">
        <div className="container styles-layout">
          <div className="styles-image">
            <img
              src={afterImage(
                "bedroom",
                style === "industrial" ? "modern" : style,
              )}
              alt={`Dormitorio en estilo ${styles.find((s) => s.id === style)?.name}`}
              loading="lazy"
            />
            <span className="floating-caption">
              <Sparkles size={16} /> Un espacio. Muchas formas de habitarlo.
            </span>
          </div>
          <div className="styles-copy">
            <span className="eyebrow">CADA PROPIEDAD TIENE SU ESTILO</span>
            <h2>
              Encontrá el que
              <br />
              <span>la hace brillar.</span>
            </h2>
            <p>
              Diez estilos para distintos gustos: nórdico, clásico renovado,
              industrial, ecléctico y más. Acá podés comparar dos ejemplos; con
              tu foto, elegí entre todas las opciones.
            </p>
            <div className="style-pills">
              {styles
                .filter((s) => (demoStyles as readonly string[]).includes(s.id))
                .map((s) => (
                  <button
                    key={s.id}
                    className={
                      style === s.id ? "style-pill selected" : "style-pill"
                    }
                    onClick={() => setStyle(s.id)}
                  >
                    <span style={{ background: s.color }} />
                    {s.name}
                    {style === s.id && <Check size={14} />}
                  </button>
                ))}
            </div>
            <Link href="/estudio" className="text-link">
              Encontrar mi estilo <ArrowRight size={18} />
            </Link>
          </div>
        </div>
      </section>
      <section className="section benefit-section">
        <div className="container">
          <div className="section-header">
            <div>
              <span className="eyebrow">TU PUBLICACIÓN, UN PASO ADELANTE</span>
              <h2>
                Mostrá lo que un
                <br />
                <span>plano no puede contar.</span>
              </h2>
            </div>
            <p>
              Una buena foto despierta interés.
              <br />
              Un espacio con vida ayuda a imaginar el resto.
            </p>
          </div>
          <div className="benefit-grid">
            {[
              {
                Icon: Layers,
                title: "Una foto, nuevas opciones",
                text: "Probá distintos estilos sobre la misma propiedad y guardá tus propuestas favoritas.",
              },
              {
                Icon: ShieldCheck,
                title: "La foto original, siempre a mano",
                text: "Compará cada resultado con el espacio real antes de compartirlo con tus clientes.",
              },
              {
                Icon: MoveUpRight,
                title: "Listo para tu publicación",
                text: "Descargá tus diseños en JPG. Sumá la aclaración de amoblamiento virtual al publicar.",
              },
            ].map(({ Icon, title, text }) => (
              <div className="benefit" key={title}>
                <Icon size={25} />
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="section faq-section" id="preguntas">
        <div className="container faq-layout">
          <div>
            <span className="eyebrow">ANTES DE EMPEZAR</span>
            <h2>
              Buenas preguntas.
              <br />
              <span>Respuestas claras.</span>
            </h2>
            <p>
              Todo lo que necesitás saber
              <br />
              para darle vida a tus espacios.
            </p>
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
        <div className="container">
          <span className="eyebrow">EL PRÓXIMO HOGAR EMPIEZA CON VOS</span>
          <h2>
            Tu propiedad tiene potencial.
            <br />
            <span>Hagamos que se vea.</span>
          </h2>
          <Link href="/estudio" className="button button-light button-large">
            Empezar a amoblar <ArrowUpRight size={21} />
          </Link>
          <p>Explorá los ejemplos gratis. Sin tarjeta.</p>
        </div>
      </section>
    </>
  );
}
