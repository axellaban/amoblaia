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
export function GoogleSignIn({ next }: { next: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
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
              window.location.assign(safeNext(next));
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
    };
  }, [next]);
  return (
    <div className="google-native" aria-busy={busy}>
      <div ref={ref} />
      {!ready && !error && <p role="status">Cargando acceso con Google…</p>}
      {busy && <p role="status">Ingresando a amoblaIA…</p>}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
