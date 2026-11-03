"use client";
// The agency looking around its own panel before creating its account (it
// came from its demo's "Ingresar al panel"). Nothing interrupts the visit:
// a quiet bar offers the account, and only a change it tries (save, stage,
// import…) opens the step to create it, with everything it is seeing kept.
import { useEffect, useLayoutEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Lock, Sparkles } from "lucide-react";
import { Dialog, setVisiting, VISIT_ACCOUNT_EVENT } from "./admin-demos";
import { track } from "@/lib/analytics";
import { cta } from "@/lib/interaction-tracking";

/** The invitation's sign-up: the route reads the code from the visit's cookie. */
const ACCOUNT_HREF = "/panel/visita/cuenta";
/** The sign-up pages themselves: no bar, and their requests are not the panel's. */
const SIGNUP = /^\/panel\/(empezar|unirme)(\/|$)/;

export function VisitBanner({ agencyName, freeCredits }: { agencyName: string; freeCredits: number }) {
  const [asking, setAsking] = useState(false);
  const signup = SIGNUP.test(usePathname() ?? "");
  // Set before the panel's first requests, so a change tried at once already asks for the account.
  useLayoutEffect(() => {
    if (signup) return;
    setVisiting(true);
    return () => setVisiting(false);
  }, [signup]);
  useEffect(() => {
    const ask = () => {
      setAsking(true);
      track("panel_visit_account_asked", {});
    };
    window.addEventListener(VISIT_ACCOUNT_EVENT, ask);
    return () => window.removeEventListener(VISIT_ACCOUNT_EVENT, ask);
  }, []);
  if (signup) return null;
  const gift = freeCredits > 0 ? ` Incluye ${freeCredits} ${freeCredits === 1 ? "crédito" : "créditos"} de regalo.` : "";
  return (
    <>
      <div className="support-banner visit-banner" role="status">
        <Sparkles size={16} aria-hidden="true" />
        <span>
          <strong>Este es el panel de {agencyName}.</strong> Recorrelo libremente: cuando quieras guardar cambios o ambientar fotos, creá tu cuenta
          gratis y se conserva todo.{gift}
        </span>
        <a
          className="button button-small"
          href={ACCOUNT_HREF}
          {...cta("visit_banner_account", "visit_banner", "signup_invitation", "habita_b2b")}
          onClick={() => track("panel_visit_account_clicked", { origen: "franja" }, true)}
        >
          Crear mi cuenta
        </a>
      </div>
      {asking && (
        <Dialog title="Creá tu cuenta para seguir" onClose={() => setAsking(false)}>
          <div className="visit-ask">
            <p>
              Para guardar cambios, ambientar fotos o sumar propiedades, creá la cuenta de <strong>{agencyName}</strong>. Solo te pedimos un email y
              una contraseña.
            </p>
            <p className="dm-help">
              <Lock size={14} aria-hidden="true" /> Conservás las propiedades, fotos y ambientaciones que estás viendo.{gift}
            </p>
            <div className="visit-ask-buttons">
              <a
                className="button"
                href={ACCOUNT_HREF}
                {...cta("visit_dialog_account", "visit_dialog", "signup_invitation", "habita_b2b")}
                onClick={() => track("panel_visit_account_clicked", { origen: "accion" }, true)}
              >
                Crear mi cuenta gratis
              </a>
              <button type="button" className="button button-outline" onClick={() => setAsking(false)}>
                Seguir mirando
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
