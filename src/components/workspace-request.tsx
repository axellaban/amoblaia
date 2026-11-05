"use client";
// «Solicitar acceso» (docs/EQUIPO_Y_ACCESOS.md, Journey C): someone signed in
// opened a demo or a link of an agency whose space they do not belong to.
// They can ask to join it (an administrator approves; nothing is granted
// here) or go back to the demo, which stays public.
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Check, Clock } from "lucide-react";
import { api, ApiError } from "./admin-demos";
import { GoogleSignIn } from "./google-signin";
import { track } from "@/lib/analytics";
import { cta } from "@/lib/interaction-tracking";

export type RequestScreen = {
  agencyId: string;
  agencyName: string;
  /** The agency has its space (an owner); otherwise the request reaches the team. */
  hasSpace: boolean;
  demoToken: string | null;
  demoId: string | null;
  code: string | null;
  /** Back to the public demo, when we know it. */
  backHref: string | null;
  signedInEmail: string | null;
  /** The account already works for another agency (its name). */
  otherAgency: string | null;
  /** Already asked: when. */
  pendingSince: string | null;
  here: string;
};

const day = (iso: string) => new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "long" });

export function WorkspaceRequest(p: RequestScreen) {
  const [pending, setPending] = useState<string | null>(p.pendingSince);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const base = { agency_id: p.agencyId, entry_point: p.demoToken ? "demo" : p.code ? "link" : "panel", is_existing_workspace: p.hasSpace, ...(p.demoId ? { demo_id: p.demoId } : {}) };

  // Seen once per screen: the person reached a space they cannot enter yet.
  useEffect(() => {
    track("workspace_access_denied", { ...base, reason: p.signedInEmail ? (p.otherAgency ? "other_agency" : "not_member") : "signed_out" });
    // Only on arrival.
  }, []);

  async function ask() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await api<{ createdAt?: string; created?: boolean; member?: boolean }>("/api/panel/acceso", {
        method: "POST",
        body: JSON.stringify({ ...(p.demoToken ? { demo: p.demoToken } : {}), ...(p.code ? { codigo: p.code } : {}) }),
      });
      if (r.member) {
        window.location.assign("/panel");
        return;
      }
      if (r.created) track("workspace_access_requested", base, true);
      setPending(r.createdAt ?? new Date().toISOString());
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : "No pudimos enviar la solicitud.");
    } finally {
      setBusy(false);
    }
  }

  const title = p.hasSpace ? `${p.agencyName} ya tiene un espacio en Habita.` : `${p.agencyName} todavía no activó su espacio en Habita.`;
  const lead = p.hasSpace
    ? "Podés solicitar acceso para trabajar con las propiedades de esta inmobiliaria."
    : "Para activarlo hace falta la invitación que el equipo de habita le envió a la inmobiliaria. Si trabajás ahí, pedí acceso y te contactamos.";
  const back = p.backHref ? (
    <Link href={p.backHref} className="button button-outline button-large" {...cta("request_back_to_demo", "workspace_request", "demo", "navigation")}>
      <ArrowLeft size={16} aria-hidden="true" /> Volver a la demostración
    </Link>
  ) : null;

  return (
    <div className="account-page container ap-start wr-page">
      <span className="eyebrow">habita para inmobiliarias</span>
      <h1>{title}</h1>
      <p>{lead}</p>

      {!p.signedInEmail ? (
        <div className="account-panel ap-start-form">
          <h2>Iniciá sesión para continuar</h2>
          <p className="dm-help">Si ya formás parte del equipo, entrás directo a su panel.</p>
          <GoogleSignIn next={p.here} />
          <Link href={`/acceso?${new URLSearchParams({ next: p.here })}`} className="button button-outline">
            Iniciar sesión con email
          </Link>
          {back}
        </div>
      ) : p.otherAgency ? (
        <div className="account-panel ap-start-form">
          <p className="inline-error">
            Tu cuenta ({p.signedInEmail}) ya trabaja con {p.otherAgency} en habita. Una cuenta puede estar en una sola inmobiliaria: entrá con otro email
            para pedir acceso a {p.agencyName}.
          </p>
          <div className="ap-start-actions">
            <Link href="/panel" className="button button-primary">
              Ir a mi panel
            </Link>
            {back}
          </div>
        </div>
      ) : pending ? (
        <div className="account-panel ap-start-form wr-sent" role="status">
          <h2>
            <Check size={20} aria-hidden="true" /> Solicitud enviada
          </h2>
          <p>
            {p.hasSpace
              ? `Le avisamos a los administradores de ${p.agencyName}. Cuando la aprueben, vas a entrar a su panel como Miembro con ${p.signedInEmail}.`
              : `El equipo de habita la va a revisar con ${p.agencyName} y te contactamos a ${p.signedInEmail}.`}
          </p>
          <p className="dm-help">
            <Clock size={14} aria-hidden="true" /> Pedida el {day(pending)}. Mientras tanto, la demostración sigue disponible.
          </p>
          {back}
        </div>
      ) : (
        <div className="account-panel ap-start-form">
          <p className="dm-help">Entraste como {p.signedInEmail}.</p>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <div className="ap-start-actions">
            <button type="button" className="button button-primary button-large" disabled={busy} onClick={() => void ask()}>
              {busy ? "Enviando…" : "Solicitar acceso"}
            </button>
            {back}
          </div>
          {!p.hasSpace && (
            <p className="dm-help">
              ¿Es otra inmobiliaria?{" "}
              <Link href="/panel/empezar" className="text-link">
                Creá la tuya
              </Link>
              .
            </p>
          )}
        </div>
      )}
    </div>
  );
}
