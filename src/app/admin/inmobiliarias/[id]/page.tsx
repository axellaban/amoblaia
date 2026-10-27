import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AgencyCredits, AgencyInvitations, AgencyProperties, SupportViewButton } from "@/components/admin-agencies";
import { HttpError } from "@/lib/commerce/http";
import { adminAgency } from "@/lib/agency/admin";
import { agencyStage, STAGE_LABEL } from "@/lib/agency/stage";
import { requireAdminPage } from "@/lib/demos/admin-page";
import { isUuid } from "@/lib/demos/shared";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Inmobiliaria",
  robots: { index: false, follow: false },
};

const date = (iso: string) => new Date(iso).toLocaleDateString("es-AR");

/** One agency for the team: its account, invitations, imports and notes. Editing happens in "Editar inmobiliaria". */
export default async function AgencyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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
  if (!data)
    return (
      <div className="account-page container dm-page">
        <div className="account-panel" role="alert">
          <h2>No pudimos cargar la inmobiliaria</h2>
          <p>Probá de nuevo en unos segundos.</p>
          <Link href={`/admin/inmobiliarias/${id}`} className="button button-small">
            Reintentar
          </Link>
        </div>
      </div>
    );
  const { agency, counts } = data;
  const pending = data.claims.find((c) => c.state === "pending");
  const stage = agencyStage({ hasOwner: agency.hasOwner, claimedAt: agency.claimedAt, liveClaimExpires: pending?.expiresAt ?? null, published: counts.published });
  return (
    <div className="account-page container dm-page">
      <p className="aa-back">
        <Link href="/admin/inmobiliarias" className="text-link">
          ← Inmobiliarias
        </Link>
      </p>
      <div className="dm-heading">
        <div>
          <span className="eyebrow">Inmobiliaria</span>
          <h1>
            {agency.name}
            <span className="accent">.</span>
          </h1>
          <p>
            <span className={`dm-status ${stage === "live" ? "is-live" : ""}`}>{STAGE_LABEL[stage]}</span>{" "}
            {agency.hasOwner
              ? agency.claimedAt
                ? `Reclamó su cuenta el ${date(agency.claimedAt)}.`
                : "Creó su cuenta directamente desde el panel."
              : "Todavía no tiene cuenta en habita."}
          </p>
        </div>
        <div className="dm-heading-actions">
          <Link href={`/admin/inmobiliarias/${agency.id}/editar`} className="button button-primary">
            Editar inmobiliaria →
          </Link>
          <SupportViewButton agencyId={agency.id} small={false} />
          {agency.slug && agency.sitePublished && (
            <a href={`/inmobiliaria/${agency.slug}`} className="button button-outline" target="_blank" rel="noreferrer">
              Ver catálogo público
            </a>
          )}
        </div>
      </div>

      <dl className="aa-stats">
        <div>
          <dt>Propiedades</dt>
          <dd>{counts.total}</dd>
        </div>
        <div>
          <dt>Publicadas</dt>
          <dd>{counts.published}</dd>
        </div>
        <div>
          <dt>Con ambientación</dt>
          <dd>{counts.staged}</dd>
        </div>
        <div>
          <dt>En revisión</dt>
          <dd>{counts.review}</dd>
        </div>
      </dl>

      <AgencyCredits agency={{ id: agency.id, name: agency.name, hasOwner: agency.hasOwner }} credits={data.credits} />

      <AgencyInvitations agencyId={agency.id} claims={data.claims} hasOwner={agency.hasOwner} />

      <section className="account-panel aa-section" aria-labelledby="aa-imports">
        <h2 id="aa-imports">Importaciones para revisar</h2>
        {data.imports.length ? (
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
                  <Link href={`/admin/inmobiliarias/${agency.id}/propiedades/${i.demoId}?seccion=publicacion&volver=${encodeURIComponent(`/admin/inmobiliarias/${agency.id}`)}`} className="button button-small button-outline">
                    Abrir
                  </Link>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="aa-empty">Nada pendiente.</p>
        )}
      </section>

      <section className="account-panel aa-section" aria-labelledby="aa-props">
        <div className="aa-section-head">
          <h2 id="aa-props">Propiedades ({data.propertiesTotal})</h2>
          <Link href={`/admin/inmobiliarias/${agency.id}/propiedades/nueva?volver=${encodeURIComponent(`/admin/inmobiliarias/${agency.id}`)}`} className="button button-small">
            Agregar propiedad
          </Link>
        </div>
        <AgencyProperties agencyId={agency.id} backTo={`/admin/inmobiliarias/${agency.id}`} />
      </section>

      <section className="account-panel aa-section" aria-labelledby="aa-team">
        <h2 id="aa-team">Equipo y notas internas</h2>
        <p className="aa-help">Las notas y el contacto son internos: nunca se muestran en el catálogo ni en las fichas.</p>
        <ul className="aa-list">
          {data.members.map((m, i) => (
            <li key={i}>
              <span className="dm-status">{m.role === "owner" ? "Dueño" : "Colaborador"}</span>
              <span>Desde el {date(m.since)}</span>
            </li>
          ))}
          {!data.members.length && <li>Sin cuentas todavía.</li>}
        </ul>
        {(agency.contactName || agency.notes) && (
          <dl className="aa-notes">
            {agency.contactName && (
              <>
                <dt>Contacto</dt>
                <dd>{agency.contactName}</dd>
              </>
            )}
            {agency.notes && (
              <>
                <dt>Notas</dt>
                <dd>{agency.notes}</dd>
              </>
            )}
          </dl>
        )}
      </section>
    </div>
  );
}
