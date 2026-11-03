import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, BarChart3, Eye, FileText, Home, ImageIcon, Link2, MousePointerClick, Plus, UserPlus, Users, Zap } from "lucide-react";
import { AgencyCredits, AgencyInvitations, SupportViewButton } from "@/components/admin-agencies";
import {
  AccountPill,
  AgencyLinks,
  AgencyThumb,
  DemoMenu,
  MoreMenu,
  NextActionButton,
  ScorePill,
  SendDemo,
  StagePill,
  VisitorDetail,
  WhatsappContact,
} from "@/components/admin-agency-hub";
import { AddToProspecting } from "@/components/prospecting/add-agency";
import { ClaimReviewNotice } from "@/components/admin-claim-review";
import { HttpError } from "@/lib/commerce/http";
import { adminAgency, agencyClaimInfo } from "@/lib/agency/admin";
import { COMMERCIAL_STAGES, STAGE_STEP, accountState, agoText, nextAction, stageIndex } from "@/lib/agency/commercial";
import { agencyActivity, commercialRow, demoScoresOf, type AgencyActivity } from "@/lib/agency/commercial-server";
import { ROLE_LABEL } from "@/lib/agency/shared";
import { agencyStage, STAGE_LABEL } from "@/lib/agency/stage";
import { requireAdminPage } from "@/lib/demos/admin-page";
import { listDemos } from "@/lib/demos/server";
import { stageOf } from "@/lib/demos/send";
import { isUuid, type DemoSummary } from "@/lib/demos/shared";
import { adminClient } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Inmobiliaria",
  robots: { index: false, follow: false },
};

const TABS = [
  { key: "resumen", label: "Resumen", icon: Home },
  { key: "propiedades", label: "Propiedades y demos", icon: FileText },
  { key: "enlaces", label: "Enlaces", icon: Link2 },
  { key: "actividad", label: "Actividad", icon: BarChart3 },
  { key: "cuenta", label: "Cuenta", icon: Users },
] as const;
type Tab = (typeof TABS)[number]["key"];

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
const date = (iso: string) => new Date(iso).toLocaleDateString("es-AR");

/** The agency's WhatsApp and the e-mail it claimed with: optional columns, unknown before their migrations. */
async function contactOf(id: string) {
  const { data, error } = await adminClient().from("agencies").select("contact_whatsapp,claim_email").eq("id", id).maybeSingle();
  if (error || !data) {
    const basic = await adminClient().from("agencies").select("contact_whatsapp").eq("id", id).maybeSingle();
    return { whatsapp: (basic.data as { contact_whatsapp: string | null } | null)?.contact_whatsapp ?? null, email: null };
  }
  const d = data as { contact_whatsapp: string | null; claim_email: string | null };
  return { whatsapp: d.contact_whatsapp, email: d.claim_email };
}

/**
 * One agency for the team, in five tabs: its commercial summary and funnel,
 * its properties and demos, the links to share, what visitors did, and its
 * account (invitations and credits). Each tab reads only what it shows.
 */
export default async function AgencyPage({ params, searchParams }: Props) {
  const { id } = await params;
  const raw = (await searchParams).pestana;
  const tab: Tab = TABS.find((t) => t.key === (Array.isArray(raw) ? raw[0] : raw))?.key ?? "resumen";
  await requireAdminPage(`/admin/inmobiliarias/${id}`);
  if (!isUuid(id)) notFound();
  let data: Awaited<ReturnType<typeof adminAgency>> | null = null;
  let missing = false;
  try {
    data = await adminAgency(id);
  } catch (e) {
    missing = e instanceof HttpError && e.status === 404;
  }
  if (missing) notFound();
  const [row, demoList, contact] = data
    ? await Promise.all([commercialRow(id).catch(() => null), listDemos(id).catch(() => null), contactOf(id).catch(() => ({ whatsapp: null, email: null }))])
    : [null, null, null];
  if (!data || !row || !demoList || !contact)
    return (
      <div className="ah-page">
        <div className="account-panel" role="alert">
          <h2>No pudimos cargar la inmobiliaria</h2>
          <p>Probá de nuevo en unos segundos.</p>
          <Link href={`/admin/inmobiliarias/${id}`} className="button button-small">
            Reintentar
          </Link>
        </div>
      </div>
    );
  const { agency } = data;
  const demos = demoList.demos;
  const base = `/admin/inmobiliarias/${agency.id}`;
  const action = nextAction(row.stage, { total: demos.length, published: demos.filter((d) => d.status === "published").length });
  // Only what the open tab shows is read.
  const [scores, activity, claim] = await Promise.all([
    tab === "propiedades" ? demoScoresOf(agency.id, demos.map((d) => d.id)).catch(() => ({}) as Record<string, number | null>) : {},
    tab === "actividad" ? agencyActivity(agency.id).catch(() => null) : null,
    tab === "cuenta" && agency.hasOwner ? agencyClaimInfo(agency.id).catch(() => null) : null,
  ]);

  return (
    <div className="ah-page">
      <p className="ah-back">
        <Link href="/admin/inmobiliarias">
          <ArrowLeft size={15} aria-hidden="true" /> Inmobiliarias
        </Link>
      </p>
      <header className="ah-detail-head">
        <AgencyThumb photoId={row.coverPhotoId} size="large" />
        <div className="ah-detail-title">
          <h1>{agency.name}</h1>
          <p>
            Estado: {STAGE_STEP[row.stage]} · {accountState(row) === "none" ? "Sin cuenta" : accountState(row) === "active" ? "Cuenta activa" : "Cuenta registrada"} · Lead
            score: {row.score === null ? "—" : `${row.score} / 100`}
          </p>
        </div>
        <div className="ah-detail-actions">
          <SendDemo demos={demos} />
          <Link href={`${base}?pestana=enlaces`} className="button button-small button-outline">
            <Link2 size={15} aria-hidden="true" /> Ver enlaces
          </Link>
          <MoreMenu label="Más acciones de la inmobiliaria">
            <Link href={`${base}/editar?${new URLSearchParams({ volver: base })}`}>Editar inmobiliaria</Link>
            <Link href={`${base}/propiedades/nueva?${new URLSearchParams({ volver: `${base}?pestana=propiedades` })}`}>Nueva propiedad</Link>
            <SupportViewButton agencyId={agency.id} quiet />
            <SupportViewButton agencyId={agency.id} quiet act />
            {agency.slug && agency.sitePublished && (
              <a href={`/inmobiliaria/${agency.slug}`} target="_blank" rel="noreferrer">
                Ver catálogo público
              </a>
            )}
            {!row.prospect && <AddToProspecting agencyId={agency.id} />}
            {row.prospect && <Link href="/admin/prospeccion?vista=prospectos">Ver en Adquisición</Link>}
          </MoreMenu>
        </div>
      </header>

      <nav className="ah-detail-tabs" aria-label="Secciones de la inmobiliaria">
        {TABS.map(({ key, label, icon: Icon }) => (
          <Link key={key} href={key === "resumen" ? base : `${base}?pestana=${key}`} className={tab === key ? "is-on" : undefined} aria-current={tab === key ? "page" : undefined}>
            <Icon size={16} aria-hidden="true" /> {label}
          </Link>
        ))}
      </nav>

      {tab === "resumen" && <Summary data={data} row={row} action={action} demos={demos} phone={contact.whatsapp} />}
      {tab === "propiedades" && <Properties agencyId={agency.id} demos={demos} scores={scores} />}
      {tab === "enlaces" && (
        <section className="account-panel ah-panel" aria-labelledby="ah-links-title">
          <h2 id="ah-links-title">Enlaces de esta inmobiliaria</h2>
          <AgencyLinks demos={demos} />
        </section>
      )}
      {tab === "actividad" && <Activity agencyId={agency.id} hasOwner={agency.hasOwner} activity={activity} />}
      {tab === "cuenta" && <Account data={data} row={row} contact={contact} claim={claim} />}
    </div>
  );
}

type Data = Awaited<ReturnType<typeof adminAgency>>;
type Row = NonNullable<Awaited<ReturnType<typeof commercialRow>>>;

function Summary({ data, row, action, demos, phone }: { data: Data; row: Row; action: ReturnType<typeof nextAction>; demos: DemoSummary[]; phone: string | null }) {
  const { agency } = data;
  const reached = stageIndex(row.stage);
  return (
    <>
      <div className="ah-summary">
        <section className="account-panel ah-panel" aria-labelledby="ah-sum-title">
          <h2 id="ah-sum-title">Resumen comercial</h2>
          <dl className="ah-facts">
            <div>
              <dt>Estado del funnel</dt>
              <dd>
                <StagePill stage={row.stage} />
              </dd>
            </div>
            <div>
              <dt>Lead score</dt>
              <dd>
                <ScorePill score={row.score} />
              </dd>
            </div>
            <div>
              <dt>Cuenta habita</dt>
              <dd>
                <AccountPill state={accountState(row)} />
              </dd>
            </div>
            <div>
              <dt>Propiedades</dt>
              <dd>
                {row.properties}
                {row.properties ? <small> · {row.published} publicadas</small> : null}
              </dd>
            </div>
            <div>
              <dt>Última actividad</dt>
              <dd>{row.lastActivity ? `${agoText(row.lastActivity.at)} · ${row.lastActivity.text}` : "—"}</dd>
            </div>
          </dl>
        </section>
        <section className="account-panel ah-panel" aria-labelledby="ah-funnel-title">
          <h2 id="ah-funnel-title">Funnel de la inmobiliaria</h2>
          <ol className="ah-funnel" aria-label={`Etapa actual: ${STAGE_STEP[row.stage]}`}>
            {COMMERCIAL_STAGES.map((s, i) => (
              <li key={s} className={i < reached ? "is-done" : i === reached ? "is-current" : undefined} aria-current={i === reached ? "step" : undefined}>
                <span className="ah-funnel-dot" aria-hidden="true" />
                <span>{STAGE_STEP[s]}</span>
              </li>
            ))}
          </ol>
          <div className="ah-next">
            <Zap size={20} aria-hidden="true" />
            <span>
              <strong>Próxima acción recomendada</strong>
              <small>{action.text}</small>
            </span>
            <NextActionButton action={action} agencyId={agency.id} demos={demos} phone={phone} />
          </div>
        </section>
      </div>
      {data.imports.length > 0 && (
        <section className="account-panel ah-panel" aria-labelledby="aa-imports">
          <h2 id="aa-imports">Importaciones para revisar</h2>
          <ul className="aa-list">
            {data.imports.map((i) => (
              <li key={i.id}>
                <span className="dm-status">{i.status === "partial" ? "Parcial" : "Fallida"}</span>
                <span className="aa-url">
                  {i.url}
                  <small>
                    {date(i.createdAt)}
                    {i.status === "partial" && i.photosTotal ? ` · ${i.photosDone} de ${i.photosTotal} fotos` : ""}
                    {!i.settingsSaved ? " · faltan los datos de la ficha" : ""}
                    {i.error ? ` · ${i.error}` : ""}
                  </small>
                </span>
                {i.demoId && (
                  <Link
                    href={`/admin/inmobiliarias/${agency.id}/propiedades/${i.demoId}?seccion=publicacion&volver=${encodeURIComponent(`/admin/inmobiliarias/${agency.id}`)}`}
                    className="button button-small button-outline"
                  >
                    Abrir
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="account-panel ah-panel" aria-labelledby="ah-notes-title">
        <div className="aa-section-head">
          <h2 id="ah-notes-title">Notas internas</h2>
          <Link href={`/admin/inmobiliarias/${agency.id}/editar?${new URLSearchParams({ volver: `/admin/inmobiliarias/${agency.id}` })}`} className="button button-small button-outline">
            Editar
          </Link>
        </div>
        {agency.notes ? <p className="ah-notes">{agency.notes}</p> : <p className="aa-empty">Sin notas. Solo el equipo las ve.</p>}
      </section>
    </>
  );
}

/** A demo's chips: published or draft, and how far its follow-up went. */
function DemoChips({ demo }: { demo: DemoSummary }) {
  if (demo.kind === "fotos") return <span className="ah-pill ah-chip is-draft">Fotos importadas</span>;
  const stage = stageOf(demo.sentAt ?? null, demo.activity.level);
  if (demo.status !== "published")
    return (
      <span className="ah-pill ah-chip is-draft">
        <span className="ah-dot" aria-hidden="true" /> Borrador
      </span>
    );
  return (
    <span className="ah-chips">
      {stage >= 1 ? <StagePill stage="demo_sent" /> : <span className="ah-pill ah-chip is-live">✓ Publicada</span>}
      {stage >= 2 && <StagePill stage="interacted" />}
    </span>
  );
}

function Properties({ agencyId, demos, scores }: { agencyId: string; demos: DemoSummary[]; scores: Record<string, number | null> }) {
  const base = `/admin/inmobiliarias/${agencyId}`;
  const back = `${base}?pestana=propiedades`;
  return (
    <section className="account-panel ah-panel" aria-labelledby="ah-props-title">
      <div className="aa-section-head">
        <h2 id="ah-props-title">Propiedades ({demos.length})</h2>
        <Link href={`${base}/propiedades/nueva?${new URLSearchParams({ volver: back })}`} className="button button-small button-primary">
          <Plus size={15} aria-hidden="true" /> Nueva propiedad
        </Link>
      </div>
      {!demos.length ? (
        <p className="aa-empty">Todavía no tiene propiedades. Creá la primera para armar su demo.</p>
      ) : (
        <ul className="ah-props">
          {demos.map((d) => (
            <li key={d.id}>
              <AgencyThumb photoId={d.cover?.id ?? d.coverPhotoId} size="large" />
              <span className="ah-prop-main">
                <strong>{d.title}</strong>
                <small>{d.propertyLocation || d.propertyTitle || " "}</small>
              </span>
              <DemoChips demo={d} />
              <span className="ah-visits" title="Personas que abrieron la demo (sin el equipo)">
                <Eye size={16} aria-hidden="true" /> {d.activity.visitors} {d.activity.visitors === 1 ? "visita" : "visitas"}
              </span>
              <ScorePill score={scores[d.id] ?? null} compact />
              <Link href={`${base}/propiedades/${d.id}?${new URLSearchParams({ volver: back })}`} className="button button-small button-outline">
                Editar <ArrowRight size={15} aria-hidden="true" />
              </Link>
              <DemoMenu demo={d} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Activity({ agencyId, hasOwner, activity: a }: { agencyId: string; hasOwner: boolean; activity: AgencyActivity | null }) {
  if (!a)
    return (
      <section className="account-panel ah-panel">
        <h2>Actividad y engagement</h2>
        <p className="aa-empty">Todavía no hay actividad registrada de sus demos (o faltan las migraciones del lead score).</p>
      </section>
    );
  const kpis = [
    { icon: Eye, value: a.visits, label: "Visitas totales" },
    { icon: MousePointerClick, value: a.interactions, label: "Interacciones", sub: "estilos, fotos, slider" },
    { icon: ImageIcon, value: a.generated, label: "Imágenes generadas" },
    { icon: UserPlus, value: hasOwner ? Math.max(1, a.signups) : a.signups, label: "Registro de cuenta" },
  ];
  return (
    <>
      <section className="account-panel ah-panel" aria-labelledby="ah-act-title">
        <h2 id="ah-act-title">Actividad y engagement</h2>
        <div className="ah-kpis">
          <div className="ah-kpi is-score">
            <small>Lead score</small>
            <ScorePill score={a.score} />
          </div>
          {kpis.map(({ icon: Icon, value, label, sub }) => (
            <div key={label} className="ah-kpi">
              <Icon size={20} aria-hidden="true" />
              <strong>{value}</strong>
              <small>
                {label}
                {sub && <i> ({sub})</i>}
              </small>
            </div>
          ))}
        </div>
        {a.capped && <p className="dm-help">Cuenta los últimos 400 eventos de visitantes externos.</p>}
        <div className="ah-act-grid">
          <div>
            <h3>Actividad reciente</h3>
            {a.recent.length ? (
              <ol className="ah-timeline">
                {a.recent.map((r, i) => (
                  <li key={i}>
                    <span>
                      {r.text} <small>· {r.demo}</small>
                    </span>
                    <time dateTime={r.at}>{agoText(r.at)}</time>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="aa-empty">Nadie fuera del equipo abrió sus demos todavía.</p>
            )}
          </div>
          <div>
            <h3>Por propiedad</h3>
            {a.byDemo.length ? (
              <ul className="ah-by-demo">
                {a.byDemo.map((d) => (
                  <li key={d.id}>
                    <span>{d.title}</span>
                    <ScorePill score={d.score} compact />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="aa-empty">Sin demos.</p>
            )}
          </div>
        </div>
      </section>
      <VisitorDetail agencyId={agencyId} />
    </>
  );
}

function Account({
  data,
  row,
  contact,
  claim,
}: {
  data: Data;
  row: Row;
  contact: { whatsapp: string | null; email: string | null };
  claim: Awaited<ReturnType<typeof agencyClaimInfo>>;
}) {
  const { agency } = data;
  const pending = data.claims.find((c) => c.state === "pending");
  const stage = agencyStage({ hasOwner: agency.hasOwner, claimedAt: agency.claimedAt, liveClaimExpires: pending?.expiresAt ?? null, published: data.counts.published });
  const credits = data.credits.balance ?? data.credits.pending;
  const editHref = `/admin/inmobiliarias/${agency.id}/editar?${new URLSearchParams({ volver: `/admin/inmobiliarias/${agency.id}?pestana=cuenta` })}`;
  return (
    <>
      {claim && <ClaimReviewNotice agencyId={agency.id} claim={claim} />}
      <div className="ah-summary">
        <section className="account-panel ah-panel" aria-labelledby="ah-acc-title">
          <h2 id="ah-acc-title">Cuenta y acceso</h2>
          <dl className="ah-facts">
            <div>
              <dt>Estado de cuenta</dt>
              <dd>
                <AccountPill state={accountState(row)} /> {stage !== "no-account" && <small>{STAGE_LABEL[stage]}</small>}
              </dd>
            </div>
            <div>
              <dt>Invitación enviada</dt>
              <dd>{agency.hasOwner ? "Usada" : pending ? `Sí, vence el ${date(pending.expiresAt)}` : data.claims.length ? "Vencida o revocada" : "No"}</dd>
            </div>
            <div>
              <dt>Créditos {agency.hasOwner ? "disponibles" : "reservados"}</dt>
              <dd>{credits ?? "No disponible"}</dd>
            </div>
            <div>
              <dt>Suscripción</dt>
              <dd>{row.subscribed ? "Activa" : "—"}</dd>
            </div>
            <div>
              <dt>Usuarios</dt>
              <dd>{data.members.length ? data.members.map((m) => ROLE_LABEL[m.role]).join(", ") : "—"}</dd>
            </div>
          </dl>
        </section>
        <section className="account-panel ah-panel" aria-labelledby="ah-contact-title">
          <div className="aa-section-head">
            <h2 id="ah-contact-title">Contactos</h2>
            <Link href={editHref} className="button button-small button-outline">
              Editar
            </Link>
          </div>
          <dl className="ah-facts">
            <div>
              <dt>Contacto</dt>
              <dd>{agency.contactName || "—"}</dd>
            </div>
            <div>
              <dt>WhatsApp</dt>
              <dd>{contact.whatsapp ? `+${contact.whatsapp}` : "—"}</dd>
            </div>
            {contact.email && (
              <div>
                <dt>Email de la cuenta</dt>
                <dd>{contact.email}</dd>
              </div>
            )}
            {agency.website && (
              <div>
                <dt>Sitio</dt>
                <dd>
                  <a href={agency.website.startsWith("http") ? agency.website : `https://${agency.website}`} target="_blank" rel="noreferrer" className="text-link">
                    {agency.website}
                  </a>
                </dd>
              </div>
            )}
          </dl>
          <WhatsappContact phone={contact.whatsapp} label="Escribir por WhatsApp" />
        </section>
      </div>
      <AgencyInvitations agencyId={agency.id} claims={data.claims} hasOwner={agency.hasOwner} />
      <AgencyCredits agency={{ id: agency.id, name: agency.name, hasOwner: agency.hasOwner }} credits={data.credits} />
    </>
  );
}
