"use client";
// The panel's navigation (Habita V2): a dark green sidebar on desktop and a
// compact bar with a drawer on mobile. The upcoming tools (Tour 360, Planos,
// Redes, API) are ordinary items here, without "Próximamente": their own page
// says it. The site and users stay for the owner and administrators.
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import {
  ChevronDown,
  CircleHelp,
  Compass,
  MessageCircle,
  Code2,
  CreditCard,
  Globe,
  Home,
  House,
  Images,
  LayoutGrid,
  Lightbulb,
  Menu,
  PlayCircle,
  Rotate3d,
  Share2,
  SquareDashed,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { track } from "@/lib/analytics";
import { cta } from "@/lib/interaction-tracking";
import { canManage, type AgencyRole } from "@/lib/agency/shared";
import type { FutureFeature } from "@/lib/agency/future-features";
import { videoEnabled } from "@/lib/agency/flags";
import { ASSISTANT_NAME, OPEN_ASSISTANT_EVENT } from "@/lib/assistant/shared";
import { PANEL_MENU_EVENT } from "@/lib/agency/panel-tour";
import { reopenTour } from "./panel-tour";

export type PanelSection =
  | "inicio"
  | "propiedades"
  | "imagenes"
  | "video"
  | "sitio"
  | "tour_360"
  | "planos"
  | "redes"
  | "api"
  | "creditos"
  | "usuarios"
  | "cuenta";

type Item = { id: PanelSection; href: string; label: string; icon: typeof Home; managers?: boolean; future?: FutureFeature };


const GROUPS = (): Item[][] => [
  [
    { id: "inicio", href: "/panel", label: "Inicio", icon: Home },
    { id: "propiedades", href: "/panel/propiedades", label: "Mis demostraciones", icon: LayoutGrid },
    { id: "imagenes", href: "/panel/imagenes", label: "Estudio de imágenes", icon: Images },
    ...(videoEnabled() ? [{ id: "video", href: "/panel/video", label: "Video", icon: PlayCircle, future: "video" } as Item] : []),
    // The agency's team, right above its website (owner and administrators only).
    { id: "usuarios", href: "/panel/usuarios", label: "Usuarios", icon: Users, managers: true },
    { id: "sitio", href: "/panel/sitio", label: "Sitio web", icon: Globe, managers: true },
  ],
  [
    { id: "tour_360", href: "/panel/tour-360", label: "Tour 360", icon: Rotate3d, future: "tour_360" },
    { id: "planos", href: "/panel/planos", label: "Planos", icon: SquareDashed, future: "planos" },
    { id: "redes", href: "/panel/redes", label: "Redes", icon: Share2, future: "redes" },
    { id: "api", href: "/panel/api", label: "API", icon: Code2, future: "api" },
  ],
  [
    { id: "creditos", href: "/panel/creditos", label: "Precios y créditos", icon: CreditCard },
  ],
];

const deviceType = () => (typeof window === "undefined" ? "unknown" : window.matchMedia("(max-width: 860px)").matches ? "mobile" : "desktop");

function NavList({ section, role, onNavigate, tour = true }: { section: PanelSection; role?: AgencyRole; onNavigate?: () => void; tour?: boolean }) {
  const [help, setHelp] = useState(false);
  const helpId = useId();
  return (
    <>
      {GROUPS().map((group, i) => (
        <ul key={i} className="ap-side-group">
          {group
            .filter((item) => !item.managers || (role && canManage(role)))
            .map(({ id, href, label, icon: Icon, future }) => (
              <li key={id}>
                <Link
                  href={href}
                  className={id === section ? "is-on" : ""}
                  aria-current={id === section ? "page" : undefined}
                  data-tour={`nav-${id}`}
                  {...cta(`panel_nav_${id}`, "panel_sidebar", `panel_${id}`, "navigation")}
                  onClick={() => {
                    // Opening an upcoming tool counts on choosing it, with or without signing up for its notice.
                    if (future && future !== "video")
                      track("future_feature_nav_clicked", { feature_key: future, role: role ?? "unknown", source_surface: "panel_sidebar", device_type: deviceType() });
                    onNavigate?.();
                  }}
                >
                  <Icon size={19} aria-hidden="true" />
                  <span>{label}</span>
                </Link>
              </li>
            ))}
          {/* Under the first group (after «Sitio web»): the guide at the bottom of the home, for every role. */}
          {i === 0 && (
            <li>
              <Link
                href="/panel#como-usar"
                className="ap-side-guide"
                {...cta("panel_nav_guide", "panel_sidebar", "panel_home_guide", "navigation")}
                onClick={() => {
                  onNavigate?.();
                  // Already on the home: the hash alone may not scroll again.
                  if (window.location.pathname === "/panel") document.getElementById("como-usar")?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              >
                <Lightbulb size={19} aria-hidden="true" />
                <span>¿Cómo uso Habita en mi negocio?</span>
              </Link>
            </li>
          )}
        </ul>
      ))}
      <ul className="ap-side-group ap-side-bottom">
        <li>
          {/* Help: Miguel Ángel, the assistant (the chat opens here, the page stays), and the welcome tour again. */}
          {tour ? (
            <>
              <button type="button" className="ap-side-button" aria-expanded={help} aria-controls={helpId} onClick={() => setHelp(!help)}>
                <CircleHelp size={19} aria-hidden="true" />
                <span>Ayuda</span>
                <ChevronDown size={16} aria-hidden="true" className={`ap-side-chevron ${help ? "is-open" : ""}`} />
              </button>
              {help && (
                <ul id={helpId} className="ap-side-sub">
                  <li>
                    <button
                      type="button"
                      className="ap-side-button"
                      {...cta("panel_nav_ayuda", "panel_sidebar", "assistant_open", "navigation")}
                      onClick={() => {
                        onNavigate?.();
                        window.dispatchEvent(new Event(OPEN_ASSISTANT_EVENT));
                      }}
                    >
                      <MessageCircle size={17} aria-hidden="true" />
                      <span>Preguntale a {ASSISTANT_NAME}</span>
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      className="ap-side-button"
                      onClick={() => {
                        onNavigate?.();
                        setHelp(false);
                        reopenTour("panel_sidebar_help");
                      }}
                    >
                      <Compass size={17} aria-hidden="true" />
                      <span>Volver a ver el recorrido</span>
                    </button>
                  </li>
                </ul>
              )}
            </>
          ) : (
            <button
              type="button"
              className="ap-side-button"
              {...cta("panel_nav_ayuda", "panel_sidebar", "assistant_open", "navigation")}
              onClick={() => {
                onNavigate?.();
                window.dispatchEvent(new Event(OPEN_ASSISTANT_EVENT));
              }}
            >
              <CircleHelp size={19} aria-hidden="true" />
              <span>Ayuda</span>
            </button>
          )}
        </li>
        <li>
          <Link
            href="/panel/cuenta"
            className={section === "cuenta" ? "is-on" : ""}
            aria-current={section === "cuenta" ? "page" : undefined}
            onClick={onNavigate}
          >
            <UserRound size={19} aria-hidden="true" />
            <span>Mi cuenta</span>
          </Link>
        </li>
      </ul>
    </>
  );
}

function Brand() {
  return (
    <Link href="/panel" className="ap-brand" aria-label="Habita, inicio del panel">
      <House size={24} aria-hidden="true" className="ap-brand-mark" />
      <span>HABITA</span>
    </Link>
  );
}

function PlansBox({ credits }: { credits?: number | null }) {
  return (
    <div className="ap-side-plans" data-tour="credits-plans">
      <p>
        {typeof credits === "number" ? (
          <>
            Te quedan <strong>{credits}</strong> {credits === 1 ? "crédito" : "créditos"} IA.
          </>
        ) : (
          "¿Necesitás más créditos para tu inmobiliaria?"
        )}
      </p>
      <Link href="/panel/creditos#precios" className="ap-side-plans-button" {...cta("panel_sidebar_plans", "panel_sidebar", "panel_credits")}>
        Ver precios
      </Link>
    </div>
  );
}

/**
 * The panel's navigation. Desktop: fixed sidebar (the page's header and footer
 * give way to it, see globals.css). Mobile: a bar with the agency's name and a
 * drawer with the same items.
 */
export function PanelNav({
  section,
  agencyName,
  role,
  credits,
  tour = true,
}: {
  section: PanelSection;
  agencyName?: string;
  role?: AgencyRole;
  credits?: number | null;
  /** «Ayuda → Volver a ver el recorrido»: not in the team's support view nor in the agency's visit. */
  tour?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // The welcome tour opens and closes this menu for its steps on a phone.
  useEffect(() => {
    const toggle = (e: Event) => setOpen(Boolean((e as CustomEvent<boolean>).detail));
    window.addEventListener(PANEL_MENU_EVENT, toggle);
    return () => window.removeEventListener(PANEL_MENU_EVENT, toggle);
  }, []);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      openRef.current?.focus();
    };
  }, [open]);
  return (
    <>
      <aside className="ap-sidebar" aria-label="Panel de la inmobiliaria">
        <Brand />
        <nav aria-label="Secciones del panel">
          <NavList section={section} role={role} tour={tour} />
        </nav>
        <PlansBox credits={credits} />
      </aside>
      <div className="ap-mobilebar">
        <Brand />
        {agencyName && <span className="ap-mobilebar-name">{agencyName}</span>}
        <button ref={openRef} type="button" className="ap-menu-button" aria-label="Abrir el menú del panel" aria-expanded={open} onClick={() => setOpen(true)}>
          <Menu size={24} aria-hidden="true" />
        </button>
      </div>
      {open && (
        <div className="ap-drawer-backdrop" onClick={() => setOpen(false)}>
          <div className="ap-drawer" role="dialog" aria-modal="true" aria-label="Menú del panel" onClick={(e) => e.stopPropagation()}>
            <div className="ap-drawer-head">
              <Brand />
              <button ref={closeRef} type="button" className="ap-menu-button" aria-label="Cerrar el menú" onClick={() => setOpen(false)}>
                <X size={24} aria-hidden="true" />
              </button>
            </div>
            {agencyName && <p className="ap-drawer-agency">{agencyName}</p>}
            <nav aria-label="Secciones del panel">
              <NavList section={section} role={role} tour={tour} onNavigate={() => setOpen(false)} />
            </nav>
            <PlansBox credits={credits} />
          </div>
        </div>
      )}
    </>
  );
}

/** The workspace's top line: the agency's initials and name (no "Guardar panel" here: this is an account's own panel). */
export function PanelTopbar({ agencyName, logo, children }: { agencyName: string; logo?: string | null; children?: React.ReactNode }) {
  const initials =
    agencyName
      .split(/\s+/)
      .filter((w) => /^\p{L}/u.test(w))
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "H";
  return (
    <div className="ap-topbar">
      <div className="ap-topbar-agency">
        {logo ? <img src={logo} alt="" className="ap-topbar-logo" /> : <span className="ap-topbar-initials" aria-hidden="true">{initials}</span>}
        <div>
          <strong>{agencyName}</strong>
          <small>Tu espacio de trabajo</small>
        </div>
      </div>
      <div className="ap-topbar-actions">
        {children}
        <Link href="/panel/cuenta" className="ap-topbar-account" aria-label="Mi cuenta">
          <UserRound size={20} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
