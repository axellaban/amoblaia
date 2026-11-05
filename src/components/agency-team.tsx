"use client";
// «Equipo y accesos» of the agency panel (docs/EQUIPO_Y_ACCESOS.md): who
// works there and with which role (Administrador or Miembro), the
// invitations and their state, the requests to join, and the agency's
// principal administrator (who it is, asking to become it, approving or
// handing it over). Everyone of the agency sees the team; only
// administrators see the actions. The server checks every one of them.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Crown, CreditCard, Eye, EyeOff, MessageCircle, MoreHorizontal, Search, ShieldCheck, UserPlus } from "lucide-react";
import { api, ApiError, Dialog } from "./admin-demos";
import { Captcha } from "./auth-form";
import { track } from "@/lib/analytics";
import { ROLE_LABEL, scopable, type AgencyRole, type InvitedRole, type TeamMember, type TeamProperty } from "@/lib/agency/shared";
import {
  INVITE_ROLE_CHOICES,
  INVITE_STATUS_LABEL,
  protectedMember,
  VISIBLE_ROLE,
  VISIBLE_ROLE_HELP,
  type AccessRequest,
  type InviteHistory,
  type WorkspaceAdministration,
} from "@/lib/agency/workspace-shared";
import { browserClient } from "@/lib/supabase/client";

const message = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);
const day = (iso: string) => new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "short" });
const absolute = (path: string) => (typeof window === "undefined" ? path : `${window.location.origin}${path}`);

type Workspace = {
  agency: { id: string; name: string };
  role: AgencyRole;
  canManage: boolean;
  readOnly: boolean;
  team: TeamMember[];
  administration: WorkspaceAdministration;
  requests: AccessRequest[];
  invitations: InviteHistory[];
  properties: TeamProperty[];
};
/** The role and properties of an existing access. */
type Draft = { target: TeamMember; role: InvitedRole; limited: boolean; properties: string[] };
/** The link just made, shown once: only its hash is kept. */
type Shared = { link: string; name: string | null; email: string };
type Confirm = { title: string; body: React.ReactNode; action: string; danger?: boolean; run: () => Promise<void> };

const who = (m: { name: string | null; email: string | null }) => m.name || m.email || "Usuario";

export function AgencyTeam({ readOnly: forcedReadOnly = false }: { readOnly?: boolean }) {
  const [data, setData] = useState<Workspace | null>(null);
  const [error, setError] = useState("");
  const [inviting, setInviting] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [shared, setShared] = useState<Shared | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; ok?: boolean } | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<Workspace>("/api/panel/equipo"));
      setError("");
    } catch (e) {
      setError(message(e, "No pudimos cargar el equipo."));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  /** One action: busy while it runs, its message after, and the list read again. */
  const act = useCallback(
    async (key: string, run: () => Promise<string | void>, failure: string) => {
      setBusy(key);
      setNote(null);
      try {
        const ok = await run();
        await load();
        if (ok) setNote({ text: ok, ok: true });
      } catch (e) {
        setNote({ text: message(e, failure) });
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  if (!data) return error ? <RetryLine error={error} onRetry={() => void load()} /> : <p role="status">Cargando el equipo…</p>;
  const readOnly = forcedReadOnly || data.readOnly;
  const manage = data.canManage && !readOnly;
  const members = data.team.filter((m) => m.kind === "member");
  const pending = data.team.filter((m) => m.kind === "pending");
  const admin = data.administration;
  const principalId = admin.principal?.id ?? null;
  const youId = members.find((m) => m.you)?.id ?? "";
  const titles = new Map(data.properties.map((p) => [p.id, p.title]));
  const agency = data.agency.name;
  const base = { agency_id: data.agency.id, user_role: data.role };

  const invite = async (email: string, role: InvitedRole) => {
    const r = await api<{ link: string }>("/api/panel/usuarios", { method: "POST", body: JSON.stringify({ email, role }) });
    track("workspace_invitation_sent", { ...base, invited_role: role });
    setShared({ link: absolute(r.link), name: null, email: email.trim().toLowerCase() });
    setInviting(false);
    await load();
  };

  const renew = (m: TeamMember) =>
    act(
      m.id,
      async () => {
        const r = await api<{ link: string }>(`/api/panel/usuarios/${m.id}`, { method: "PATCH", body: JSON.stringify({ kind: "pending", renew: true }) });
        setShared({ link: absolute(r.link), name: m.name, email: m.email ?? "" });
      },
      "No pudimos crear un enlace nuevo.",
    );

  const remove = (m: TeamMember) =>
    setConfirm({
      title: m.kind === "pending" ? "Cancelar invitación" : "Revocar acceso",
      body: m.kind === "pending" ? `El enlace de ${who(m)} deja de funcionar.` : `${who(m)} deja de ver el panel de ${agency}. Su cuenta sigue existiendo, fuera de la inmobiliaria.`,
      action: m.kind === "pending" ? "Cancelar invitación" : "Revocar acceso",
      danger: true,
      run: () =>
        act(
          m.id,
          async () => {
            await api(`/api/panel/usuarios/${m.id}?tipo=${m.kind}`, { method: "DELETE" });
            if (shared && m.email === shared.email) setShared(null);
            return m.kind === "pending" ? "Invitación cancelada." : "Acceso revocado.";
          },
          "No pudimos quitar el acceso.",
        ),
    });

  const answer = (r: AccessRequest, approve: boolean) =>
    act(
      r.id,
      async () => {
        await api(`/api/panel/equipo/solicitudes/${r.id}`, { method: "POST", body: JSON.stringify({ approve }) });
        if (approve) track("workspace_access_approved", { ...base, entry_point: r.source, is_existing_workspace: true });
        return approve ? `${r.email ?? "La persona"} ya forma parte del equipo como Miembro.` : "Solicitud rechazada.";
      },
      "No pudimos responder la solicitud.",
    );

  const askAdministration = () =>
    act(
      "admin-request",
      async () => {
        const r = await api<{ created: boolean }>("/api/panel/equipo/administracion", { method: "POST", body: JSON.stringify({ action: "request" }) });
        if (r.created) track("workspace_admin_transfer_requested", base);
        return "Solicitud enviada al administrador principal.";
      },
      "No pudimos enviar la solicitud.",
    );

  const approveTransfer = (t: WorkspaceAdministration["transfers"][number]) =>
    setConfirm({
      title: "Aprobar transferencia",
      body: (
        <>
          <p>
            {who({ name: t.requesterName, email: t.requesterEmail })} pasará a ser el administrador principal de {agency}.
          </p>
          <TransferConsequences />
        </>
      ),
      action: "Aprobar transferencia",
      run: () =>
        act(
          t.id,
          async () => {
            await api(`/api/panel/equipo/administracion/${t.id}`, { method: "POST", body: JSON.stringify({ approve: true, confirm: true }) });
            track("workspace_admin_transfer_completed", { ...base, resolution: "principal" }, true);
            return "Listo: la administración principal fue transferida.";
          },
          "No pudimos transferir la administración.",
        ),
    });

  const rejectTransfer = (t: WorkspaceAdministration["transfers"][number]) =>
    act(
      t.id,
      async () => {
        await api(`/api/panel/equipo/administracion/${t.id}`, { method: "POST", body: JSON.stringify({ approve: false }) });
        return "Solicitud rechazada.";
      },
      "No pudimos rechazar la solicitud.",
    );

  const handOver = (m: TeamMember) =>
    setConfirm({
      title: "Transferir la administración principal",
      body: (
        <>
          <p>
            {who(m)} pasará a ser el administrador principal de {agency}.
          </p>
          <TransferConsequences />
        </>
      ),
      action: "Transferir",
      run: () =>
        act(
          `handover:${m.id}`,
          async () => {
            await api("/api/panel/equipo/administracion", { method: "POST", body: JSON.stringify({ action: "transfer", to: m.id }) });
            track("workspace_admin_transfer_completed", { ...base, resolution: "direct" }, true);
            return `${who(m)} es ahora el administrador principal.`;
          },
          "No pudimos transferir la administración.",
        ),
    });

  const count = members.length;
  return (
    <>
      <div className="ap-head">
        <div>
          <span className="eyebrow">Configuración</span>
          <h1>Equipo y accesos</h1>
          <p className="dm-help">
            {agency} · {count} {count === 1 ? "integrante" : "integrantes"}
          </p>
        </div>
        {manage && (
          <button type="button" className="button button-primary" onClick={() => (setShared(null), setNote(null), setInviting(true))}>
            <UserPlus size={16} aria-hidden="true" /> Invitar integrante
          </button>
        )}
      </div>
      <p className="dm-help">Los integrantes comparten las propiedades y créditos de la inmobiliaria.</p>
      {readOnly && <p className="inline-notice">Vista de soporte: solo lectura.</p>}
      {note && (
        <p className={note.ok ? "inline-notice" : "inline-error"} role={note.ok ? "status" : "alert"}>
          {note.text}
        </p>
      )}
      {shared && <ShareCard shared={shared} agency={agency} onClose={() => setShared(null)} />}

      {admin.isPrincipal && !readOnly && admin.transfers.map((t) => (
        <section key={t.id} className="account-panel at-transfer" aria-labelledby={`at-transfer-${t.id}`}>
          <h2 id={`at-transfer-${t.id}`}>Solicitud de administración</h2>
          <p>
            <strong>{who({ name: t.requesterName, email: t.requesterEmail })}</strong> solicita convertirse en administrador principal de {agency}.
          </p>
          <TransferConsequences />
          <div className="dm-share">
            <button type="button" className="button button-primary" disabled={busy === t.id} onClick={() => approveTransfer(t)}>
              Aprobar transferencia
            </button>
            <button type="button" className="button button-outline" disabled={busy === t.id} onClick={() => void rejectTransfer(t)}>
              Rechazar solicitud
            </button>
          </div>
        </section>
      ))}

      {manage && data.requests.length > 0 && (
        <section className="account-panel" aria-labelledby="at-requests-title">
          <h2 id="at-requests-title">Solicitudes de acceso</h2>
          <p className="dm-help">Al aprobarlas, entran como Miembro. Podés cambiar el rol después.</p>
          <ul className="at-list">
            {data.requests.map((r) => (
              <li key={r.id}>
                <span className="at-who">
                  <strong>{r.email ?? "Cuenta sin email"}</strong>
                  <small>Pidió acceso el {day(r.createdAt)}</small>
                </span>
                <span className="at-actions">
                  <button type="button" className="button button-small" disabled={busy === r.id} onClick={() => void answer(r, true)}>
                    Aprobar
                  </button>
                  <button type="button" className="button button-small button-outline" disabled={busy === r.id} onClick={() => void answer(r, false)}>
                    Rechazar
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="account-panel" aria-labelledby="at-list-title">
        <h2 id="at-list-title">Integrantes</h2>
        <ul className="at-list at-cards">
          {[...members, ...pending].map((m) => {
            const lock = m.kind === "member" ? protectedMember(m, principalId, youId) : null;
            const actions: { label: string; run: () => void; danger?: boolean }[] = [];
            if (manage && m.kind === "pending") {
              actions.push({ label: "Reenviar invitación", run: () => void renew(m) });
              actions.push({ label: "Cambiar rol", run: () => setDraft({ target: m, role: m.role === "owner" ? "admin" : m.role, limited: Boolean(m.properties), properties: m.properties ?? [] }) });
              actions.push({ label: "Cancelar invitación", run: () => remove(m), danger: true });
            }
            if (manage && m.kind === "member" && !lock) {
              actions.push({ label: "Cambiar rol", run: () => setDraft({ target: m, role: m.role === "owner" ? "admin" : m.role, limited: Boolean(m.properties), properties: m.properties ?? [] }) });
              actions.push({ label: "Revocar acceso", run: () => remove(m), danger: true });
            }
            if (admin.isPrincipal && !readOnly && m.kind === "member" && !m.you) actions.push({ label: "Transferir administración principal", run: () => handOver(m) });
            const expired = m.kind === "pending" && m.expiresAt && new Date(m.expiresAt).getTime() <= Date.now();
            return (
              <li key={`${m.kind}:${m.id}`}>
                <span className="at-who">
                  <strong>
                    {m.name || m.email || "Usuario"}
                    {m.you ? " (vos)" : ""}
                  </strong>
                  {m.name && m.email && <small>{m.email}</small>}
                </span>
                <span className="at-tags">
                  <span className="ap-chip">{VISIBLE_ROLE[m.role]}</span>
                  {m.principal && (
                    <span className="ap-chip at-chip-principal" title="Responsable principal del espacio">
                      <Crown size={13} aria-hidden="true" /> Principal
                    </span>
                  )}
                  {m.role === "owner" && (
                    <span className="ap-chip at-chip-billing" title="Sus créditos pagan las ambientaciones de la inmobiliaria">
                      <CreditCard size={13} aria-hidden="true" /> Facturación
                    </span>
                  )}
                  {m.properties && (
                    <small title={m.properties.map((id) => titles.get(id) ?? "").filter(Boolean).join(", ")}>
                      {m.properties.length} {m.properties.length === 1 ? "propiedad" : "propiedades"}
                    </small>
                  )}
                  {m.kind === "pending" ? (
                    <small className="at-pending">{expired ? "Invitación vencida" : `Invitación pendiente · vence el ${day(m.expiresAt!)}`}</small>
                  ) : (
                    <small>Activo desde el {day(m.createdAt)}</small>
                  )}
                </span>
                {actions.length > 0 && <ActionMenu label={`Acciones para ${who(m)}`} busy={busy === m.id} actions={actions} />}
              </li>
            );
          })}
        </ul>
      </section>

      {manage && data.invitations.some((i) => i.status !== "pending") && (
        <details className="account-panel at-history">
          <summary>Invitaciones anteriores</summary>
          <ul className="at-list">
            {data.invitations
              .filter((i) => i.status !== "pending")
              .map((i) => (
                <li key={i.id}>
                  <span className="at-who">
                    <strong>{i.email}</strong>
                    <small>
                      {VISIBLE_ROLE[i.role]} · enviada el {day(i.createdAt)}
                    </small>
                  </span>
                  <span className={`ap-chip at-status-${i.status}`}>{INVITE_STATUS_LABEL[i.status]}</span>
                </li>
              ))}
          </ul>
        </details>
      )}

      <section className="account-panel at-admin" aria-labelledby="at-admin-title">
        <h2 id="at-admin-title">
          <ShieldCheck size={20} aria-hidden="true" /> Administración de la inmobiliaria
        </h2>
        <p>
          Administrador principal:{" "}
          <strong>{admin.principal ? who(admin.principal) : "sin asignar"}</strong>
          {admin.principal?.name && admin.principal.email ? ` (${admin.principal.email})` : ""}.
        </p>
        {admin.isPrincipal ? (
          <p className="dm-help">
            Sos el administrador principal: aprobás las transferencias y las operaciones sensibles. Para pasarle esta responsabilidad a otra persona del
            equipo, elegí «Transferir administración principal» en su menú.
          </p>
        ) : readOnly ? null : admin.myRequest ? (
          <p className="inline-notice" role="status">
            Solicitud pendiente desde el {day(admin.myRequest.createdAt)}. Le avisamos al administrador principal. ¿No responde?{" "}
            <Link href="/ayuda" className="text-link">
              Escribinos
            </Link>{" "}
            y verificamos la titularidad con documentación.
          </p>
        ) : data.role !== "viewer" ? (
          <>
            <p className="dm-help">Si sos el titular o responsable autorizado, podés solicitar la administración principal de este espacio.</p>
            <button type="button" className="button button-outline" disabled={busy === "admin-request"} onClick={() => void askAdministration()}>
              {busy === "admin-request" ? "Enviando…" : "Solicitar administración"}
            </button>
          </>
        ) : null}
        {!admin.billingIsYou && data.role !== "editor" && data.role !== "viewer" && (
          <p className="dm-help">Los créditos se compran desde la cuenta de facturación de la inmobiliaria.</p>
        )}
      </section>

      <section className="account-panel">
        <h2>Qué puede hacer cada rol</h2>
        <ul className="ap-grants">
          {(["admin", "editor"] as const).map((r) => (
            <li key={r}>
              <span>{VISIBLE_ROLE[r]}</span>
              <small>{VISIBLE_ROLE_HELP[r]}</small>
            </li>
          ))}
        </ul>
        <p className="dm-help">
          La cuenta de facturación es la que compra los créditos y gestiona la suscripción. Todos los integrantes ven el saldo y lo usan.
        </p>
      </section>

      {inviting && <InviteDialog onClose={() => setInviting(false)} onInvite={invite} />}
      {draft && (
        <Dialog title={`Acceso de ${who(draft.target)}`} onClose={() => setDraft(null)}>
          <UserForm
            draft={draft}
            setDraft={setDraft}
            properties={data.properties}
            busy={busy === "form"}
            onCancel={() => setDraft(null)}
            onSubmit={(e) => {
              e.preventDefault();
              const d = draft;
              const properties = scopable(d.role) && d.limited ? d.properties : null;
              void act(
                "form",
                async () => {
                  await api(`/api/panel/usuarios/${d.target.id}`, { method: "PATCH", body: JSON.stringify({ kind: d.target.kind, role: d.role, properties }) });
                  setDraft(null);
                  return "Acceso actualizado.";
                },
                "No pudimos guardar el acceso.",
              );
            }}
          />
        </Dialog>
      )}
      {confirm && (
        <Dialog title={confirm.title} onClose={() => setConfirm(null)}>
          <div className="dm-dialog-body">
            {typeof confirm.body === "string" ? <p>{confirm.body}</p> : confirm.body}
            <div className="dm-dialog-actions">
              <button
                type="button"
                className={`button button-primary${confirm.danger ? " ap-danger" : ""}`}
                onClick={() => {
                  const c = confirm;
                  setConfirm(null);
                  void c.run();
                }}
              >
                {confirm.action}
              </button>
              <button type="button" className="button button-outline" onClick={() => setConfirm(null)}>
                Volver
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}

function TransferConsequences() {
  return (
    <ul className="at-consequences">
      <li>El solicitante pasará a ser el administrador principal.</li>
      <li>El administrador actual conserva su acceso como administrador.</li>
      <li>No se pierden propiedades, imágenes, demos ni créditos. La cuenta de facturación no cambia.</li>
    </ul>
  );
}

/** The actions of one integrante, behind «⋯»: the same on desktop and mobile, with comfortable targets. */
function ActionMenu({ label, actions, busy }: { label: string; actions: { label: string; run: () => void; danger?: boolean }[]; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <span className="at-menu" ref={ref}>
      <button type="button" className="icon-button at-menu-button" aria-label={label} aria-haspopup="menu" aria-expanded={open} disabled={busy} onClick={() => setOpen((v) => !v)}>
        <MoreHorizontal size={20} aria-hidden="true" />
      </button>
      {open && (
        <span className="at-menu-list" role="menu">
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              role="menuitem"
              className={a.danger ? "ap-danger" : ""}
              onClick={() => {
                setOpen(false);
                a.run();
              }}
            >
              {a.label}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

/** «Invitar a tu equipo»: an e-mail and its permissions, Miembro by default. */
function InviteDialog({ onClose, onInvite }: { onClose: () => void; onInvite: (email: string, role: InvitedRole) => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitedRole>("editor");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onInvite(email, role);
    } catch (err) {
      setError(message(err, "No pudimos crear la invitación."));
      setBusy(false);
    }
  }
  return (
    <Dialog title="Invitar a tu equipo" onClose={onClose}>
      <form className="dm-dialog-body at-form" onSubmit={submit}>
        <div className="at-fields">
          <label>
            Correo electrónico
            <input
              type="email"
              required
              maxLength={200}
              autoComplete="off"
              inputMode="email"
              placeholder="nombre@inmobiliaria.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
          </label>
        </div>
        <fieldset className="at-roles">
          <legend>Permisos</legend>
          {INVITE_ROLE_CHOICES.map((r) => (
            <label key={r} className={role === r ? "is-on" : ""}>
              <input type="radio" name="invite-role" value={r} checked={role === r} onChange={() => setRole(r)} />
              <span>
                <strong>
                  {VISIBLE_ROLE[r]}
                  {r === "editor" ? " (predeterminado)" : ""}
                </strong>
                <small>{VISIBLE_ROLE_HELP[r as "admin" | "editor"]}</small>
              </span>
            </label>
          ))}
        </fieldset>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="dm-dialog-actions">
          <button className="button button-primary" disabled={busy}>
            {busy ? "Enviando…" : "Enviar invitación"}
          </button>
        </div>
        <p className="dm-help">Los integrantes comparten las propiedades y créditos de la inmobiliaria.</p>
      </form>
    </Dialog>
  );
}

function RetryLine({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="inline-error ap-retry-row" role="alert">
      <span>{error}</span>
      <button type="button" className="button button-small button-outline" onClick={onRetry}>
        Reintentar
      </button>
    </div>
  );
}

/** The link to send, right after creating the access: copy it or open WhatsApp with it. */
function ShareCard({ shared, agency, onClose }: { shared: Shared; agency: string; onClose: () => void }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const text = `Hola${shared.name ? ` ${shared.name.split(" ")[0]}` : ""}, te invité al espacio de ${agency} en Habita. Entrá desde este enlace con Google o eligiendo una contraseña: ${shared.link}`;
  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("NO_CLIPBOARD");
      await navigator.clipboard.writeText(shared.link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <section className="account-panel at-share" aria-labelledby="at-share-title" role="status">
      <h2 id="at-share-title">
        <Check size={20} aria-hidden="true" /> Invitación creada. Enviale este enlace{shared.name ? ` a ${shared.name}` : ""}
      </h2>
      <p className="dm-help">
        Con este enlace entra al panel{shared.email ? ` con ${shared.email}` : ""}: solo funciona con ese email, sirve una sola vez y vence en 14 días.
        Por seguridad no lo volvemos a mostrar: si se pierde, elegí «Reenviar invitación» en la lista.
      </p>
      <input className="dm-link" readOnly value={shared.link} onFocus={(e) => e.target.select()} aria-label="Enlace de ingreso" />
      <div className="dm-share">
        <button type="button" className="button button-primary" onClick={() => void copy()}>
          <Copy size={16} aria-hidden="true" /> {copied ? "Enlace copiado" : "Copiar enlace"}
        </button>
        <a className="button button-outline" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">
          <MessageCircle size={16} aria-hidden="true" /> Enviar por WhatsApp
        </a>
        <button type="button" className="button button-outline" onClick={onClose}>
          Listo
        </button>
      </div>
      {copied === false && <p className="inline-error">No pudimos copiarlo: seleccioná el enlace y copialo a mano.</p>}
    </section>
  );
}

function UserForm({
  draft,
  setDraft,
  properties,
  busy,
  onSubmit,
  onCancel,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  properties: TeamProperty[];
  busy: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
}) {
  const [filter, setFilter] = useState("");
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? properties.filter((p) => [p.title, p.location, p.reference].some((v) => v?.toLowerCase().includes(q))) : properties;
  }, [filter, properties]);
  const chosen = new Set(draft.properties);
  const toggle = (id: string, on: boolean) => set({ properties: on ? [...draft.properties, id] : draft.properties.filter((p) => p !== id) });
  const canLimit = scopable(draft.role);
  const missing = canLimit && draft.limited && !draft.properties.length;
  // «Solo vista» stays available only for the accesses created with it before.
  const choices: InvitedRole[] = draft.target.role === "viewer" ? [...INVITE_ROLE_CHOICES, "viewer"] : INVITE_ROLE_CHOICES;
  return (
    <form className="dm-dialog-body at-form" onSubmit={onSubmit}>
      <fieldset className="at-roles">
        <legend>Rol</legend>
        {choices.map((r) => (
          <label key={r} className={draft.role === r ? "is-on" : ""}>
            <input type="radio" name="role" value={r} checked={draft.role === r} onChange={() => set({ role: r })} />
            <span>
              <strong>{VISIBLE_ROLE[r]}</strong>
              <small>{VISIBLE_ROLE_HELP[r]}</small>
            </span>
          </label>
        ))}
      </fieldset>
      {canLimit && (draft.limited || draft.target.properties) ? (
        <fieldset className="at-scope">
          <legend>Propiedades</legend>
          <div className="dm-choice">
            <label>
              <input type="radio" name="scope" checked={!draft.limited} onChange={() => set({ limited: false })} /> Todas
            </label>
            <label>
              <input type="radio" name="scope" checked={draft.limited} onChange={() => set({ limited: true })} /> Solo algunas
            </label>
          </div>
          {draft.limited &&
            (properties.length ? (
              <>
                {properties.length > 6 && (
                  <label className="ap-search">
                    <Search size={16} aria-hidden="true" />
                    <input type="search" placeholder="Buscar propiedad" aria-label="Buscar propiedad" value={filter} onChange={(e) => setFilter(e.target.value)} />
                  </label>
                )}
                <ul className="at-properties">
                  {shown.map((p) => (
                    <li key={p.id}>
                      <label>
                        <input type="checkbox" checked={chosen.has(p.id)} onChange={(e) => toggle(p.id, e.target.checked)} />
                        <span>
                          {p.title}
                          {(p.location || p.reference) && <small>{[p.location, p.reference ? `Ref. ${p.reference}` : null].filter(Boolean).join(" · ")}</small>}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="dm-help">Todavía no hay propiedades para elegir.</p>
            ))}
        </fieldset>
      ) : canLimit ? (
        <p className="dm-help">
          Ve todas las propiedades de la inmobiliaria.{" "}
          <button type="button" className="text-link" onClick={() => set({ limited: true })}>
            Limitar a algunas
          </button>
        </p>
      ) : (
        <p className="dm-help">Los administradores ven y gestionan todas las propiedades.</p>
      )}
      <div className="dm-dialog-actions">
        <button className="button button-primary" disabled={busy || missing}>
          {busy ? "Guardando…" : "Guardar cambios"}
        </button>
        <button type="button" className="button button-outline" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

export type JoinInfo = { agencyName: string; email: string; name: string | null; role: InvitedRole; limited: boolean; expiresAt: string };

/** The page an employee opens from the shared link. */
export function JoinAgency({
  code,
  invite,
  signedInEmail,
  hasAgency,
}: {
  code: string;
  invite: JoinInfo | null;
  signedInEmail: string | null;
  /** The agency the signed-in account already works for, if any. */
  hasAgency: string | null;
}) {
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [token, setToken] = useState("");
  const [captchaReset, setCaptchaReset] = useState(0);
  const onToken = useCallback((t: string) => setToken(t), []);
  const captcha = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
  const here = `/panel/unirme?${new URLSearchParams({ codigo: code })}`;

  if (!invite)
    return (
      <div className="account-page container ap-start">
        <span className="eyebrow">habita para inmobiliarias</span>
        <h1>Este enlace ya no está disponible</h1>
        <p>Venció, ya se usó o fue reemplazado por uno nuevo. Pedile otro a quien te creó el usuario.</p>
        <div className="ap-start-actions">
          <Link href="/acceso?next=/panel" className="button button-outline">
            Ya tengo mi usuario
          </Link>
        </div>
      </div>
    );

  const sameAccount = signedInEmail?.toLowerCase() === invite.email;
  const access = `${ROLE_LABEL[invite.role]}${invite.limited ? ", en las propiedades que te asignaron" : ""}`;
  /** Journey B: an invited member is in the existing space (no new agency, no new free credits). */
  const joined = (newAccount: boolean) => {
    const props = { user_role: invite!.role, entry_point: "invitation", is_first_member: false, is_existing_workspace: true, new_account: newAccount };
    track("workspace_invitation_accepted", props);
    track("workspace_access_completed", props, true);
  };

  async function join() {
    await api("/api/panel/unirme", { method: "POST", body: JSON.stringify({ code }) });
    track("agency_user_joined", { role: invite!.role });
    joined(false);
    window.location.assign("/panel");
  }

  async function signIn() {
    const client = browserClient();
    if (!client) throw new Error("Las cuentas todavía no están habilitadas.");
    const { error } = await client.auth.signInWithPassword({ email: invite!.email, password, options: { captchaToken: token || undefined } });
    if (error) throw new Error(mode === "new" ? "Tu usuario quedó creado, pero no pudimos iniciar sesión. Entrá con tu email y contraseña." : "Revisá la contraseña.");
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
        await api("/api/panel/unirme", { method: "POST", body: JSON.stringify({ code, password }) });
        await signIn();
        track("agency_user_joined", { role: invite!.role, new_account: true });
        joined(true);
        window.location.assign("/panel");
      } else {
        await signIn();
        await join();
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && mode === "new" && /ya tiene una cuenta/.test(err.message)) setMode("existing");
      setError(message(err, "No pudimos completar el ingreso."));
      setCaptchaReset((n) => n + 1);
      setBusy(false);
    }
  }

  async function oneClick() {
    setBusy(true);
    setError("");
    try {
      await join();
    } catch (err) {
      setError(message(err, "No pudimos sumarte a la inmobiliaria."));
      setBusy(false);
    }
  }

  async function signOut() {
    await browserClient()?.auth.signOut();
    window.location.reload();
  }

  return (
    <div className="account-page container ap-start">
      <span className="eyebrow">Usuario de {invite.agencyName}</span>
      <h1>{invite.name ? `${invite.name.split(" ")[0]}, entrá` : "Entrá"} al panel de {invite.agencyName}</h1>
      <p>
        Tu acceso: {access}. {mode === "new" && !signedInEmail ? "Elegí una contraseña y entrás directo." : ""}
      </p>
      {signedInEmail && !sameAccount ? (
        <div className="account-panel">
          <p>
            Estás con la cuenta {signedInEmail}, pero este acceso es para {invite.email}. Salí de esa cuenta para usar este enlace.
          </p>
          <button type="button" className="button button-primary" onClick={() => void signOut()}>
            Salir y continuar
          </button>
        </div>
      ) : signedInEmail ? (
        <div className="account-panel">
          {hasAgency ? (
            <>
              <p className="inline-error">Tu cuenta ya trabaja con {hasAgency} en habita. Una cuenta puede estar en una sola inmobiliaria.</p>
              <Link href="/panel" className="button button-outline">
                Ir a mi panel
              </Link>
            </>
          ) : (
            <>
              <p>Ya entraste como {signedInEmail}.</p>
              <button type="button" className="button button-primary button-large" disabled={busy} onClick={() => void oneClick()}>
                {busy ? "Un momento…" : `Entrar a ${invite.agencyName}`}
              </button>
            </>
          )}
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
        </div>
      ) : (
        <form className="account-panel ap-start-form" onSubmit={submit}>
          <label>
            Email
            <input type="email" value={invite.email} readOnly autoComplete="username" />
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
                autoFocus
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
            {busy ? "Un momento…" : "Entrar al panel"}
          </button>
          <p className="dm-help">
            {mode === "new" ? (
              <>
                ¿Ya tenés cuenta en habita con este email?{" "}
                <button type="button" className="text-link" onClick={() => (setMode("existing"), setError(""))}>
                  Entrá con tu contraseña
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
                  Elegir una contraseña
                </button>
                .
              </>
            )}
          </p>
          <p className="dm-help">
            Al continuar aceptás los <Link href="/terminos">términos</Link> y la <Link href="/privacidad">política de privacidad</Link>.
          </p>
        </form>
      )}
    </div>
  );
}
