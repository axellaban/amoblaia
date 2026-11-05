"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import {
  Check,
  ChevronDown,
  Home,
  KeyRound,
  LayoutDashboard,
  Link2,
  MessageCircle,
  MoreHorizontal,
  Send,
  Tag,
  Target,
  TrendingUp,
  Building2,
} from "lucide-react";
import { AgencyView } from "@/components/admin-leads";
import { api, copyLinkWhenReady, Dialog, LinkCopy, linkOf, SendWhatsapp, ViewLink } from "@/components/admin-demos";
import { ACCOUNT_LABEL, HOT_SCORE, STAGE_STEP, type AccountState, type CommercialStage, type NextAction } from "@/lib/agency/commercial";
import { normalizeArNumber } from "@/lib/demos/send";
import { adminPhotoUrl, type DemoSummary } from "@/lib/demos/shared";

/* ------------------------------------------------------------------ */
/* Small pieces shared by the list and the detail                      */
/* ------------------------------------------------------------------ */

const STAGE_ICON: Record<CommercialStage, typeof Check> = {
  prospect: Target,
  contacted: MessageCircle,
  demo_sent: Send,
  interacted: TrendingUp,
  panel: LayoutDashboard,
  client: Check,
};

/** The agency's commercial stage as a pill with its icon. */
export function StagePill({ stage }: { stage: CommercialStage }) {
  const Icon = STAGE_ICON[stage];
  return (
    <span className={`ah-pill ah-stage is-${stage}`}>
      <Icon size={14} aria-hidden="true" /> {STAGE_STEP[stage]}
    </span>
  );
}

export function AccountPill({ state }: { state: AccountState }) {
  return <span className={`ah-pill ah-account is-${state}`}>{ACCOUNT_LABEL[state]}</span>;
}

/** «72 / 100», green from the hot threshold; a dash without external activity. */
export function ScorePill({ score, compact = false }: { score: number | null; compact?: boolean }) {
  if (score === null)
    return (
      <span className="ah-pill ah-score is-none" title="Sin visitas externas: las del equipo no cuentan">
        —
      </span>
    );
  return (
    <span className={`ah-pill ah-score ${score >= HOT_SCORE ? "is-hot" : score >= 40 ? "is-warm" : "is-cold"}`} title="Lead score: engagement observado, no probabilidad de compra">
      {score}
      {compact ? "" : " / 100"}
    </span>
  );
}

/** The agency's picture: the cover of one of its demos, or a building. */
export function AgencyThumb({ photoId, size = "small" }: { photoId: string | null; size?: "small" | "large" }) {
  return (
    <span className={`ah-thumb is-${size}`} aria-hidden="true">
      {photoId ? <img src={adminPhotoUrl(photoId, null, size === "large" ? 240 : 120)} alt="" loading="lazy" /> : <Building2 size={size === "large" ? 26 : 18} />}
    </span>
  );
}

/**
 * «⋯»: a few secondary actions in a small menu. Escape or a click outside
 * closes it; the items are ordinary links and buttons.
 */
export function MoreMenu({ label, children, align = "end" }: { label: string; children: ReactNode; align?: "start" | "end" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className={`ah-menu is-${align}`} ref={ref}>
      <button type="button" className="ah-icon-button" aria-label={label} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <MoreHorizontal size={18} aria-hidden="true" />
      </button>
      {/* Kept mounted: a dialog opened from an item (credits, confirmations) survives the menu closing. */}
      <div id={id} className="ah-menu-list" hidden={!open} onClick={(e) => (e.target as HTMLElement).closest("a") && setOpen(false)}>
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sending and contacting                                              */
/* ------------------------------------------------------------------ */

/**
 * «Enviar demo» in the agency's header: straight to the WhatsApp dialog
 * when it has one published demo; with several, it first asks which one.
 */
export function SendDemo({ demos }: { demos: DemoSummary[] }) {
  const published = demos.filter((d) => d.status === "published");
  const [choosing, setChoosing] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  // The number is the agency's: the same on every demo.
  const why = !published.length
    ? "Publicá una demo para poder enviarla"
    : !normalizeArNumber(published[0].agencyWhatsapp)
      ? "Falta el WhatsApp de la inmobiliaria: cargalo en «Editar inmobiliaria»"
      : null;
  if (why)
    return (
      <button type="button" className="button button-small dm-whatsapp" disabled title={why}>
        <MessageCircle size={15} aria-hidden="true" /> Enviar demo
      </button>
    );
  if (published.length === 1) return <SendWhatsapp demo={published[0]} label="Enviar demo" />;
  const demo = published.find((d) => d.id === chosen);
  return (
    <>
      <button type="button" className="button button-small dm-whatsapp" onClick={() => setChoosing(true)}>
        <MessageCircle size={15} aria-hidden="true" /> Enviar demo
      </button>
      {choosing && (
        <Dialog title="¿Qué demo querés enviar?" onClose={() => setChoosing(false)}>
          <ul className="ah-choose">
            {published.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => {
                    setChosen(d.id);
                    setChoosing(false);
                  }}
                >
                  <AgencyThumb photoId={d.cover?.id ?? d.coverPhotoId} />
                  <span>
                    <strong>{d.title}</strong>
                    <small>{d.sentAt ? "Ya enviada: queda registrado otro envío" : "Sin enviar"}</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Dialog>
      )}
      {/* Mounted only to open its own dialog with the chosen demo. */}
      {demo && (
        <span className="ah-hidden-send">
          <SendWhatsapp key={demo.id} demo={demo} label="Enviar demo" autoOpen onClosed={() => setChosen(null)} />
        </span>
      )}
    </>
  );
}

/** Opens the agency's WhatsApp chat, with `text` written when given. Disabled without a number. */
export function WhatsappContact({
  phone,
  label = "Contactar por WhatsApp",
  small = true,
  text,
}: {
  phone: string | null;
  label?: string;
  small?: boolean;
  text?: string;
}) {
  const to = normalizeArNumber(phone);
  if (!to)
    return (
      <button type="button" className={`button ${small ? "button-small " : ""}dm-whatsapp`} disabled title="Falta el WhatsApp de la inmobiliaria: cargalo en «Editar inmobiliaria»">
        <MessageCircle size={15} aria-hidden="true" /> {label}
      </button>
    );
  return (
    <a href={`https://wa.me/${to}${text ? `?text=${encodeURIComponent(text)}` : ""}`} target="_blank" rel="noreferrer" className={`button ${small ? "button-small " : ""}dm-whatsapp`}>
      <MessageCircle size={15} aria-hidden="true" /> {label}
    </a>
  );
}

/** WhatsApp's logo, for the list's compact button. */
function WhatsappLogo() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.9 11.9 0 0 0 4.6 4c1.7.7 2.4.8 3.2.7.5-.1 1.5-.6 1.8-1.2.2-.6.2-1.1.1-1.2l-.4-.2Z" />
    </svg>
  );
}

/** A compact button that copies a link and says «Copiado» for two seconds. */
function CopyChip({ label, icon, link, off, offTitle }: { label: string; icon: ReactNode; link: () => Promise<string>; off?: boolean; offTitle?: string }) {
  const [state, setState] = useState<"idle" | "busy" | "copied" | "error">("idle");
  async function copy() {
    setState("busy");
    try {
      const ok = await copyLinkWhenReady(link);
      setState(ok ? "copied" : "error");
    } catch {
      setState("error");
    }
    setTimeout(() => setState("idle"), 2000);
  }
  return (
    <button
      type="button"
      className={`ah-chip${state === "copied" ? " is-done" : ""}${state === "error" ? " is-error" : ""}`}
      disabled={off || state === "busy"}
      title={off ? offTitle : `Copiar el link: ${label.toLowerCase()}`}
      onClick={() => void copy()}
    >
      {state === "copied" ? <Check size={16} aria-hidden="true" /> : icon}
      <span aria-live="polite">{state === "copied" ? "Copiado" : state === "error" ? "No se pudo" : label}</span>
    </button>
  );
}

/**
 * The list's quick actions, made for the phone: WhatsApp (just its logo, with
 * «¡Buenas!» written), copy the agency's demo link and copy its panel link.
 */
export function RowQuickActions({ agencyId, name, phone, demo, claimed }: { agencyId: string; name: string; phone: string | null; demo: { id: string; token: string } | null; claimed: boolean }) {
  const to = normalizeArNumber(phone);
  const panel = `/api/admin/inmobiliarias/${agencyId}/enlace-panel`;
  return (
    <>
      {to ? (
        <a className="ah-wa" href={`https://wa.me/${to}?text=${encodeURIComponent("¡Buenas!")}`} target="_blank" rel="noreferrer" aria-label={`Escribir a ${name} por WhatsApp`} title="Escribir por WhatsApp">
          <WhatsappLogo />
        </a>
      ) : (
        <span className="ah-wa is-off" role="img" aria-label="Falta su WhatsApp" title="Falta su WhatsApp: cargalo en «Editar inmobiliaria»">
          <WhatsappLogo />
        </span>
      )}
      <CopyChip
        label="Demo"
        icon={<Link2 size={16} aria-hidden="true" />}
        off={!demo}
        offTitle="Todavía no tiene una demo publicada"
        link={() => linkOf({ id: demo!.id, token: demo!.token, agencyClaimed: claimed }, "agency")}
      />
      <CopyChip
        label="Panel"
        icon={<KeyRound size={16} aria-hidden="true" />}
        link={async () => (await api<{ url: string }>(panel, { method: "POST", body: "{}" })).url}
      />
    </>
  );
}

/**
 * The list's demo step, changeable by hand while it is «Creada» or «Enviada»:
 * «Enviada» marks every unsent demo of the agency as sent (one sent demo is
 * enough for the commercial cycle); «Creada» unmarks them all. The later steps
 * come from what the agency did, so they are not offered. A popover on the
 * computer, a sheet from the bottom on the phone.
 */
export function DemoStepMenu({ name, step, label, demos }: { name: string; step: 0 | 1; label: string; demos: { id: string; sent: boolean }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Where the popover goes on the computer: fixed under the button, so the table's scroll does not cut it.
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  function toggle(e: ReactMouseEvent<HTMLButtonElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    setAt({ top: Math.min(r.bottom + 6, window.innerHeight - 300), left: Math.min(r.left, window.innerWidth - 300) });
    setOpen(!open);
  }
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onScroll = () => setOpen(false);
    window.addEventListener("scroll", onScroll, true);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  async function choose(next: 0 | 1) {
    if (next === step) return setOpen(false);
    setBusy(true);
    setError("");
    try {
      const targets = demos.filter((d) => (next === 1 ? !d.sent : d.sent));
      for (const d of targets)
        await api(`/api/admin/demos/${d.id}`, { method: "PATCH", body: JSON.stringify({ action: "sent", sent: next === 1, via: "manual" }) });
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos cambiar el estado.");
    } finally {
      setBusy(false);
    }
  }
  const options = [
    { value: 0 as const, title: "Creada", help: "Todavía no se la mandamos" },
    { value: 1 as const, title: "Enviada", help: "Ya se la mandamos (por WhatsApp u otro medio)" },
  ];
  return (
    <div className={`ah-stepmenu${open ? " is-open" : ""}`} ref={ref}>
      <button
        type="button"
        className={`ah-demo-step is-step-${step} is-button`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        title="Cambiar el estado de la demo"
        onClick={toggle}
      >
        {label} <ChevronDown size={13} aria-hidden="true" />
      </button>
      {open && (
        <>
          <div className="ah-stepmenu-dim" aria-hidden="true" onClick={() => setOpen(false)} />
          <div id={id} className="ah-stepmenu-pop" role="dialog" style={at ? ({ "--at-top": `${at.top}px`, "--at-left": `${at.left}px` } as CSSProperties) : undefined} aria-label={`Estado de la demo de ${name}`}>
            <span className="ah-stepmenu-grab" aria-hidden="true" />
            <p className="ah-stepmenu-title">
              <strong>Demo de {name}</strong>
              <span>¿En qué estado está?</span>
            </p>
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={step === o.value}
                className={`ah-stepmenu-opt${step === o.value ? " is-on" : ""}`}
                disabled={busy}
                onClick={() => void choose(o.value)}
              >
                <span className="ah-stepmenu-dot" aria-hidden="true" />
                <span>
                  <strong>{o.title}</strong>
                  <small>{o.help}</small>
                </span>
              </button>
            ))}
            {error && (
              <span className="inline-error" role="alert">
                {error}
              </span>
            )}
            <p className="ah-stepmenu-note">Con visita, interacción, cuenta y suscripción se marcan solos.</p>
            <button type="button" className="ah-stepmenu-cancel" onClick={() => setOpen(false)}>
              {busy ? "Guardando…" : "Cancelar"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** The recommended next step's button, by its kind. */
export function NextActionButton({
  action,
  agencyId,
  demos,
  phone,
}: {
  action: NextAction;
  agencyId: string;
  demos: DemoSummary[];
  phone: string | null;
}) {
  const base = `/admin/inmobiliarias/${agencyId}`;
  if (action.kind === "new_property")
    return (
      <Link href={`${base}/propiedades/nueva?${new URLSearchParams({ volver: base })}`} className="button button-small button-primary">
        {action.cta}
      </Link>
    );
  if (action.kind === "publish")
    return (
      <Link href={`${base}?pestana=propiedades`} className="button button-small button-primary">
        {action.cta}
      </Link>
    );
  if (action.kind === "send_demo") return <SendDemo demos={demos} />;
  if (action.kind === "support") return <SupportOpen agencyId={agencyId} />;
  return <WhatsappContact phone={phone} label={action.cta} />;
}

/** «Ver como cliente» as a button (read only, one hour, audited). */
function SupportOpen({ agencyId }: { agencyId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <button
        type="button"
        className="button button-small button-primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const { url } = await api<{ url: string }>(`/api/admin/inmobiliarias/${agencyId}/soporte`, { method: "POST", body: JSON.stringify({ mode: "view" }) });
            window.location.assign(url);
          } catch (e) {
            setError(e instanceof Error ? e.message : "No pudimos abrir su panel.");
            setBusy(false);
          }
        }}
      >
        {busy ? "Abriendo…" : "Ver como cliente"}
      </button>
      {error && (
        <span className="inline-error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* «Propiedades y demos»                                               */
/* ------------------------------------------------------------------ */

/** A demo's secondary actions: see it, publish or unpublish, mark as sent, delete. */
export function DemoMenu({ demo }: { demo: DemoSummary }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function act(action: "publish" | "unpublish" | "delete" | "sent" | "unsent") {
    if (action === "delete" && !window.confirm(`¿Eliminar «${demo.title}»? El enlace deja de funcionar y se borran sus fotos. La inmobiliaria se conserva.`)) return;
    setBusy(true);
    setError("");
    try {
      if (action === "delete") await api(`/api/admin/demos/${demo.id}`, { method: "DELETE" });
      else if (action === "sent" || action === "unsent")
        await api(`/api/admin/demos/${demo.id}`, { method: "PATCH", body: JSON.stringify({ action: "sent", sent: action === "sent", via: "manual" }) });
      else await api(`/api/admin/demos/${demo.id}`, { method: "PATCH", body: JSON.stringify({ action }) });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos guardar.");
    } finally {
      setBusy(false);
    }
  }
  const live = demo.status === "published";
  return (
    <>
      <MoreMenu label={`Más acciones de ${demo.title}`}>
        <span className="ah-menu-item">
          <ViewLink demo={demo} which="buyer" /> <small>Vista comprador</small>
        </span>
        {demo.kind !== "fotos" && (
          <button type="button" disabled={busy} onClick={() => void act(live ? "unpublish" : "publish")}>
            {live ? "Despublicar" : "Publicar"}
          </button>
        )}
        {live && (
          <button type="button" disabled={busy} onClick={() => void act(demo.sentAt ? "unsent" : "sent")}>
            {demo.sentAt ? "Deshacer «enviada»" : "Marcar como enviada"}
          </button>
        )}
        <button type="button" className="is-danger" disabled={busy} onClick={() => void act("delete")}>
          Eliminar demo
        </button>
      </MoreMenu>
      {error && (
        <span className="inline-error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* «Enlaces»                                                           */
/* ------------------------------------------------------------------ */

const LINKS = [
  { which: "agency", icon: Building2, title: "Demo para inmobiliaria", help: "La experiencia comercial con IA: antes y después, estilos y su invitación." },
  { which: "buyer", icon: Home, title: "Vista comprador", help: "La ficha interactiva para compartir con sus clientes." },
  { which: "prices", icon: Tag, title: "Página de precios", help: "Los planes y beneficios de habita, dentro de su demo." },
] as const;

/**
 * «Acceso al panel»: the agency's fixed link (docs/ACCESO_PANEL.md). It does
 * not depend on any demo and is always the same; «Cambiar enlace» replaces it
 * and the previous one stops working.
 */
function PanelLinkRow({ agencyId }: { agencyId: string }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const endpoint = `/api/admin/inmobiliarias/${agencyId}/enlace-panel`;
  useEffect(() => {
    let alive = true;
    api<{ url: string }>(endpoint, { method: "POST", body: "{}" })
      .then((r) => alive && setUrl(r.url))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "No pudimos cargar el enlace."));
    return () => {
      alive = false;
    };
  }, [endpoint]);
  async function copy() {
    setError("");
    try {
      const ok = await copyLinkWhenReady(async () => url || (await api<{ url: string }>(endpoint, { method: "POST", body: "{}" })).url);
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos copiar el enlace.");
    }
  }
  async function rotate() {
    if (!window.confirm("¿Cambiar el enlace al panel? El enlace actual deja de funcionar y hay que mandarles el nuevo.")) return;
    setBusy(true);
    setError("");
    try {
      setUrl((await api<{ url: string }>(endpoint, { method: "POST", body: JSON.stringify({ rotate: true }) })).url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos cambiar el enlace.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <li>
      <span className="ah-link-icon" aria-hidden="true">
        <KeyRound size={20} />
      </span>
      <span className="ah-link-main">
        <strong>Acceso al panel</strong>
        <small>Abre el Inicio de su panel: pueden iniciar sesión, crear la cuenta o recorrerlo como invitados. Siempre es el mismo enlace.</small>
        {url && <code className="ah-link-url">{url.replace(/^https?:\/\//, "")}</code>}
        {error && (
          <span className="inline-error" role="alert">
            {error}
          </span>
        )}
      </span>
      <span className="ah-link-actions">
        <a
          className="dm-text"
          href={url || undefined}
          aria-disabled={!url}
          target="_blank"
          rel="noreferrer"
          data-view="panel"
          title="Lo abrís como equipo: ves su panel en la vista de soporte (solo lectura). Queda registrado."
        >
          Ver
        </a>
        <button type="button" className="dm-text" data-link="panel" disabled={!url} onClick={() => void copy()}>
          {copied ? "Copiado" : "Copiar link"}
        </button>
        <button type="button" className="dm-text is-danger" disabled={busy || !url} onClick={() => void rotate()}>
          {busy ? "Cambiando…" : "Cambiar enlace"}
        </button>
      </span>
    </li>
  );
}

/**
 * The agency's links: its fixed panel link, and the three links of one demo,
 * each with «Ver» and «Copiar». The demo links that invite the agency carry
 * a fresh one-time code while it has no account.
 */
export function AgencyLinks({ agencyId, demos }: { agencyId: string; demos: DemoSummary[] }) {
  const published = demos.filter((d) => d.status === "published");
  const [id, setId] = useState(published[0]?.id ?? "");
  const demo = published.find((d) => d.id === id) ?? published[0];
  return (
    <div className="ah-links">
      <ul className="ah-link-list">
        <PanelLinkRow agencyId={agencyId} />
      </ul>
      {!demo ? (
        <p className="aa-empty">
          <Link2 size={16} aria-hidden="true" /> Los enlaces de cada demo aparecen cuando tenga una demo publicada.
        </p>
      ) : (
        <>
          {published.length > 1 && (
            <label className="ah-links-pick">
              Demo
              <select value={demo.id} onChange={(e) => setId(e.target.value)}>
                {published.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          <ul className="ah-link-list">
            {LINKS.map(({ which, icon: Icon, title, help }) => (
              <li key={which}>
                <span className="ah-link-icon" aria-hidden="true">
                  <Icon size={20} />
                </span>
                <span className="ah-link-main">
                  <strong>{title}</strong>
                  <small>{help}</small>
                </span>
                <span className="ah-link-actions">
                  <ViewLink demo={demo} which={which} />
                  <LinkCopy demo={demo} which={which} />
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* «Actividad»                                                         */
/* ------------------------------------------------------------------ */

/** The visitor-by-visitor detail of the old «Leads» page (marking the team's devices, the timeline). */
export function VisitorDetail({ agencyId }: { agencyId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <details className="account-panel ah-visitors" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>Detalle por visitante y cronología</summary>
      {open && <AgencyView id={agencyId} onChanged={async () => router.refresh()} />}
    </details>
  );
}

/** «Recalcular lead scores»: the audit recalculation of every demo, from the old «Leads» page. */
export function RecalcScores() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  return (
    <p className="ah-recalc">
      <button
        type="button"
        className="text-link"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setNote("");
          try {
            await api("/api/admin/leads/recalcular", { method: "POST" });
            setNote("Lead scores recalculados.");
            router.refresh();
          } catch (e) {
            setNote(e instanceof Error ? e.message : "No pudimos recalcular.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Recalculando…" : "Recalcular lead scores"}
      </button>
      {note && <span role="status"> · {note}</span>}
    </p>
  );
}
