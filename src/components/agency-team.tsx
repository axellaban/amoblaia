"use client";
// "Usuarios" of the agency panel: accesses for its employees, with a role
// and, if wanted, only some properties. Creating one answers a link to share
// right away (copy or WhatsApp); the employee opens it, chooses a password
// and lands in the panel (JoinAgency).
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Copy, Eye, EyeOff, MessageCircle, Search, UserPlus } from "lucide-react";
import { api, ApiError } from "./admin-demos";
import { Captcha } from "./auth-form";
import { track } from "@/lib/analytics";
import { INVITED_ROLES, ROLE_HELP, ROLE_LABEL, scopable, type InvitedRole, type TeamMember, type TeamProperty } from "@/lib/agency/shared";
import { browserClient } from "@/lib/supabase/client";

const message = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);
const day = (iso: string) => new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "short" });
const absolute = (path: string) => (typeof window === "undefined" ? path : `${window.location.origin}${path}`);

type Team = { team: TeamMember[]; properties: TeamProperty[] };
/** The form: a new access, or the role and properties of an existing one. */
type Draft = { target: TeamMember | null; name: string; email: string; role: InvitedRole; limited: boolean; properties: string[] };
/** The link just made, shown once: only its hash is kept. */
type Shared = { link: string; name: string | null; email: string };

const blank = (): Draft => ({ target: null, name: "", email: "", role: "editor", limited: false, properties: [] });

export function AgencyTeam({ readOnly = false }: { readOnly?: boolean }) {
  const [data, setData] = useState<Team | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [shared, setShared] = useState<Shared | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; ok?: boolean } | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<Team>("/api/panel/usuarios"));
      setError("");
    } catch (e) {
      setError(message(e, "No pudimos cargar los usuarios."));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft || busy) return;
    setBusy("form");
    setNote(null);
    const properties = scopable(draft.role) && draft.limited ? draft.properties : null;
    try {
      if (draft.target) {
        const r = await api<{ team: TeamMember[] }>(`/api/panel/usuarios/${draft.target.id}`, {
          method: "PATCH",
          body: JSON.stringify({ kind: draft.target.kind, role: draft.role, properties }),
        });
        setData((d) => (d ? { ...d, team: r.team } : d));
        setNote({ text: "Acceso actualizado.", ok: true });
      } else {
        const r = await api<{ link: string; team: TeamMember[] }>("/api/panel/usuarios", {
          method: "POST",
          body: JSON.stringify({ name: draft.name, email: draft.email, role: draft.role, properties }),
        });
        setData((d) => (d ? { ...d, team: r.team } : d));
        setShared({ link: absolute(r.link), name: draft.name.trim() || null, email: draft.email.trim().toLowerCase() });
        track("agency_user_created", { role: draft.role, limited: Boolean(properties) });
      }
      setDraft(null);
    } catch (err) {
      setNote({ text: message(err, "No pudimos guardar el usuario.") });
    } finally {
      setBusy(null);
    }
  }

  async function renew(m: TeamMember) {
    setBusy(m.id);
    setNote(null);
    try {
      const r = await api<{ link: string; team: TeamMember[] }>(`/api/panel/usuarios/${m.id}`, {
        method: "PATCH",
        body: JSON.stringify({ kind: "pending", renew: true }),
      });
      setData((d) => (d ? { ...d, team: r.team } : d));
      setShared({ link: absolute(r.link), name: m.name, email: m.email ?? "" });
    } catch (err) {
      setNote({ text: message(err, "No pudimos crear un enlace nuevo.") });
    } finally {
      setBusy(null);
    }
  }

  async function remove(m: TeamMember) {
    const who = m.name || m.email || "este usuario";
    const question =
      m.kind === "pending" ? `¿Eliminar el acceso de ${who}? Su enlace deja de funcionar.` : `¿Quitarle el acceso a ${who}? Deja de ver el panel de la inmobiliaria.`;
    if (!window.confirm(question)) return;
    setBusy(m.id);
    setNote(null);
    try {
      const r = await api<{ team: TeamMember[] }>(`/api/panel/usuarios/${m.id}?tipo=${m.kind}`, { method: "DELETE" });
      setData((d) => (d ? { ...d, team: r.team } : d));
      if (shared && m.email === shared.email) setShared(null);
    } catch (err) {
      setNote({ text: message(err, "No pudimos quitar el acceso.") });
    } finally {
      setBusy(null);
    }
  }

  const edit = (m: TeamMember) => {
    setShared(null);
    setNote(null);
    setDraft({
      target: m,
      name: m.name ?? "",
      email: m.email ?? "",
      role: m.role === "owner" ? "admin" : m.role,
      limited: Boolean(m.properties),
      properties: m.properties ?? [],
    });
  };

  if (!data) return error ? <RetryLine error={error} onRetry={() => void load()} /> : <p role="status">Cargando usuarios…</p>;
  const titles = new Map(data.properties.map((p) => [p.id, p.title]));
  return (
    <>
      <div className="ap-head">
        <div>
          <span className="eyebrow">Tu equipo</span>
          <h1>Usuarios</h1>
        </div>
        {!draft && !readOnly && (
          <button type="button" className="button button-primary" onClick={() => (setShared(null), setNote(null), setDraft(blank()))}>
            <UserPlus size={16} aria-hidden="true" /> Crear usuario
          </button>
        )}
      </div>
      <p className="dm-help">
        Creá accesos para tu equipo: cada usuario entra con su email y su contraseña. Todas las ambientaciones usan los créditos de la
        inmobiliaria.
      </p>
      {readOnly && <p className="inline-notice">Vista de soporte: solo lectura.</p>}
      {note && (
        <p className={note.ok ? "inline-notice" : "inline-error"} role={note.ok ? "status" : "alert"}>
          {note.text}
        </p>
      )}
      {shared && <ShareCard shared={shared} onClose={() => setShared(null)} />}
      {draft && (
        <UserForm
          draft={draft}
          setDraft={setDraft}
          properties={data.properties}
          busy={busy === "form"}
          onSubmit={save}
          onCancel={() => (setDraft(null), setNote(null))}
        />
      )}
      <section className="account-panel" aria-labelledby="at-list-title">
        <h2 id="at-list-title">Con acceso</h2>
        <ul className="at-list">
          {data.team.map((m) => {
            const locked = m.role === "owner" || m.you || readOnly;
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
                  <span className="ap-chip">{ROLE_LABEL[m.role]}</span>
                  <small title={m.properties?.map((id) => titles.get(id) ?? "").filter(Boolean).join(", ")}>
                    {m.properties ? `${m.properties.length} ${m.properties.length === 1 ? "propiedad" : "propiedades"}` : "Todas las propiedades"}
                  </small>
                  {m.kind === "pending" ? (
                    <small className="at-pending">Todavía no entró · el enlace vence el {day(m.expiresAt!)}</small>
                  ) : (
                    <small>Desde el {day(m.createdAt)}</small>
                  )}
                </span>
                {!locked && (
                  <span className="at-actions">
                    {m.kind === "pending" && (
                      <button type="button" className="button button-small" disabled={busy === m.id} onClick={() => void renew(m)}>
                        Enlace para compartir
                      </button>
                    )}
                    <button type="button" className="button button-small button-outline" disabled={busy === m.id} onClick={() => edit(m)}>
                      Editar
                    </button>
                    <button type="button" className="button button-small button-outline ap-danger" disabled={busy === m.id} onClick={() => void remove(m)}>
                      {m.kind === "pending" ? "Eliminar" : "Quitar acceso"}
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </section>
      <section className="account-panel">
        <h2>Qué puede hacer cada rol</h2>
        <ul className="ap-grants">
          <li>
            <span>{ROLE_LABEL.owner}</span>
            <small>Todo, y es la cuenta que compra los créditos.</small>
          </li>
          {INVITED_ROLES.map((r) => (
            <li key={r}>
              <span>{ROLE_LABEL[r]}</span>
              <small>{ROLE_HELP[r]}</small>
            </li>
          ))}
        </ul>
        <p className="dm-help">Los usuarios de edición o solo vista pueden quedar limitados a algunas propiedades: solo ven esas.</p>
      </section>
    </>
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
function ShareCard({ shared, onClose }: { shared: Shared; onClose: () => void }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const text = `Hola${shared.name ? ` ${shared.name.split(" ")[0]}` : ""}, te creé un usuario en el panel de la inmobiliaria. Entrá desde este enlace y elegí tu contraseña: ${shared.link}`;
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
        <Check size={20} aria-hidden="true" /> Listo. Compartile este enlace{shared.name ? ` a ${shared.name}` : ""}
      </h2>
      <p className="dm-help">
        Con este enlace entra al panel{shared.email ? ` con ${shared.email}` : ""} y elige su contraseña. Sirve una sola vez y vence en 14 días.
        Por seguridad no lo volvemos a mostrar: si se pierde, generá uno nuevo desde la lista.
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
  const editing = Boolean(draft.target);
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? properties.filter((p) => [p.title, p.location, p.reference].some((v) => v?.toLowerCase().includes(q))) : properties;
  }, [filter, properties]);
  const chosen = new Set(draft.properties);
  const toggle = (id: string, on: boolean) => set({ properties: on ? [...draft.properties, id] : draft.properties.filter((p) => p !== id) });
  const canLimit = scopable(draft.role);
  const missing = canLimit && draft.limited && !draft.properties.length;
  return (
    <form className="account-panel at-form" onSubmit={onSubmit}>
      <h2>{editing ? `Acceso de ${draft.target!.name || draft.target!.email}` : "Nuevo usuario"}</h2>
      {!editing && (
        <div className="at-fields">
          <label>
            Nombre
            <input value={draft.name} maxLength={80} autoComplete="off" placeholder="Ej.: Laura Gómez" onChange={(e) => set({ name: e.target.value })} />
          </label>
          <label>
            Email
            <input
              type="email"
              required
              maxLength={200}
              autoComplete="off"
              inputMode="email"
              placeholder="laura@inmobiliaria.com"
              value={draft.email}
              onChange={(e) => set({ email: e.target.value })}
            />
          </label>
        </div>
      )}
      <fieldset className="at-roles">
        <legend>Rol</legend>
        {INVITED_ROLES.map((r) => (
          <label key={r} className={draft.role === r ? "is-on" : ""}>
            <input type="radio" name="role" value={r} checked={draft.role === r} onChange={() => set({ role: r })} />
            <span>
              <strong>{ROLE_LABEL[r]}</strong>
              <small>{ROLE_HELP[r]}</small>
            </span>
          </label>
        ))}
      </fieldset>
      {canLimit ? (
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
                          {(p.location || p.reference) && (
                            <small>{[p.location, p.reference ? `Ref. ${p.reference}` : null].filter(Boolean).join(" · ")}</small>
                          )}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                <p className="dm-help">
                  {draft.properties.length} {draft.properties.length === 1 ? "elegida" : "elegidas"}. Las propiedades nuevas las carga un
                  administrador y después se le asignan.
                </p>
              </>
            ) : (
              <p className="dm-help">Todavía no hay propiedades para elegir.</p>
            ))}
        </fieldset>
      ) : (
        <p className="dm-help">Los administradores ven y gestionan todas las propiedades.</p>
      )}
      <div className="dm-share">
        <button className="button button-primary" disabled={busy || missing}>
          {busy ? "Guardando…" : editing ? "Guardar cambios" : "Crear usuario y obtener enlace"}
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

  async function join() {
    await api("/api/panel/unirme", { method: "POST", body: JSON.stringify({ code }) });
    track("agency_user_joined", { role: invite!.role });
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
