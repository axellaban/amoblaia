"use client";
// "Editar inmobiliaria": the tab's signed edit context and its permanent
// banner. The context is started (audited) when the workspace opens, kept in
// this tab's sessionStorage by agency, sent with every admin API call, and
// forgotten when the team member leaves. Another tab on another agency has
// its own; nothing here changes the agency's account or session.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, LogOut, PencilLine, RefreshCw } from "lucide-react";
import { EDIT_EXPIRED_EVENT, api, setEditContext } from "./admin-demos";
import { EDIT_ALLOWED, EDIT_HEADER, EDIT_SEPARATE, editStorageKey } from "@/lib/agency/edit-scope";

type Stored = { token: string; expiresAt: string };
export type EditState = { status: "starting" | "active" | "expired" | "error"; expiresAt: string | null; error: string };

function readStored(agencyId: string): Stored | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(editStorageKey(agencyId)) || "null") as Stored | null;
    return v && typeof v.token === "string" && Date.parse(v.expiresAt) > Date.now() + 60_000 ? v : null;
  } catch {
    return null;
  }
}
function store(agencyId: string, v: Stored | null) {
  try {
    if (v) sessionStorage.setItem(editStorageKey(agencyId), JSON.stringify(v));
    else sessionStorage.removeItem(editStorageKey(agencyId));
  } catch {
    /* Private mode: the context lasts while the page is open. */
  }
}

/** The edit context of this tab for one agency: started once, renewed on demand, left explicitly. */
export function useAgencyEdit(agencyId: string) {
  const [state, setState] = useState<EditState>({ status: "starting", expiresAt: null, error: "" });
  const token = useRef<string | null>(null);
  const use = useCallback(
    (v: Stored) => {
      token.current = v.token;
      setEditContext(v.token);
      store(agencyId, v);
      setState({ status: "active", expiresAt: v.expiresAt, error: "" });
    },
    [agencyId],
  );
  const start = useCallback(async () => {
    // Renewing keeps the page as it is (an editor with drafts stays mounted); only a first start shows "Abriendo…".
    setState((s) => ({ ...s, status: s.status === "error" ? "starting" : s.status, error: "" }));
    try {
      use(await api<Stored>(`/api/admin/inmobiliarias/${agencyId}/edicion`, { method: "POST" }));
    } catch (e) {
      const error = e instanceof Error ? e.message : "No pudimos abrir la edición.";
      // A failed renewal keeps the page (and its drafts) as it was; only a first start fails as an error.
      setState((s) => (s.status === "expired" ? { ...s, error } : { status: "error", expiresAt: null, error }));
    }
  }, [agencyId, use]);

  useEffect(() => {
    const saved = readStored(agencyId);
    if (saved) use(saved);
    else void start();
    return () => {
      // Only this page's context is cleared: navigating to another agency sets its own.
      if (token.current) setEditContext(null);
    };
  }, [agencyId, start, use]);

  // Expiry: the banner says so and offers to renew; writes are refused by the server meanwhile.
  useEffect(() => {
    if (state.status !== "active" || !state.expiresAt) return;
    const left = Date.parse(state.expiresAt) - Date.now();
    const timer = setTimeout(() => setState((s) => ({ ...s, status: "expired" })), Math.max(0, Math.min(left, 2 ** 31 - 1)));
    const onExpired = () => setState((s) => ({ ...s, status: "expired" }));
    window.addEventListener(EDIT_EXPIRED_EVENT, onExpired);
    return () => {
      clearTimeout(timer);
      window.removeEventListener(EDIT_EXPIRED_EVENT, onExpired);
    };
  }, [state.status, state.expiresAt]);

  const leave = useCallback(async () => {
    const current = token.current;
    token.current = null;
    setEditContext(null);
    store(agencyId, null);
    if (current)
      await fetch(`/api/admin/inmobiliarias/${agencyId}/edicion`, { method: "DELETE", headers: { [EDIT_HEADER]: current } }).catch(() => null);
  }, [agencyId]);

  return { state, renew: start, leave, ready: state.status === "active" };
}
export type AgencyEdit = ReturnType<typeof useAgencyEdit>;

const time = (iso: string) => new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });

/** Always on top while the team edits an agency: who acts, on which agency, until when, and the way out. */
export function AdminEditBanner({
  agencyName,
  edit,
  backHref,
  backLabel,
  exitHref,
  note,
}: {
  agencyName: string;
  edit: AgencyEdit;
  backHref?: string;
  backLabel?: string;
  exitHref: string;
  note?: string;
}) {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  const { state } = edit;
  return (
    <div className={`ae-banner is-${state.status}`} role="region" aria-label="Edición administrativa" data-testid="admin-edit-banner">
      <div className="ae-banner-text">
        <strong>
          <PencilLine size={15} aria-hidden="true" /> Edición administrativa · {agencyName}
        </strong>
        <span role="status">
          {state.status === "starting"
            ? "Abriendo la edición…"
            : state.status === "error"
              ? state.error
              : state.status === "expired"
                ? "La edición venció: renovala para seguir guardando. Lo que no guardaste sigue en pantalla."
                : `Actuás como equipo habita con tu usuario; los cambios quedan registrados. Vence a las ${time(state.expiresAt!)}.`}
          {note ? ` ${note}` : ""}
        </span>
        {state.status === "expired" && state.error && <span className="inline-error">{state.error}</span>}
        <details className="ae-scope">
          <summary>Qué podés hacer acá</summary>
          <div>
            <p>Incluido:</p>
            <ul>
              {EDIT_ALLOWED.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
            <p>Queda aparte:</p>
            <ul>
              {EDIT_SEPARATE.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
        </details>
      </div>
      <div className="ae-banner-actions">
        {(state.status === "expired" || state.status === "error") && (
          <button type="button" className="button button-small" onClick={() => void edit.renew()}>
            <RefreshCw size={14} /> {state.status === "error" ? "Reintentar" : "Renovar edición"}
          </button>
        )}
        {backHref && (
          <Link href={backHref} className="button button-small button-outline">
            <ArrowLeft size={14} /> {backLabel ?? "Volver"}
          </Link>
        )}
        <button
          type="button"
          className="button button-small button-outline"
          disabled={leaving}
          onClick={async () => {
            setLeaving(true);
            await edit.leave();
            router.push(exitHref);
          }}
        >
          <LogOut size={14} /> Salir de esta inmobiliaria
        </button>
      </div>
    </div>
  );
}
