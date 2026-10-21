"use client";
import { useEffect, useRef, useState } from "react";
import { browserClient } from "@/lib/supabase/client";
import { safeNext } from "@/lib/commerce/redirect";

// Public OAuth client identifier. The secret stays in Supabase.
const clientId =
  process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ||
  "212695067390-pjf8j42r3blvvivn0ofpsc0s6nhq1d4f.apps.googleusercontent.com";
type Identity = {
  initialize(options: Record<string, unknown>): void;
  renderButton(element: HTMLElement, options: Record<string, unknown>): void;
};
declare global {
  interface Window {
    google?: { accounts: { id: Identity } };
  }
}
let scriptPromise: Promise<void> | null = null;
function loadGoogle() {
  if (window.google?.accounts.id) return Promise.resolve();
  if (!scriptPromise)
    scriptPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        scriptPromise = null;
        script.remove();
        reject(new Error("GOOGLE_SCRIPT_FAILED"));
      };
      document.head.appendChild(script);
    });
  return scriptPromise;
}
// Full-page OAuth through Supabase. It needs no popup or FedCM, so it works
// when the browser blocks those and the Google button does nothing.
async function redirectToGoogle(next: string | null) {
  const client = browserClient();
  if (!client) throw new Error("AUTH_UNAVAILABLE");
  const callback = new URL("/auth/callback", window.location.origin);
  callback.searchParams.set("next", safeNext(next, "/proyectos"));
  const { error } = await client.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: callback.toString(),
      queryParams: { prompt: "select_account" },
    },
  });
  if (error) throw error;
}
export function GoogleSignIn({ next }: { next: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [slow, setSlow] = useState(false);
  const redirect = async () => {
    setRedirecting(true);
    setError("");
    try {
      await redirectToGoogle(next);
    } catch {
      setRedirecting(false);
      setError("No pudimos abrir Google. Volvé a intentarlo en unos segundos.");
    }
  };
  useEffect(() => {
    let active = true;
    // A blocked or hanging Google script never settles; after a few seconds
    // the same-tab sign-in becomes the main path instead of an endless wait.
    const slow = setTimeout(() => {
      if (active) setSlow(true);
    }, 6000);
    async function init() {
      try {
        await loadGoogle();
        const nonce = Array.from(
          crypto.getRandomValues(new Uint8Array(32)),
          (b) => b.toString(16).padStart(2, "0"),
        ).join("");
        const hash = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(nonce),
        );
        const hashedNonce = Array.from(new Uint8Array(hash), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join("");
        if (!active || !ref.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          nonce: hashedNonce,
          auto_select: false,
          ux_mode: "popup",
          context: "signin",
          use_fedcm_for_button: true,
          callback: async ({ credential }: { credential?: string }) => {
            if (!active || !credential) return;
            setBusy(true);
            setError("");
            try {
              const client = browserClient();
              if (!client) throw new Error("AUTH_UNAVAILABLE");
              const { error } = await client.auth.signInWithIdToken({
                provider: "google",
                token: credential,
                nonce,
              });
              if (error) throw error;
              const claimed = await fetch("/api/guest/claim", {
                method: "POST",
              });
              if (!claimed.ok) throw new Error("GUEST_CLAIM_FAILED");
              window.location.assign(safeNext(next, "/proyectos"));
            } catch {
              setError(
                "No pudimos completar el acceso. Volvé a intentarlo con Google.",
              );
              setBusy(false);
            }
          },
        });
        window.google.accounts.id.renderButton(ref.current, {
          type: "standard",
          theme: "outline",
          size: "large",
          text: "continue_with",
          shape: "rectangular",
          locale: "es",
          width: Math.min(ref.current.clientWidth || 320, 400),
        });
        setReady(true);
      } catch {
        if (active)
          setError(
            "No pudimos cargar Google. Revisá tu conexión o el bloqueador de contenido y recargá la página.",
          );
      }
    }
    void init();
    return () => {
      active = false;
      clearTimeout(slow);
    };
  }, [next]);
  // Without a working Google button, the same-tab sign-in is the main action.
  const fallbackFirst = !ready && (slow || Boolean(error));
  return (
    <div className="google-native" aria-busy={busy}>
      <div ref={ref} />
      {!ready && !error && !slow && (
        <p role="status">Cargando acceso con Google…</p>
      )}
      {busy && <p role="status">Ingresando a amoblaIA…</p>}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className={
          fallbackFirst
            ? "button button-primary google-main"
            : "google-fallback"
        }
        onClick={redirect}
        disabled={redirecting || busy}
      >
        {redirecting
          ? "Abriendo Google…"
          : ready
            ? "¿No se abre? Ingresá con Google en esta pestaña"
            : "Continuar con Google"}
      </button>
    </div>
  );
}
