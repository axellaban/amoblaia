"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ContactForm } from "./contact-form";
import { Menu, X, LogOut } from "lucide-react";
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
  const privatePage =
    ["/proyectos", "/cuenta", "/administracion"].includes(pathname) ||
    pathname.startsWith("/admin/");
  // The layout is static, so the session is read here. Private pages send
  // signed-out visitors to /acceso, so they can assume one until it loads.
  const [session, setSession] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    const load = () =>
      fetch("/api/session", { cache: "no-store" })
        .then((r) => r.json())
        .then((s) => {
          if (active)
            setSession(
              s.mode === "cloud" && s.authenticated === true && !s.anonymous,
            );
        })
        .catch(() => active && setSession(false));
    void load();
    return () => {
      active = false;
    };
  }, []);
  // Escape closes the mobile menu, like any overlay.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  const signedIn = session ?? (privatePage || null);
  const studio = pathname === "/estudio";
  // Signed in, the studio is part of the app: same links as the private pages.
  const appNav = privatePage || (studio && signedIn === true);
  // The app links already include "Mi cuenta", and the studio linking to
  // itself would only reload it.
  const account = signedIn && !appNav;
  const create = signedIn && !studio;
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
            href={appNav ? "/proyectos" : "/"}
            onClick={() => setOpen(false)}
          >
            {appNav ? "Mis fotos" : "Inicio"}
          </Link>
          <Link
            className={pathname === "/galeria" ? "active" : ""}
            href="/galeria"
            onClick={() => setOpen(false)}
          >
            Galería
          </Link>
          <Link
            className={pathname === "/precios" ? "active" : ""}
            href="/precios"
            onClick={() => setOpen(false)}
          >
            Precios
          </Link>
          <Link
            href={appNav ? "/cuenta" : "/blog"}
            onClick={() => setOpen(false)}
          >
            {appNav ? "Mi cuenta" : "Blog"}
          </Link>
          {/* The header buttons are hidden on small screens. */}
          {(!signedIn || account || create) && (
            <div className="mobile-nav-actions">
              {signedIn ? (
                <>
                  {account && (
                    <Link
                      href="/cuenta"
                      className="button button-outline"
                      onClick={() => setOpen(false)}
                    >
                      Mi cuenta
                    </Link>
                  )}
                  {create && (
                    <Link
                      href="/estudio"
                      className="button button-primary"
                      onClick={() => setOpen(false)}
                    >
                      Ir al estudio
                    </Link>
                  )}
                </>
              ) : (
                <>
                  <Link
                    href="/acceso"
                    className="button button-outline"
                    onClick={() => setOpen(false)}
                  >
                    Entrar
                  </Link>
                  <Link
                    href="/acceso?modo=registro"
                    className="button button-primary"
                    onClick={() => setOpen(false)}
                  >
                    Crear cuenta
                  </Link>
                </>
              )}
            </div>
          )}
        </nav>
        <div className="nav-actions">
          {signedIn ? (
            <>
              {account && (
                <Link href="/cuenta" className="account-nav">
                  Mi cuenta
                </Link>
              )}
              {create && (
                <Link href="/estudio" className="button button-small">
                  Ir al estudio
                </Link>
              )}
            </>
          ) : (
            // Hidden while the session loads, so a signed-in visitor does
            // not see "Entrar" first.
            <>
              <Link
                href="/acceso"
                className={`account-nav ${signedIn === null ? "nav-pending" : ""}`}
              >
                Entrar
              </Link>
              <Link
                href="/acceso?modo=registro"
                className={`button button-small ${signedIn === null ? "nav-pending" : ""}`}
              >
                Crear cuenta
              </Link>
            </>
          )}
          {privatePage && (
            <button
              className="icon-button"
              aria-label="Cerrar sesión"
              onClick={async () => {
                const response = await fetch("/api/session", {
                  method: "DELETE",
                });
                if (response.ok) {
                  const { clearDraft } = await import("@/lib/studio-draft");
                  await clearDraft();
                  window.location.assign("/");
                }
              }}
            >
              <LogOut size={20} />
            </button>
          )}
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
          <span className="footer-label">Newsletter</span>
          <h2>Mantenete conectado</h2>
          <p>
            Recibí las novedades del mercado inmobiliario y de amoblaIA
            directamente en tu email.
          </p>
          <ContactForm kind="newsletter" compact />
        </div>
        <div className="footer-top">
          <div>
            <Link href="/" className="footer-brand">
              <b>amobla</b>IA
            </Link>
            <p>
              Escribinos cuando quieras desde <Link href="/ayuda">Soporte</Link>
              .
            </p>
          </div>
          <div>
            <span className="footer-label">Links rápidos</span>
            <Link href="/">Inicio</Link>
            <Link href="/galeria">Galería</Link>
            <Link href="/precios">Precios</Link>
            <Link href="/acceso">Entrar</Link>
            <Link href="/trabaja-con-nosotros">Trabajá con nosotros</Link>
            <Link href="/faq">Preguntas frecuentes</Link>
          </div>
          <div>
            <span className="footer-label">Términos y condiciones</span>
            <Link href="/terminos">Términos del servicio</Link>
            <Link href="/reembolsos">Política de reembolsos</Link>
            <Link href="/privacidad">Política de privacidad</Link>
            <Link href="/ayuda#arrepentimiento">Botón de arrepentimiento</Link>
            <Link href="/ayuda#baja">Botón de baja</Link>
          </div>
          <div>
            <span className="footer-label">Trabajá con nosotros</span>
            <Link href="/afiliados">Programa de afiliados</Link>
            <Link href="/marca-blanca">Programa de marca blanca</Link>
            <Link href="/api">Acceso a la API</Link>
          </div>
          <div>
            <span className="footer-label">Blog</span>
            <Link href="/como-hacer-virtual-staging">
              Cómo hacer virtual staging
            </Link>
            <Link href="/precios-virtual-staging">
              Precios de virtual staging
            </Link>
            <Link href="/virtual-staging-con-ia">Virtual staging con IA</Link>
            <Link href="/alternativas-virtual-staging">
              Alternativas de virtual staging
            </Link>
            <Link href="/amoblar-departamentos">Amoblar departamentos</Link>
          </div>
        </div>
        <div className="footer-bottom">
          <a
            href="https://www.argentina.gob.ar/produccion/defensadelconsumidor/formulario"
            target="_blank"
            rel="noopener noreferrer"
          >
            Defensa de las y los consumidores. Para reclamos ingresá acá
          </a>
          <span>© {new Date().getFullYear()} amoblaIA™</span>
        </div>
      </div>
    </footer>
  );
}
