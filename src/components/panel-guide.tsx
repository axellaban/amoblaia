"use client";
// «Cómo usar Habita en tu negocio»: the guide at the bottom of the panel's
// home. Three ways to use what the agency creates (its website, the demo
// before, during and after the visit, and its social networks) and why it
// matters, with sourced market figures. The sidebar's «¿Cómo uso Habita en mi
// negocio?» lands here (#como-usar).
import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Clapperboard,
  Eye,
  Globe,
  Image as ImageIcon,
  Layers,
  Link2,
  MessageCircle,
  MessagesSquare,
  RefreshCw,
  Send,
  Smartphone,
  Timer,
  Users,
} from "lucide-react";
import { Comparison } from "@/components/comparison";
import { cta } from "@/lib/interaction-tracking";
import { videoEnabled } from "@/lib/agency/flags";

export const GUIDE_ANCHOR = "como-usar";

const BEFORE = "/ejemplos/living-before.webp";
const STYLES = [
  { id: "calido", label: "Cálido", src: "/ejemplos/living-farmhouse.webp" },
  { id: "nordico", label: "Nórdico", src: "/ejemplos/living-scandinavian.webp" },
  { id: "industrial", label: "Industrial", src: "/ejemplos/living-industrial.webp" },
] as const;

const STATS = [
  {
    icon: Eye,
    tag: "Staging en general",
    value: "83%",
    who: "de los agentes de compradores",
    title: "Imaginarse viviendo ahí",
    text: "Dijo que el staging facilita que un comprador imagine la propiedad como su futuro hogar.",
    source: "NAR · Profile of Home Staging, 2025",
    href: "https://www.nar.realtor/research-and-statistics/research-reports/profile-of-home-staging",
  },
  {
    icon: MessagesSquare,
    tag: "Recorridos virtuales 3D",
    value: "95%",
    who: "de las personas encuestadas",
    title: "Más intención de consultar",
    text: "Dijo que tendría más probabilidades de llamar por una propiedad con un recorrido virtual 3D.",
    source: "Matterport · Real Estate",
    href: "https://matterport.com/industries/real-estate",
  },
  {
    icon: Timer,
    tag: "Staging en general",
    value: "49%",
    who: "de los agentes de vendedores",
    title: "Menor tiempo en el mercado",
    text: "Observó que el staging redujo el tiempo que la propiedad permaneció en venta.",
    source: "NAR · Profile of Home Staging, 2025",
    href: "https://www.nar.realtor/research-and-statistics/research-reports/profile-of-home-staging",
  },
];

function GuideLink({ href, id, children }: { href: string; id: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="hg-link" {...cta(`panel_guide_${id}`, "panel_home_guide", id)}>
      {children} <ArrowRight size={14} aria-hidden="true" />
    </Link>
  );
}

function GuideHead({ icon: Icon, eyebrow, title, text, id }: { icon: typeof Globe; eyebrow: string; title: string; text: string; id: string }) {
  return (
    <div className="hg-head">
      <span className="hg-head-icon" aria-hidden="true">
        <Icon size={20} />
      </span>
      <div>
        <span className="hg-eyebrow">{eyebrow}</span>
        <h3 id={id}>{title}</h3>
        <p>{text}</p>
      </div>
    </div>
  );
}

/** The demo's hero: the real before/after comparison with three styles to try. */
function DemoComparison() {
  const [style, setStyle] = useState<(typeof STYLES)[number]["id"]>("calido");
  const current = STYLES.find((s) => s.id === style)!;
  return (
    <div className="hg-demo-media">
      <Comparison before={BEFORE} after={current.src} beforeLabel="Original" afterLabel="Propuesta con IA" alt={`Ambiente estilo ${current.label}`} initial={50} />
      <div className="hg-demo-styles">
        <div role="group" aria-label="Estilos de ejemplo">
          {STYLES.map((s) => (
            <button key={s.id} type="button" className={s.id === style ? "is-on" : ""} aria-pressed={s.id === style} onClick={() => setStyle(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
        <small>Deslizá para comparar</small>
      </div>
      <p className="hg-note">Probá este ejemplo. Escena ilustrativa creada con IA.</p>
    </div>
  );
}

export function PanelGuide({ creator }: { creator: boolean }) {
  const video = videoEnabled();
  const start = creator ? "#crear" : "/panel/propiedades";
  return (
    <section className="hg" id={GUIDE_ANCHOR} aria-labelledby="hg-title">
      <header className="hg-intro">
        <span className="hg-eyebrow">Ideas para llevar a tu negocio</span>
        <h2 id="hg-title">Cómo usar Habita en tu negocio</h2>
        <p>Ayudá a tus clientes a ver lo que una propiedad puede ser. Y convertí ese primer interés en una conversación.</p>
      </header>

      {/* 1. The agency's own website. */}
      <section className="hg-block" aria-labelledby="hg-web">
        <GuideHead
          icon={Globe}
          id="hg-web"
          eyebrow="Dale vida a tu web"
          title="Transformá tu web en su futuro hogar"
          text="Ayudá a imaginar lo que una propiedad puede ser con imágenes, videos y una experiencia interactiva."
        />
        <div className="hg-card hg-web">
          <div className="hg-web-art">
            <div className="hg-browser" aria-hidden="true">
              <div className="hg-browser-bar">
                <i />
                <i />
                <i />
                <span>El sitio de tu inmobiliaria</span>
              </div>
              <div className="hg-browser-body">
                <div className="hg-browser-photo">
                  <img src="/ejemplos/living-scandinavian.webp" alt="" loading="lazy" />
                  <span>Ambientación virtual ilustrativa</span>
                </div>
                <div className="hg-browser-copy">
                  <small>Una nueva forma de recorrer</small>
                  <strong>Imaginá tu próximo hogar.</strong>
                  <span>Descubrí el potencial de cada ambiente.</span>
                  <em>
                    Explorá esta propiedad <ArrowRight size={11} />
                  </em>
                </div>
              </div>
            </div>
            <ol className="hg-steps">
              <li>Subí o importá tus fotos</li>
              <li>Editá y ambientá</li>
              <li>Llevá el resultado a tu web</li>
            </ol>
          </div>
          <div className="hg-web-list">
            <p className="hg-lead">Subí tus fotos o importá una propiedad desde el enlace de su publicación. Prepará el contenido en Habita y elegí cómo llevarlo a tu sitio.</p>
            <ul>
              <li>
                <ImageIcon size={18} aria-hidden="true" />
                <div>
                  <h4>Imágenes que muestran posibilidades</h4>
                  <p>Editá y ambientá tus fotos, descargalas y subilas desde el gestor de tu web. Mostralas junto a las originales e identificá la ambientación con IA.</p>
                  <GuideLink href="/panel/imagenes" id="image_studio">
                    Preparar mis imágenes
                  </GuideLink>
                </div>
              </li>
              {video && (
                <li>
                  <Clapperboard size={18} aria-hidden="true" />
                  <div>
                    <h4>Videos para recorrer la propiedad</h4>
                    <p>Creá un video con tus fotos y descargalo en MP4. Subilo a la publicación o sumalo desde un reproductor, según las opciones de tu web.</p>
                    <GuideLink href="/panel/video" id="video_section">
                      Crear un video
                    </GuideLink>
                  </div>
                </li>
              )}
              <li>
                <Layers size={18} aria-hidden="true" />
                <div>
                  <h4>Un botón para explorar su futuro hogar</h4>
                  <p>
                    Publicá la ficha y enlazala desde un botón como «Explorá esta propiedad». Tu visitante abre la demo, compara el antes y después y descubre distintos estilos.
                  </p>
                  <GuideLink href={start} id="property_editor">
                    Preparar mi experiencia
                  </GuideLink>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* 2. The demo, before, during and after the visit. */}
      <section className="hg-block" aria-labelledby="hg-demo">
        <GuideHead
          icon={Layers}
          id="hg-demo"
          eyebrow="Una demo. Tres momentos para conectar."
          title="Compartí la demo con tus potenciales compradores"
          text="Antes, durante y después de la visita: una misma experiencia para imaginar el hogar, compartir ideas y seguir conversando."
        />
        <div className="hg-card hg-demo">
          <div className="hg-demo-copy">
            <span className="hg-kicker">
              <Link2 size={14} aria-hidden="true" /> Una propiedad para imaginar juntos
            </span>
            <h4>Que puedan verla. Imaginarla. Volver a recorrerla.</h4>
            <p>
              Reuní las fotos y propuestas ambientadas en una ficha interactiva. Tu cliente puede comparar el antes y después, explorar estilos y compartir el enlace con quienes participan de la
              decisión.
            </p>
            <Link href={start} className="button button-primary hg-demo-go" {...cta("panel_guide_demo", "panel_home_guide", "property_editor")}>
              Crear mi demo interactiva <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
          <DemoComparison />
        </div>

        <ol className="hg-moments">
          <li className="hg-moment">
            <div className="hg-moment-art is-chat" aria-hidden="true">
              <span className="hg-chip">
                <MessageCircle size={12} /> Una propiedad para imaginar juntos
              </span>
              <div className="hg-bubble is-card">
                <img src="/ejemplos/living-scandinavian.webp" alt="" loading="lazy" />
                <span className="hg-bubble-tag">
                  <Layers size={10} /> Demo interactiva
                </span>
                <strong>¿Y si tu próximo hogar se viera así?</strong>
                <small>Explorá los ambientes y probá distintos estilos.</small>
                <Check size={12} className="hg-bubble-check" />
              </div>
              <div className="hg-bubble is-in">Se lo paso a mi pareja y lo vemos juntos.</div>
            </div>
            <span className="hg-moment-tag">
              <Send size={14} aria-hidden="true" /> 1 · Antes de la visita
            </span>
            <h4>Compartí algo que quieran reenviar</h4>
            <p>Enviá la demo por WhatsApp o email. Que la recorran con su pareja o familia y lleguen a la visita con ideas, favoritos y preguntas.</p>
          </li>
          <li className="hg-moment">
            <div className="hg-moment-art is-visit" aria-hidden="true">
              <img src={BEFORE} alt="" loading="lazy" />
              <div className="hg-phone">
                <img src="/ejemplos/living-farmhouse.webp" alt="" loading="lazy" />
                <strong>Del espacio vacío a tu próximo hogar.</strong>
              </div>
              <span className="hg-caption">
                <Smartphone size={12} /> Mostrala mientras recorren el ambiente
              </span>
            </div>
            <span className="hg-moment-tag">
              <Users size={14} aria-hidden="true" /> 2 · Durante la visita
            </span>
            <h4>Ayudá a imaginar, ahí mismo</h4>
            <p>Abrí la demo en el celular o la tablet frente al ambiente real. Mostrá las posibilidades y conversá sobre cómo les gustaría vivir ese espacio.</p>
          </li>
          <li className="hg-moment">
            <div className="hg-moment-art is-chat is-sand" aria-hidden="true">
              <span className="hg-chip is-center">Después de la visita</span>
              <div className="hg-bubble is-out">
                <div className="hg-bubble-row">
                  <img src="/ejemplos/living-industrial.webp" alt="" loading="lazy" />
                  <span>
                    <strong>El living que vimos hoy</strong>
                    <small>Y otras propuestas</small>
                  </span>
                </div>
                Te comparto cómo podría quedar. ¿Qué estilo te gustó más?
              </div>
              <div className="hg-bubble is-in">¡Así lo puedo imaginar mucho mejor! ¿Podemos volver a verlo?</div>
            </div>
            <span className="hg-moment-tag">
              <RefreshCw size={14} aria-hidden="true" /> 3 · Después de la visita
            </span>
            <h4>Retomá la conversación con una idea</h4>
            <p>Volvé a enviar el ambiente que más les interesó. Preguntá qué estilo les gustó y proponé el próximo paso: otra visita o una nueva conversación.</p>
          </li>
        </ol>
      </section>

      {/* 3. Social networks. */}
      <section className="hg-block" aria-labelledby="hg-social">
        <GuideHead
          icon={Send}
          id="hg-social"
          eyebrow="En tus redes sociales"
          title="Expandí tu audiencia"
          text="Compartí con tu audiencia fotos y videos que inviten a imaginar. Convertí el contenido de tus propiedades en nuevos motivos para descubrirlas y consultar."
        />
        <ul className={`hg-social ${video ? "" : "is-single"}`}>
          <li className="hg-social-card">
            <div className="hg-social-art" aria-hidden="true">
              <div className="hg-post">
                <div className="hg-post-head">
                  <span>h.</span>
                  <strong>Tu inmobiliaria</strong>
                  <small>Una propiedad · Nuevo post</small>
                </div>
                <div className="hg-post-photos">
                  <figure>
                    <img src={BEFORE} alt="" loading="lazy" />
                    <figcaption>Así es hoy</figcaption>
                  </figure>
                  <figure>
                    <img src="/ejemplos/living-farmhouse.webp" alt="" loading="lazy" />
                    <figcaption>Así podría ser</figcaption>
                  </figure>
                </div>
                <strong className="hg-post-q">¿Te imaginás viviendo acá?</strong>
              </div>
              <small>Antes y después · Carrusel · Historias</small>
            </div>
            <span className="hg-moment-tag">
              <ImageIcon size={14} aria-hidden="true" /> Imágenes para tus redes
            </span>
            <h4>Fotos para inspirar y compartir</h4>
            <p>Subí o importá tus fotos, editalas y ambientalas. Descargá las imágenes y armá un antes y después, un carrusel con distintos estilos o una historia con una pregunta: «¿Cuál elegirías?».</p>
            <GuideLink href="/panel/imagenes" id="image_studio">
              Crear mis imágenes
            </GuideLink>
          </li>
          {video && (
            <li className="hg-social-card">
              <div className="hg-social-art is-video" aria-hidden="true">
                <div className="hg-reel">
                  <img src="/ejemplos/living-scandinavian.webp" alt="" loading="lazy" />
                  <span className="hg-reel-brand">habita.</span>
                  <strong>Tu próximo hogar empieza con una idea.</strong>
                </div>
                <div className="hg-reel-copy">
                  <Clapperboard size={18} />
                  <strong>De tus fotos a un video para compartir.</strong>
                  <small>Vertical para reels y stories</small>
                  <div className="hg-reel-thumbs">
                    <img src={BEFORE} alt="" loading="lazy" />
                    <img src="/ejemplos/living-farmhouse.webp" alt="" loading="lazy" />
                    <img src="/ejemplos/living-industrial.webp" alt="" loading="lazy" />
                  </div>
                  <small>9:16 · Descarga MP4</small>
                </div>
              </div>
              <span className="hg-moment-tag">
                <Clapperboard size={14} aria-hidden="true" /> Videos para tus redes
              </span>
              <h4>Videos para llegar a más personas</h4>
              <p>Creá recorridos con tus fotos, movimiento y transiciones. Elegí el formato, exportá el MP4 y compartilo en Reels, Stories o publicaciones con una invitación a conocer la propiedad.</p>
              <GuideLink href="/panel/video" id="video_section">
                Crear un video
              </GuideLink>
            </li>
          )}
        </ul>
        <p className="hg-tip">
          <Link2 size={15} aria-hidden="true" />
          <span>
            <strong>Cerrá cada publicación con un próximo paso:</strong> «Explorá esta propiedad», «Pedime la demo» o «Coordinemos una visita».
          </span>
        </p>
        <p className="hg-tip">
          <ImageIcon size={15} aria-hidden="true" />
          <span>
            <strong>Mostrá el potencial con transparencia.</strong> Conservá la foto original, identificá las ambientaciones con IA como ilustrativas y revisá cada resultado antes de compartir. Las vistas
            de arriba son ejemplos de uso.
          </span>
        </p>
      </section>

      {/* 4. Why it matters. */}
      <section className="hg-why" aria-labelledby="hg-why">
        <span className="hg-eyebrow">Presentar mejor abre oportunidades</span>
        <h3 id="hg-why">Por qué es importante para tu negocio</h3>
        <p className="hg-why-lead">Ayudar a visualizar, despertar consultas y acompañar la venta: tres indicadores de referencia del mercado inmobiliario.</p>
        <ul className="hg-stats">
          {STATS.map(({ icon: Icon, tag, value, who, title, text, source, href }) => (
            <li key={value}>
              <span className="hg-stat-tag">
                <span aria-hidden="true">
                  <Icon size={16} />
                </span>
                {tag}
              </span>
              <strong className="hg-stat-value">{value}</strong>
              <small className="hg-stat-who">{who}</small>
              <h4>{title}</h4>
              <p>{text}</p>
              <a href={href} target="_blank" rel="noopener noreferrer" className="hg-stat-source">
                {source} <ArrowUpRight size={13} aria-hidden="true" />
              </a>
            </li>
          ))}
        </ul>
        <p className="hg-why-note">
          NAR es la asociación estadounidense de agentes inmobiliarios; Matterport es una empresa de recorridos 3D. Las cifras reflejan respuestas sobre staging en general y recorridos 3D,
          respectivamente. No son mediciones de Habita ni estudios específicos de ambientación con IA. El 95% expresa intención de consultar, no un aumento del 95% en llamadas.
        </p>
      </section>
    </section>
  );
}
