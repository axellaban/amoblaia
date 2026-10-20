import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Check, Sparkles, LockKeyhole } from "lucide-react";
export const metadata: Metadata = { title: "Acceso y precios" };
export default function Pricing() {
  const contact = process.env.NEXT_PUBLIC_CONTACT_URL;
  const safeContact = contact && /^https:\/\//.test(contact) ? contact : null;
  return (
    <div className="pricing-page">
      <div className="container">
        <div className="page-intro centered">
          <span className="eyebrow">EMPEZÁ POR LAS POSIBILIDADES</span>
          <h1>
            Encontrá tu espacio.
            <br />
            <span>Después, tu plan.</span>
          </h1>
          <p>
            Estamos en etapa piloto. Podés explorar la experiencia gratis
            <br />y probar la generación real con acceso del equipo.
          </p>
        </div>
        <div className="pricing-grid">
          <article className="price-card">
            <span className="price-icon">
              <Sparkles size={24} />
            </span>
            <span className="eyebrow">PARA EXPLORAR</span>
            <h2>Demo</h2>
            <div className="price">
              Gratis<span>sin tarjeta</span>
            </div>
            <p>Conocé el estudio y descubrí el potencial de tus espacios.</p>
            <ul>
              {[
                "Ejemplos precargados en 6 ambientes",
                "6 estilos de dormitorio para explorar",
                "Comparación interactiva antes y después",
                "Descarga de ejemplos en JPG",
                "Historial local de tus pruebas",
              ].map((t) => (
                <li key={t}>
                  <Check size={17} />
                  {t}
                </li>
              ))}
            </ul>
            <Link className="button button-outline" href="/estudio">
              Explorar gratis <ArrowUpRight size={18} />
            </Link>
          </article>
          <article className="price-card featured">
            <span className="price-ribbon">ACCESO ANTICIPADO</span>
            <span className="price-icon">
              <LockKeyhole size={24} />
            </span>
            <span className="eyebrow">PARA TUS PROPIEDADES</span>
            <h2>Estudio piloto</h2>
            <div className="price">
              A medida<span>acceso por invitación</span>
            </div>
            <p>Generá propuestas con IA a partir de tus propias fotografías.</p>
            <ul>
              {[
                "Fotos propias JPG, PNG y WebP",
                "Amoblar, rediseñar y retirar muebles",
                "7 estilos de decoración",
                "Motor de edición en calidad alta",
                "Indicaciones de diseño personalizadas",
                "Descargas con etiqueta de staging virtual",
              ].map((t) => (
                <li key={t}>
                  <Check size={17} />
                  {t}
                </li>
              ))}
            </ul>
            {safeContact ? (
              <a
                className="button button-lime"
                href={safeContact}
                target="_blank"
                rel="noopener noreferrer"
              >
                Consultar acceso <ArrowUpRight size={18} />
              </a>
            ) : (
              <Link className="button button-lime" href="/estudio">
                Ir al estudio piloto <ArrowUpRight size={18} />
              </Link>
            )}
          </article>
        </div>
        <div className="pricing-footnote">
          <h3>Precios claros desde el principio.</h3>
          <p>
            Este MVP no procesa pagos ni vende suscripciones. La generación real
            utiliza la API configurada por el operador y su costo se factura en
            esa cuenta. Los planes comerciales se publicarán al finalizar el
            piloto.
          </p>
        </div>
      </div>
    </div>
  );
}
