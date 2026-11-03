"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  Check,
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
import { api, Dialog, LinkCopy, SendWhatsapp, ViewLink } from "@/components/admin-demos";
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

/** Opens the agency's WhatsApp chat (no text of ours). Disabled without a number. */
export function WhatsappContact({ phone, label = "Contactar por WhatsApp", small = true }: { phone: string | null; label?: string; small?: boolean }) {
  const to = normalizeArNumber(phone);
  if (!to)
    return (
      <button type="button" className={`button ${small ? "button-small " : ""}dm-whatsapp`} disabled title="Falta el WhatsApp de la inmobiliaria: cargalo en «Editar inmobiliaria»">
        <MessageCircle size={15} aria-hidden="true" /> {label}
      </button>
    );
  return (
    <a href={`https://wa.me/${to}`} target="_blank" rel="noreferrer" className={`button ${small ? "button-small " : ""}dm-whatsapp`}>
      <MessageCircle size={15} aria-hidden="true" /> {label}
    </a>
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
  { which: "panel", icon: KeyRound, title: "Acceso al panel", help: "Su panel, para que cree su cuenta y administre sus propiedades." },
  { which: "prices", icon: Tag, title: "Página de precios", help: "Los planes y beneficios de habita, dentro de su demo." },
] as const;

/**
 * The four links of one demo, each with «Ver» and «Copiar». The links that
 * invite the agency carry a fresh one-time code while it has no account.
 */
export function AgencyLinks({ demos }: { demos: DemoSummary[] }) {
  const published = demos.filter((d) => d.status === "published");
  const [id, setId] = useState(published[0]?.id ?? "");
  const demo = published.find((d) => d.id === id) ?? published[0];
  if (!demo)
    return (
      <p className="aa-empty">
        <Link2 size={16} aria-hidden="true" /> Los enlaces aparecen cuando tenga una demo publicada.
      </p>
    );
  return (
    <div className="ah-links">
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
              {which !== "panel" || demo.agencyClaimed !== true ? <LinkCopy demo={demo} which={which} /> : null}
            </span>
          </li>
        ))}
      </ul>
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
