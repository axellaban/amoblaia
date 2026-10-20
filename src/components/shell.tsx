"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ArrowUpRight, Menu, X, Armchair } from "lucide-react";
export function Logo() {
  return (
    <span className="logo">
      <span className="logo-icon">
        <Armchair size={23} strokeWidth={1.8} />
      </span>
      amobla<span className="logo-ai">IA</span>
      <span className="logo-dot">.</span>
    </span>
  );
}
export function Header() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  return (
    <header className="header">
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
          <Link href="/#como-funciona" onClick={() => setOpen(false)}>
            Cómo funciona
          </Link>
          <Link
            className={pathname === "/precios" ? "active" : ""}
            href="/precios"
            onClick={() => setOpen(false)}
          >
            Precios
          </Link>
          <Link href="/estudio?view=projects" onClick={() => setOpen(false)}>
            Mis proyectos
          </Link>
        </nav>
        <div className="nav-actions">
          <Link href="/estudio" className="button button-small">
            Ir al estudio <ArrowUpRight size={16} />
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
            <Link href="/precios">Acceso y precios</Link>
          </div>
          <div>
            <span className="footer-label">AMOBLAIA</span>
            <Link href="/#preguntas">Preguntas frecuentes</Link>
            <Link href="/privacidad">Privacidad</Link>
            <Link href="/terminos">Términos de uso</Link>
          </div>
          <div className="footer-note">
            <span className="live-dot" /> Hecho para imaginar posibilidades.
            <p>Fotos que invitan a dar el próximo paso.</p>
          </div>
        </div>
        <div className="footer-bottom">
          <span>
            © {new Date().getFullYear()} amoblaIA. Todos los derechos
            reservados.
          </span>
          <span>
            Diseñado para LATAM <span className="lime">↗</span>
          </span>
        </div>
      </div>
    </footer>
  );
}
