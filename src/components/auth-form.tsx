"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { browserClient } from "@/lib/supabase/client";
import { safeNext } from "@/lib/commerce/redirect";
import { ArrowUpRight, LoaderCircle, ShieldCheck } from "lucide-react";
declare global {
  interface Window {
    turnstile?: {
      render: (
        element: HTMLElement,
        options: Record<string, unknown>,
      ) => string;
      remove: (id: string) => void;
      reset: (id: string) => void;
    };
  }
}
function Captcha({
  onToken,
  reset,
}: {
  onToken: (token: string) => void;
  reset: number;
}) {
  const ref = useRef<HTMLDivElement>(null),
    id = useRef<string | null>(null);
  const key = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  useEffect(() => {
    if (!key) return;
    let alive = true;
    function render() {
      if (alive && ref.current && window.turnstile && !id.current)
        id.current = window.turnstile.render(ref.current, {
          sitekey: key,
          theme: "light",
          callback: onToken,
          "expired-callback": () => onToken(""),
        });
    }
    let script = document.querySelector<HTMLScriptElement>(
      "script[data-amobla-captcha]",
    );
    if (!script) {
      script = document.createElement("script");
      script.src =
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.dataset.amoblaCaptcha = "true";
      document.head.appendChild(script);
    }
    script.addEventListener("load", render);
    render();
    return () => {
      alive = false;
      script?.removeEventListener("load", render);
      if (id.current) window.turnstile?.remove(id.current);
      id.current = null;
    };
  }, [key, onToken]);
  useEffect(() => {
    if (id.current) {
      window.turnstile?.reset(id.current);
      onToken("");
    }
  }, [reset, onToken]);
  return key ? <div className="captcha" ref={ref} /> : null;
}
export function AuthForm() {
  const params = useSearchParams();
  const [mode, setMode] = useState<"login" | "signup" | "reset" | "update">(
    params.get("modo") === "actualizar" ? "update" : "login",
  );
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(
      params.get("error")
        ? "El enlace venció o no es válido. Pedí uno nuevo."
        : "",
    ),
    [notice, setNotice] = useState(""),
    [accepted, setAccepted] = useState(false),
    [token, setToken] = useState(""),
    [captchaReset, setCaptchaReset] = useState(0);
  const available = Boolean(browserClient());
  const googleEnabled = process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true";
  const emailEnabled = process.env.NEXT_PUBLIC_EMAIL_AUTH_ENABLED === "true";
  async function googleLogin() {
    const client = browserClient();
    if (!client) return;
    setBusy(true);
    setError("");
    if (!accepted) {
      setError("Aceptá las condiciones para continuar.");
      setBusy(false);
      return;
    }
    const { error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeNext(params.get("next")))}`,
      },
    });
    if (error) {
      setError("No pudimos abrir el acceso con Google. Intentá nuevamente.");
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    const client = browserClient();
    if (!client) return;
    if (
      process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY &&
      !token &&
      mode !== "update"
    ) {
      setError("Completá la verificación para continuar.");
      return;
    }
    setBusy(true);
    try {
      const redirect = `${window.location.origin}/auth/callback?next=${encodeURIComponent(mode === "reset" ? "/acceso?modo=actualizar" : safeNext(params.get("next")))}`;
      if (mode === "login") {
        const { error } = await client.auth.signInWithPassword({
          email,
          password,
          options: { captchaToken: token || undefined },
        });
        if (error)
          throw new Error(
            "Revisá el email, la contraseña y la confirmación de tu cuenta.",
          );
        window.location.assign(safeNext(params.get("next")));
      } else if (mode === "signup") {
        if (!accepted)
          throw new Error("Aceptá las condiciones para crear tu cuenta.");
        const { error } = await client.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: redirect,
            captchaToken: token || undefined,
          },
        });
        if (error)
          throw new Error(
            "No pudimos crear la cuenta. Revisá tus datos o intentá de nuevo más tarde.",
          );
        setNotice(
          "Revisá tu email para confirmar la cuenta. Si ya tenés una, podés ingresar o recuperar la contraseña.",
        );
        setPassword("");
      } else if (mode === "reset") {
        const { error } = await client.auth.resetPasswordForEmail(email, {
          redirectTo: redirect,
          captchaToken: token || undefined,
        });
        if (error)
          throw new Error("No pudimos enviar el enlace. Intentá más tarde.");
        setNotice(
          "Si existe una cuenta con ese email, vas a recibir un enlace para recuperar el acceso.",
        );
      } else {
        const { error } = await client.auth.updateUser({ password });
        if (error)
          throw new Error(
            "No pudimos actualizar la contraseña. Pedí un nuevo enlace de recuperación.",
          );
        window.location.assign("/cuenta");
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No pudimos completar la operación.",
      );
    } finally {
      setBusy(false);
      setCaptchaReset((v) => v + 1);
    }
  }
  return (
    <div className="account-page container">
      <div className="auth-layout">
        <div className="auth-intro">
          <span className="eyebrow">TUS PROPIEDADES, EN UN MISMO LUGAR</span>
          <h1>
            Un espacio para
            <br />
            <span className="accent">tus espacios.</span>
          </h1>
          <p>
            Guardá tus fotos, compará variantes y prepará tu próxima
            publicación.
          </p>
          <p className="field-hint">
            <ShieldCheck size={18} /> Tus proyectos son privados.
          </p>
        </div>
        <div className="auth-card">
          {emailEnabled && mode !== "reset" && mode !== "update" && (
            <div className="billing-toggle">
              <button
                className={mode === "login" ? "selected" : ""}
                onClick={() => {
                  setMode("login");
                  setError("");
                  setNotice("");
                }}
              >
                Ingresar
              </button>
              <button
                className={mode === "signup" ? "selected" : ""}
                onClick={() => {
                  setMode("signup");
                  setError("");
                  setNotice("");
                }}
              >
                Crear cuenta
              </button>
            </div>
          )}
          <h2>
            {mode === "login"
              ? "Qué bueno verte de nuevo."
              : mode === "signup"
                ? "Tu próxima publicación empieza acá."
                : mode === "reset"
                  ? "Recuperá tu acceso."
                  : "Elegí una nueva contraseña."}
          </h2>
          {!available ? (
            <p>
              Estamos preparando las cuentas. Mientras tanto, podés{" "}
              <Link href="/estudio">explorar el estudio</Link>.
            </p>
          ) : (
            <>
              {googleEnabled && mode !== "update" && (
                <div className="google-access">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={accepted}
                      onChange={(e) => setAccepted(e.target.checked)}
                    />
                    <span>
                      Acepto los <Link href="/terminos">términos</Link> y la{" "}
                      <Link href="/privacidad">política de privacidad</Link>.
                    </span>
                  </label>
                  <button
                    type="button"
                    className="button button-outline"
                    disabled={busy}
                    onClick={googleLogin}
                  >
                    Ingresar con Google <ArrowUpRight size={18} />
                  </button>
                </div>
              )}
              {!googleEnabled && !emailEnabled && (
                <p>
                  Estamos preparando el acceso a las cuentas. Mientras tanto,
                  podés <Link href="/estudio">explorar el estudio</Link>.
                </p>
              )}
              {(emailEnabled || mode === "update") && (
                <form onSubmit={submit}>
                  {mode !== "update" && (
                    <label>
                      Email
                      <input
                        type="email"
                        autoComplete="email"
                        value={email}
                        maxLength={254}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                      />
                    </label>
                  )}
                  {mode !== "reset" && (
                    <label>
                      Contraseña
                      <input
                        type="password"
                        autoComplete={
                          mode === "login" ? "current-password" : "new-password"
                        }
                        minLength={mode === "login" ? 1 : 10}
                        maxLength={128}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                      />
                      {mode !== "login" && (
                        <small>Usá al menos 10 caracteres.</small>
                      )}
                    </label>
                  )}
                  {mode === "signup" && (
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={accepted}
                        onChange={(e) => setAccepted(e.target.checked)}
                        required
                      />
                      <span>
                        Acepto los <Link href="/terminos">términos</Link> y la{" "}
                        <Link href="/privacidad">política de privacidad</Link>.
                      </span>
                    </label>
                  )}
                  {mode !== "update" && (
                    <Captcha onToken={setToken} reset={captchaReset} />
                  )}
                  <button className="button button-primary" disabled={busy}>
                    {busy ? (
                      <LoaderCircle className="spin" size={18} />
                    ) : (
                      <ArrowUpRight size={18} />
                    )}{" "}
                    {mode === "login"
                      ? "Ingresar"
                      : mode === "signup"
                        ? "Crear mi cuenta"
                        : mode === "reset"
                          ? "Enviar enlace"
                          : "Guardar contraseña"}
                  </button>
                  {mode === "login" && (
                    <button
                      type="button"
                      className="text-link"
                      onClick={() => {
                        setMode("reset");
                        setNotice("");
                        setError("");
                      }}
                    >
                      Olvidé mi contraseña
                    </button>
                  )}
                  {mode === "reset" && (
                    <button
                      type="button"
                      className="text-link"
                      onClick={() => setMode("login")}
                    >
                      Volver a ingresar
                    </button>
                  )}
                </form>
              )}
            </>
          )}
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="inline-notice" role="status">
              {notice}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
