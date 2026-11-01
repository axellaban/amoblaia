"use client";
// One page for every upcoming tool (spec §2.1, §5): what it will do, a clear
// "Próximamente", and an explicit, reversible request to be told when it is
// ready. Opening the page and asking for the notice are measured apart; the
// notice channels are separate opt-ins, never inferred from the click.
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Bell, BarChart3, Check } from "lucide-react";
import { track } from "@/lib/analytics";
import { FUTURE_FEATURE_INFO, type FutureFeature } from "@/lib/agency/future-features";
import { ApiError, api } from "./admin-demos";

type State = { interested: boolean; notifyEmail: boolean; notifyWhatsapp: boolean };

const deviceType = () => (window.matchMedia("(max-width: 860px)").matches ? "mobile" : "desktop");

/** Original line illustrations in the brand's greens, one per tool. */
export function FeatureIllustration({ feature }: { feature: FutureFeature }) {
  const screen = {
    tour_360: (
      <>
        <ellipse cx="160" cy="108" rx="54" ry="14" fill="none" stroke="#24382e" strokeWidth="4" />
        <path d="M206 114l10 -4 -4 10" fill="none" stroke="#24382e" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        <text x="160" y="84" textAnchor="middle" fontSize="26" fontWeight="800" fill="#24382e">360°</text>
      </>
    ),
    planos: (
      <g fill="none" stroke="#24382e" strokeWidth="4" strokeLinejoin="round">
        <rect x="104" y="52" width="112" height="78" />
        <path d="M160 52v40h56M104 98h34M160 130v-18" />
      </g>
    ),
    redes: (
      <g>
        <rect x="128" y="44" width="64" height="94" rx="10" fill="#fff" stroke="#24382e" strokeWidth="4" />
        <rect x="138" y="58" width="44" height="34" rx="4" fill="#cfe3c8" />
        <path d="M138 104h44M138 116h30" stroke="#24382e" strokeWidth="4" strokeLinecap="round" />
      </g>
    ),
    api: (
      <g fill="none" stroke="#24382e" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M136 70l-22 22 22 22M184 70l22 22 -22 22M168 62l-16 60" />
      </g>
    ),
    video: (
      <g>
        <circle cx="160" cy="91" r="30" fill="#24382e" />
        <path d="M152 77l22 14 -22 14z" fill="#fff" />
      </g>
    ),
  }[feature];
  return (
    <svg className="ff-art" viewBox="0 0 320 200" role="img" aria-label={`Ilustración de ${FUTURE_FEATURE_INFO[feature].title}`}>
      <circle cx="160" cy="100" r="96" fill="#e7efe3" />
      <rect x="84" y="34" width="152" height="114" rx="10" fill="#fff" stroke="#24382e" strokeWidth="4" />
      <path d="M64 160h192" stroke="#24382e" strokeWidth="6" strokeLinecap="round" />
      <path d="M84 148l-14 12M236 148l14 12" stroke="#24382e" strokeWidth="4" strokeLinecap="round" />
      {screen}
      <path d="M44 150c-8-26 6-48 26-54-2 22-8 40-26 54z" fill="#9dbf8f" />
      <path d="M276 60l12-14M282 74l18-4M262 50l2-18" stroke="#9dbf8f" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

export function FutureFeaturePage({ feature, agencyName, role, readOnly = false }: { feature: FutureFeature; agencyName: string; role: string; readOnly?: boolean }) {
  const info = FUTURE_FEATURE_INFO[feature];
  const [state, setState] = useState<State | null>(null);
  // Notices are opt-in: nothing is ticked until the person chooses it.
  const [email, setEmail] = useState(false);
  const [whatsapp, setWhatsapp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    track("future_feature_page_viewed", { feature_key: feature, role, source_surface: "panel", device_type: deviceType() });
    let live = true;
    api<State>(`/api/panel/interes?feature=${feature}`)
      .then((s) => {
        if (!live) return;
        setState(s);
        if (s.interested) {
          setEmail(s.notifyEmail);
          setWhatsapp(s.notifyWhatsapp);
        }
      })
      .catch(() => live && setState({ interested: false, notifyEmail: false, notifyWhatsapp: false }));
    return () => {
      live = false;
    };
  }, [feature, role]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const next = await api<State & { first: boolean }>("/api/panel/interes", {
        method: "POST",
        body: JSON.stringify({ feature, notifyEmail: email, notifyWhatsapp: whatsapp, source: "future_feature_page" }),
      });
      setState(next);
      setEditing(false);
      // Only a saved opt-in counts as interest; `first` tells new interest from a change of channels.
      track("future_feature_interest_submitted", { feature_key: feature, role, notify_email: email, notify_whatsapp: whatsapp, first: next.first, device_type: deviceType() });
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : "No pudimos guardar tu interés.");
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    setBusy(true);
    setError("");
    try {
      setState(await api<State>(`/api/panel/interes?feature=${feature}`, { method: "DELETE" }));
      setEmail(false);
      setWhatsapp(false);
      track("future_feature_interest_withdrawn", { feature_key: feature, role });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos actualizarlo.");
    } finally {
      setBusy(false);
    }
  }

  const channels = state ? [state.notifyEmail && "email", state.notifyWhatsapp && "WhatsApp"].filter(Boolean).join(" y ") : "";
  return (
    <section className="ff" aria-labelledby="ff-title">
      <FeatureIllustration feature={feature} />
      <h1 id="ff-title">{info.title}</h1>
      <p className="ff-soon">Próximamente</p>
      <p className="ff-text">{info.description}</p>
      <ul className="ff-benefits">
        {info.benefits.map((b) => (
          <li key={b}>
            <Check size={16} aria-hidden="true" /> {b}
          </li>
        ))}
      </ul>
      {state === null ? (
        <p role="status" className="ff-status">
          Cargando…
        </p>
      ) : state.interested && !editing ? (
        <div className="ff-done" role="status">
          <p>
            <Check size={18} aria-hidden="true" /> Registramos el interés de <strong>{agencyName}</strong>.{" "}
            {channels ? `Te avisamos por ${channels} cuando esté disponible.` : "No vas a recibir avisos: podés activarlos cuando quieras."}
          </p>
          {!readOnly && (
            <p className="ff-done-actions">
              <button type="button" className="text-link" onClick={() => setEditing(true)} disabled={busy}>
                Cambiar avisos
              </button>
              <button type="button" className="text-link" onClick={() => void withdraw()} disabled={busy}>
                Ya no me interesa
              </button>
            </p>
          )}
        </div>
      ) : readOnly ? (
        <p className="ff-status">En la vista de soporte no se registra interés en nombre de la inmobiliaria.</p>
      ) : (
        <form className="ff-form" onSubmit={submit}>
          <fieldset>
            <legend>¿Querés que te avisemos?</legend>
            <label>
              <input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} /> Por email, a la cuenta con la que entraste
            </label>
            <label>
              <input type="checkbox" checked={whatsapp} onChange={(e) => setWhatsapp(e.target.checked)} /> Por WhatsApp, al contacto de la inmobiliaria
            </label>
          </fieldset>
          <button type="submit" className="button button-primary ff-cta" disabled={busy}>
            <Bell size={18} aria-hidden="true" /> {busy ? "Guardando…" : email || whatsapp ? "Avisame cuando esté disponible" : "Me interesa"}
          </button>
          <small>Podés cancelarlo cuando quieras. No te pedimos datos nuevos.</small>
        </form>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <Link href="/panel" className="text-link ff-back">
        <ArrowLeft size={16} aria-hidden="true" /> Volver al panel
      </Link>
      <p className="ff-note">
        <BarChart3 size={16} aria-hidden="true" /> Estamos validando el interés en esta funcionalidad.
      </p>
    </section>
  );
}
