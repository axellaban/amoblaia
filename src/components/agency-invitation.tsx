"use client";
// The team's invitation, opened from WhatsApp or from its demo: the agency
// enters only an e-mail and a password and lands in its panel with the demos
// prepared for it, or straight in the property it came from. An e-mail that
// already has an account signs in instead.
import Link from "next/link";
import { useCallback, useState } from "react";
import { ArrowLeft, Check, Eye, EyeOff } from "lucide-react";
import { api, ApiError } from "./admin-demos";
import { Captcha } from "./auth-form";
import { Comparison } from "./comparison";
import { track } from "@/lib/analytics";
import { browserClient } from "@/lib/supabase/client";

export type InvitationInfo = { agencyName: string; properties: number; freeCredits: number; expiresAt: string };

/** The demo the agency came from, already checked to belong to the invited agency. */
export type InvitedProperty = {
  id: string;
  title: string;
  location: string | null;
  before: string | null;
  after: string | null;
  /** The presentation link with this same invitation. */
  back: string;
};

export function InvitationSignup({
  code,
  invitation,
  here,
  property = null,
}: {
  code: string;
  invitation: InvitationInfo | null;
  here: string;
  property?: InvitedProperty | null;
}) {
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [token, setToken] = useState("");
  const [captchaReset, setCaptchaReset] = useState(0);
  const onToken = useCallback((t: string) => setToken(t), []);
  const captcha = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);

  if (!invitation)
    return (
      <div className="account-page container ap-start">
        <span className="eyebrow">habita para inmobiliarias</span>
        <h1>Esta invitación ya no está disponible</h1>
        <p>El enlace venció, ya se usó o fue reemplazado por uno nuevo. Pedile otro al equipo de habita por el mismo WhatsApp.</p>
        <div className="ap-start-actions">
          {/* Back here after signing in: an account that already has this agency goes straight to its property. */}
          <Link href={`/acceso?next=${encodeURIComponent(here)}`} className="button button-outline">
            Ya tengo cuenta
          </Link>
        </div>
      </div>
    );

  async function signIn() {
    const client = browserClient();
    if (!client) throw new Error("Las cuentas todavía no están habilitadas.");
    const { error } = await client.auth.signInWithPassword({ email: email.trim(), password, options: { captchaToken: token || undefined } });
    if (error) throw new Error(mode === "new" ? "Tu cuenta quedó creada, pero no pudimos iniciar sesión. Entrá con tu email y contraseña." : "Revisá el email y la contraseña.");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (captcha && !token) {
      setError("Completá la verificación para continuar.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (mode === "new") {
        await api("/api/panel/invitacion", { method: "POST", body: JSON.stringify({ code, email, password }) });
        await signIn();
      } else {
        await signIn();
        await api("/api/panel/reclamar", { method: "POST", body: JSON.stringify({ code }) });
      }
      track("agency_claimed", { origin: property ? "demo_invitation" : "invitation", new_account: mode === "new" });
      // Into the property it came from, ready for a first try; otherwise the panel's home.
      window.location.assign(property ? `/panel/propiedades/${property.id}?bienvenida=1` : "/panel?bienvenida=1");
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && mode === "new" && /ya tiene una cuenta/.test(err.message)) setMode("existing");
      setError(err instanceof Error ? err.message : "No pudimos completar el ingreso.");
      setCaptchaReset((n) => n + 1);
      setBusy(false);
    }
  }

  const demos = invitation.properties;
  const credits =
    invitation.freeCredits > 0
      ? `Incluye ${invitation.freeCredits} ${invitation.freeCredits === 1 ? "crédito" : "créditos"} de regalo para ambientar fotos con IA.`
      : "";
  const form = (
      <form className="account-panel ap-start-form" onSubmit={submit}>
        {property && <h2>Entrá a tu panel</h2>}
        <label>
          Email
          <input type="email" required autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </label>
        <label>
          {mode === "new" ? "Elegí una contraseña" : "Tu contraseña"}
          <span className="ap-password">
            <input
              type={show ? "text" : "password"}
              required
              minLength={mode === "new" ? 8 : 1}
              maxLength={72}
              autoComplete={mode === "new" ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button type="button" className="icon-button" aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"} onClick={() => setShow((v) => !v)}>
              {show ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </span>
          {mode === "new" && <small className="dm-help">Mínimo 8 caracteres.</small>}
        </label>
        <Captcha onToken={onToken} reset={captchaReset} />
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <button className="button button-primary button-large" disabled={busy}>
          {busy ? "Un momento…" : mode === "new" ? "Entrar a mi panel" : "Entrar y sumar mis demos"}
        </button>
        <p className="dm-help">
          {mode === "new" ? (
            <>
              ¿Ya tenés cuenta en habita?{" "}
              <button type="button" className="text-link" onClick={() => (setMode("existing"), setError(""))}>
                Entrá con ella
              </button>{" "}
              o{" "}
              <Link href={`/acceso?next=${encodeURIComponent(here)}`} className="text-link">
                con Google
              </Link>
              .
            </>
          ) : (
            <>
              ¿Es tu primera vez?{" "}
              <button type="button" className="text-link" onClick={() => (setMode("new"), setError(""))}>
                Crear acceso nuevo
              </button>
              .
            </>
          )}
        </p>
        <p className="dm-help">
          Al continuar aceptás los <Link href="/terminos">términos</Link> y la <Link href="/privacidad">política de privacidad</Link>. Sin tarjeta de crédito.
        </p>
      </form>
  );

  if (property)
    return (
      <div className="account-page container ap-invited">
        <Link href={property.back} className="text-link ap-invited-back">
          <ArrowLeft size={16} aria-hidden="true" /> Volver a la demo
        </Link>
        <span className="eyebrow">Invitación para {invitation.agencyName}</span>
        <h1>Tu propiedad está preparada</h1>
        <p className="ap-invited-lead">
          Creá tu acceso para editarla y probar las herramientas de fotos. {credits}
        </p>
        <div className="ap-invited-grid">
          <section className="account-panel ap-invited-property" aria-labelledby="ap-invited-title">
            <div className="ap-invited-head">
              <div>
                <h2 id="ap-invited-title">{property.title}</h2>
                {property.location && <p className="dm-help">{property.location}</p>}
              </div>
              <span className="ap-invited-chip">
                <Check size={14} aria-hidden="true" /> Tu punto de partida
              </span>
            </div>
            {property.before && property.after ? (
              <Comparison before={property.before} after={property.after} beforeLabel="Original" afterLabel="Ambientado con IA" alt={`${property.title}, ambientado con IA`} beforeAlt={`${property.title}, foto original`} />
            ) : property.before ? (
              <img className="ap-invited-photo" src={property.before} alt={`${property.title}, foto original`} />
            ) : null}
            <ul className="ap-invited-checks">
              <li>
                <Check size={16} aria-hidden="true" /> Fotos originales conservadas
              </li>
              <li>
                <Check size={16} aria-hidden="true" /> Ambientaciones disponibles
              </li>
              <li>
                <Check size={16} aria-hidden="true" /> Podés sumar otras propiedades
              </li>
            </ul>
          </section>
          {form}
        </div>
      </div>
    );

  return (
    <div className="account-page container ap-start">
      <span className="eyebrow">Invitación de habita</span>
      <h1>{invitation.agencyName}, tu panel ya está listo</h1>
      <p>
        {demos
          ? `Preparamos ${demos === 1 ? "una propiedad" : `${demos} propiedades`} con fotos ambientadas para tu inmobiliaria. `
          : "Preparamos tu panel para que subas tus propiedades. "}
        Creá tu acceso con tu email y una contraseña y entrás directo. {credits}
      </p>
      {form}
    </div>
  );
}
