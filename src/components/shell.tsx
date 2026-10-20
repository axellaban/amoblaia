"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ContactForm } from "./contact-form";
import { ArrowUpRight, Menu, X } from "lucide-react";
/** Brand mark: an arched doorway with a bench inside, plus the spark of AI. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true" className={className}>
      <rect width="40" height="40" rx="11" fill="#3c59bf" />
      <g
        fill="none"
        stroke="#fbf1e8"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 31V19a8 8 0 0 1 16 0v12M8.5 31h23" />
        <path d="M15.5 27.5v-2A1.5 1.5 0 0 1 17 24h6a1.5 1.5 0 0 1 1.5 1.5v2" />
      </g>
      <path
        d="M31.5 4.5l1.3 3.7 3.7 1.3-3.7 1.3-1.3 3.7-1.3-3.7-3.7-1.3 3.7-1.3z"
        fill="#cbff9a"
      />
    </svg>
  );
}
export function Logo() {
  return (
    <span className="logo">
      <span className="logo-icon">
        <LogoMark />
      </span>
      amobla<span className="logo-ai">IA</span>
    </span>
  );
}
export function Header() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const privatePage = ["/proyectos", "/cuenta", "/administracion"].includes(
    pathname,
  );
  return (
    <header className={`header ${privatePage ? "header-private" : ""}`}>
      <div className="container nav">
        <Link href="/" aria-label="amoblaIA, inicio">
          <Logo />
        </Link>
        <nav
          className={open ? "nav-links is-open" : "nav-links"}
          aria-label="Navegación principal"
        >
          <Link
            className={pathname === "/galeria" ? "active" : ""}
            href="/galeria"
            onClick={() => setOpen(false)}
          >
            Galería
          </Link>
          <Link href="/" onClick={() => setOpen(false)}>
            Inicio
          </Link>
          <Link
            className={pathname === "/precios" ? "active" : ""}
            href="/precios"
            onClick={() => setOpen(false)}
          >
            Precios
          </Link>
          <Link href="/blog" onClick={() => setOpen(false)}>
            Blog
          </Link>
          <Link
            className="mobile-account-nav"
            href="/cuenta"
            onClick={() => setOpen(false)}
          >
            Mi cuenta
          </Link>
        </nav>
        <div className="nav-actions">
          <Link href="/cuenta" className="account-nav">
            Mi cuenta
          </Link>
          <Link href="/estudio" className="button button-small">
            Empezar gratis <ArrowUpRight size={16} />
          </Link>
          <button
            className="menu-toggle icon-button"
            onClick={() => setOpen(!open)}
            aria-label={open ? "Cerrar menú" : "Abrir menú"}
            aria-expanded={open}
          >
            {open ? <X /> : <Menu />}
          </button>
        </div>
      </div>
    </header>
  );
}
export function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-newsletter">
          <div>
            <span className="footer-label">NOVEDADES</span>
            <h2>Sigamos en contacto</h2>
            <p>Ideas para mostrar tus propiedades y novedades de amoblaIA.</p>
          </div>
          <ContactForm kind="newsletter" compact />
        </div>
        <div className="footer-top">
          <div>
            <Link href="/">
              <Logo />
            </Link>
            <p>
              De espacio vacío a próximo hogar.
              <br />
              Virtual staging para Latinoamérica.
            </p>
          </div>
          <div>
            <span className="footer-label">EXPLORÁ</span>
            <Link href="/galeria">Galería de ambientes</Link>
            <Link href="/estudio">Estudio de diseño</Link>
            <Link href="/proyectos">Mis fotos y carpetas</Link>
            <Link href="/precios">Acceso y precios</Link>
          </div>
          <div>
            <span className="footer-label">AMOBLAIA</span>
            <Link href="/faq">Preguntas frecuentes</Link>
            <Link href="/privacidad">Privacidad</Link>
            <Link href="/terminos">Términos de uso</Link>
            <Link href="/reembolsos">Reembolsos</Link>
            <Link href="/ayuda">Soporte</Link>
            <Link href="/ayuda#arrepentimiento">Botón de arrepentimiento</Link>
            <Link href="/ayuda#baja">Botón de baja</Link>
          </div>
          <div>
            <span className="footer-label">TRABAJEMOS JUNTOS</span>
            <Link href="/afiliados">Programa de afiliados</Link>
            <Link href="/marca-blanca">Marca blanca</Link>
            <Link href="/api">Acceso API</Link>
            <Link href="/trabaja-con-nosotros">Trabajá con nosotros</Link>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} amoblaIA</span>
          <a
            href="https://www.argentina.gob.ar/produccion/defensadelconsumidor/formulario"
            target="_blank"
            rel="noopener noreferrer"
          >
            Defensa de las y los consumidores. Para reclamos ingresá acá
          </a>
        </div>
      </div>
    </footer>
  );
}
