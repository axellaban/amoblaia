"use client";
// The agency's panel opened from its link before signing in (docs/ACCESO_PANEL.md).
// The first time, a welcome over the panel's own home offers three ways in:
// sign in, create the account (Google in one click, or e-mail) or look around
// as a guest. As a guest, a quiet «Modo exploración» bar stays on every page,
// and only a change it tries (save, stage, publish…) asks for the account.
// A signed-in account outside the agency is offered to take it over, or told
// it already has an owner. Nothing here grants anything: the server checks
// the visit on every request.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Eye, Lock, Mail, UserRound } from "lucide-react";
import { api, setVisiting, VISIT_ACCOUNT_EVENT } from "./admin-demos";
import { track } from "@/lib/analytics";
import { cta } from "@/lib/interaction-tracking";
import { browserClient } from "@/lib/supabase/client";
import { entryChoiceKey, explorationClick } from "@/lib/agency/exploration";

/** The invitation's sign-up: the route reads the code from the visit's cookie. */
const ACCOUNT_HREF = "/panel/visita/cuenta";
/** The sign-up pages themselves: no bar, and their requests are not the panel's. */
const SIGNUP = /^\/panel\/(empezar|unirme)(\/|$)/;

type Step = "welcome" | "ask" | "account" | null;

// Signed in, the choice is asked again once: that account may now take the agency over.
function readChoice(agencyId: string, signedIn: boolean) {
  try {
    return window.localStorage.getItem(entryChoiceKey(agencyId, signedIn));
  } catch {
    return null;
  }
}
function saveChoice(agencyId: string, signedIn: boolean) {
  try {
    window.localStorage.setItem(entryChoiceKey(agencyId, signedIn), "invitado");
  } catch {
    // Private window: the welcome may show again next time, nothing else changes.
  }
}

/** The page to come back to after signing in, without the link's analytics marker. */
function here() {
  const url = new URL(window.location.href);
  url.searchParams.delete("enlace");
  return `${url.pathname}${url.search}`;
}

const GoogleMark = () => (
  <svg viewBox="0 0 48 48" width="14" height="14" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z" />
    <path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z" />
    <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.7-6c-2.2 1.5-5 2.3-8.2 2.3-6.2 0-11.5-4.2-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
  </svg>
);

/** A dialog over the panel: the panel stays behind it. Escape and the backdrop close it. */
function EntryDialog({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    // The dialog itself takes the focus: Tab reaches its options, none looks pre-chosen.
    ref.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="pe-backdrop" onMouseDown={onClose}>
      <div ref={ref} className="pe-dialog" tabIndex={-1} role="dialog" aria-modal="true" aria-label={label} onMouseDown={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function AgencyHead({ agencyName, title, sub }: { agencyName: string; title: string; sub?: string }) {
  return (
    <div className="pe-head">
      <span className="pe-logo" aria-hidden="true">
        {agencyName.trim().charAt(0).toUpperCase() || "H"}
      </span>
      <div>
        <h2>{title}</h2>
        {sub && <p>{sub}</p>}
      </div>
    </div>
  );
}

/** Sign in, and create the account with its one line: Google in one click, or e-mail. */
function AccessButtons({ place, onPick }: { place: string; onPick: (choice: "iniciar_sesion" | "crear_cuenta") => void }) {
  const back = typeof window === "undefined" ? "/panel" : here();
  return (
    <div className="pe-stack">
      <a
        className="button button-primary"
        href={`/acceso?${new URLSearchParams({ next: back })}`}
        {...cta(`${place}_login`, place, "auth_login", "habita_b2b")}
        onClick={() => onPick("iniciar_sesion")}
      >
        Iniciar sesión
      </a>
      <a
        className="button button-outline pe-signup"
        href={`${ACCOUNT_HREF}?${new URLSearchParams({ volver: back })}`}
        {...cta(`${place}_signup`, place, "signup_invitation", "habita_b2b")}
        onClick={() => onPick("crear_cuenta")}
      >
        <span>Crear cuenta</span>
        <small>
          <GoogleMark /> En un clic con Google <span aria-hidden="true">·</span> <Mail size={12} aria-hidden="true" /> o con tu email
        </small>
      </a>
    </div>
  );
}

export function VisitBanner({
  agencyId,
  agencyName,
  freeCredits,
  claimed,
  signedInEmail,
}: {
  agencyId: string;
  agencyName: string;
  freeCredits: number;
  /** The agency already has its owner: a guest can sign in, not take it over. */
  claimed: boolean;
  /** Signed in with an account outside this agency. */
  signedInEmail: string | null;
}) {
  const path = usePathname() ?? "";
  const signup = SIGNUP.test(path);
  const [step, setStep] = useState<Step>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const viewed = useRef("");

  // Set before the panel's first requests, so a change tried at once already asks for the account.
  useLayoutEffect(() => {
    if (signup) return;
    setVisiting(true);
    return () => setVisiting(false);
  }, [signup]);

  // The first time in this browser: the welcome (or, signed in, what that account can do here).
  useEffect(() => {
    if (signup || readChoice(agencyId, Boolean(signedInEmail))) return;
    setStep(signedInEmail ? "account" : "welcome");
  }, [agencyId, signedInEmail, signup]);

  useEffect(() => {
    const ask = (e: Event) => {
      setStep(signedInEmail ? "account" : "ask");
      track("panel_visit_account_asked", { ruta: window.location.pathname, accion: (e as CustomEvent<{ action?: string }>).detail?.action ?? "desconocida" });
    };
    window.addEventListener(VISIT_ACCOUNT_EVENT, ask);
    return () => window.removeEventListener(VISIT_ACCOUNT_EVENT, ask);
  }, [signedInEmail]);

  // Exploration analytics: the home seen, and which section or property it opens from there.
  useEffect(() => {
    if (signup || step === "welcome" || path === viewed.current) return;
    viewed.current = path;
    if (path === "/panel") track("panel_exploration_home_viewed", { agency_id: agencyId, sesion: Boolean(signedInEmail) });
  }, [agencyId, path, signedInEmail, signup, step]);
  useEffect(() => {
    if (signup) return;
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]");
      if (!a) return;
      const hit = explorationClick(a.getAttribute("href") ?? "", window.location.pathname, a.closest(".ap-sidebar, .ap-drawer") ? "sidebar" : a.closest(".ap-topbar") ? "barra" : "contenido");
      if (hit) track(hit.event, { agency_id: agencyId, ...hit.properties });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [agencyId, signup]);

  const guest = useCallback(
    (origen: string) => {
      saveChoice(agencyId, Boolean(signedInEmail));
      track("panel_entry_choice", { agency_id: agencyId, choice: "invitado", origen });
      setStep(null);
    },
    [agencyId, signedInEmail],
  );
  const pick = (choice: "iniciar_sesion" | "crear_cuenta", origen: string) => track("panel_entry_choice", { agency_id: agencyId, choice, origen }, true);

  async function claimWithThisAccount() {
    setBusy(true);
    setError("");
    try {
      await api("/api/panel/visita", { method: "POST", body: "{}" });
      track("panel_claim_completed", { agency_id: agencyId, method: "signed_in", origin: "panel_link" }, true);
      window.location.assign(here());
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos pasar el panel a tu cuenta.");
      setBusy(false);
    }
  }
  async function otherAccount() {
    await browserClient()?.auth.signOut().catch(() => null);
    window.location.assign(`/acceso?${new URLSearchParams({ next: here() })}`);
  }

  if (signup) return null;
  const gift = freeCredits > 0 && !claimed ? ` Incluye ${freeCredits} ${freeCredits === 1 ? "crédito" : "créditos"} de regalo.` : "";
  return (
    <>
      <div className="support-banner visit-banner" role="status">
        <span className="pe-chip">Modo exploración</span>
        <span className="pe-msg">Explorá las herramientas de Habita. Para guardar tus cambios, necesitás acceder a tu cuenta.</span>
        <button
          type="button"
          className="button button-small"
          {...cta("visit_banner_account", "visit_banner", "panel_access", "habita_b2b")}
          onClick={() => {
            setStep(signedInEmail ? "account" : "ask");
            track("panel_visit_account_clicked", { origen: "franja" }, true);
          }}
        >
          Acceder a mi cuenta
        </button>
      </div>

      {step === "welcome" && (
        <EntryDialog label={`Panel de ${agencyName}`} onClose={() => guest("cerrar")}>
          <AgencyHead agencyName={agencyName} title={`Este es el panel de ${agencyName}`} sub="Tus propiedades y las herramientas de Habita." />
          <AccessButtons place="panel_welcome" onPick={(c) => pick(c, "bienvenida")} />
          <p className="pe-or">
            <span>o</span>
          </p>
          <button type="button" className="pe-guest" {...cta("panel_welcome_guest", "panel_welcome", "panel_exploration", "habita_b2b")} onClick={() => guest("bienvenida")}>
            <span className="pe-guest-icon" aria-hidden="true">
              <Eye size={18} />
            </span>
            <span>
              <b>Ver como invitado</b>
              <small>Entrá ahora y recorré tu panel sin registrarte.</small>
            </span>
            <span className="pe-guest-arrow" aria-hidden="true">
              →
            </span>
          </button>
          <p className="pe-legend">
            <span>Tus propiedades y demos</span>
            <span>Todas las herramientas</span>
            <span>Sin tarjeta</span>
          </p>
        </EntryDialog>
      )}

      {step === "ask" && (
        <EntryDialog label="Accedé para guardar" onClose={() => setStep(null)}>
          <AgencyHead agencyName={agencyName} title="Accedé para guardar" sub={`Para guardar tus cambios, entrá a la cuenta de ${agencyName}.`} />
          <p className="pe-note">
            <Lock size={14} aria-hidden="true" /> Al entrar, volvés a esta misma pantalla.{gift}
          </p>
          <AccessButtons place="visit_dialog" onPick={(c) => pick(c, "guardar")} />
          <button type="button" className="text-link pe-keep" onClick={() => setStep(null)}>
            Seguir explorando
          </button>
        </EntryDialog>
      )}

      {step === "account" && signedInEmail && (
        <EntryDialog label={`Panel de ${agencyName}`} onClose={() => guest("cerrar")}>
          <AgencyHead
            agencyName={agencyName}
            title={claimed ? "Tu cuenta todavía no tiene acceso" : `¿Usás esta cuenta para ${agencyName}?`}
          />
          <p className="pe-who">
            <UserRound size={16} aria-hidden="true" /> Entraste como <b>{signedInEmail}</b>
          </p>
          <p className="pe-sub">
            {claimed
              ? `${agencyName} ya tiene quien la administra en habita. Pedile que te sume desde «Usuarios» en su panel.`
              : `${agencyName} todavía no tiene cuenta. Si es tu inmobiliaria, quedás como administrador con esta misma cuenta, sin registrarte de nuevo.${gift}`}
          </p>
          <div className="pe-stack">
            {!claimed && (
              <button type="button" className="button button-primary" disabled={busy} onClick={() => void claimWithThisAccount()}>
                {busy ? "Un momento…" : `Usar esta cuenta para ${agencyName}`}
              </button>
            )}
            <button type="button" className="button button-outline" disabled={busy} onClick={() => void otherAccount()}>
              Usar otra cuenta
            </button>
          </div>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <button type="button" className="text-link pe-keep" onClick={() => guest("cuenta")}>
            Ver como invitado
          </button>
        </EntryDialog>
      )}
    </>
  );
}

/**
 * How the panel was opened from the agency's fixed link (/i/…, ?enlace=):
 * recorded once, then the marker leaves the address bar.
 */
export function SharedLinkOpened() {
  useEffect(() => {
    const url = new URL(window.location.href);
    const how = url.searchParams.get("enlace");
    if (!how) return;
    track("panel_shared_link_opened", { apertura: /^[a-z]{1,12}$/.test(how) ? how : "otro" }, true);
    url.searchParams.delete("enlace");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);
  return null;
}
