"use client";
import { useState } from "react";
import { LoaderCircle, Check } from "lucide-react";
export function ContactForm({
  kind = "soporte",
  compact = false,
}: {
  kind?: string;
  compact?: boolean;
}) {
  const [email, setEmail] = useState(""),
    [message, setMessage] = useState(""),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [ticket, setTicket] = useState("");
  // The footer newsletter mirrors the reference: one field with the button
  // inside it. Pressing "Suscribirme" is the explicit opt-in.
  const inline = kind === "newsletter" && compact;
  return (
    <form
      className={`contact-form ${compact ? "compact" : ""}`}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          const r = await fetch("/api/contact", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              kind,
              email,
              message,
              consent: inline || consent,
            }),
          });
          const p = await r.json();
          if (!r.ok) throw new Error(p.error);
          setTicket(p.id);
          setEmail("");
          setMessage("");
        } catch (e) {
          setError(
            e instanceof Error ? e.message : "No pudimos guardar tu consulta.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      {ticket ? (
        <p className="inline-notice" role="status">
          <Check size={18} />{" "}
          {kind === "newsletter"
            ? "Te anotamos para recibir novedades."
            : `Recibimos tu solicitud. Número de seguimiento: ${ticket.slice(0, 8).toUpperCase()}.`}
        </p>
      ) : inline ? (
        <div className="newsletter-inline">
          <input
            type="email"
            required
            autoComplete="email"
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Ingresá tu email"
            aria-label="Email"
          />
          <button disabled={busy}>
            {busy && <LoaderCircle className="spin" size={17} />} Suscribirme
          </button>
        </div>
      ) : (
        <>
          <label>
            Email
            <input
              type="email"
              required
              autoComplete="email"
              maxLength={254}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu-email@ejemplo.com"
            />
          </label>
          {kind !== "newsletter" && (
            <label>
              {kind === "reembolso" || kind === "arrepentimiento"
                ? "Referencia del pago y detalle de la solicitud"
                : "¿En qué podemos ayudarte?"}
              <textarea
                required
                minLength={10}
                maxLength={2000}
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Contanos un poco más…"
              />
            </label>
          )}
          <label className="checkbox-label">
            <input
              type="checkbox"
              required
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span>
              {kind === "newsletter"
                ? "Quiero recibir novedades de amoblaIA por email."
                : "Acepto que usen estos datos para responder mi solicitud."}
            </span>
          </label>
          <button className="button button-primary" disabled={busy}>
            {busy && <LoaderCircle className="spin" size={17} />}{" "}
            {kind === "newsletter" ? "Suscribirme" : "Enviar solicitud"}
          </button>
        </>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
