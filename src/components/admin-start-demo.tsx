"use client";
// «Crear demostración interactiva» for an agency, by the team: the agency is
// created first (Nueva inmobiliaria), then this same flow of the agency's own
// panel opens inside the tab's signed edit context. The three ways in
// (existing property, listing URL, photos) and the three-tab editor are the
// panel's own: one infrastructure, tested by the team before the agencies use it.
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "./admin-demos";
import { AdminEditBanner, useAgencyEdit } from "./admin-edit-context";
import { StartPicker } from "./start-picker";
import { safeReturn } from "@/lib/agency/shared";
import type { AgencyRow } from "@/lib/demos/shared";

export function AgencyStartDemo({ agency }: { agency: { id: string; name: string; hasOwner: boolean } }) {
  const edit = useAgencyEdit(agency.id);
  const params = useSearchParams();
  const back = safeReturn(params.get("volver"), `/admin/inmobiliarias/${agency.id}/editar`);
  const created = params.get("creada") === "1";
  // Closed without choosing: the picker can be opened again from here.
  const [open, setOpen] = useState(true);
  const ready = edit.state.status === "active" || edit.state.status === "expired";
  return (
    <div className="account-page container dm-page np-page">
      <AdminEditBanner agencyName={agency.name} edit={edit} backHref={back} backLabel="Cancelar y volver" exitHref={`/admin/inmobiliarias?abierta=${agency.id}`} />
      <div className="dm-heading">
        <div>
          <span className="eyebrow">{agency.name} / Nueva demostración</span>
          <h1>
            Crear demostración interactiva<span className="accent">.</span>
          </h1>
          <p>El mismo flujo que usa la inmobiliaria en su panel: elegí cómo empezar y seguí en el editor.</p>
        </div>
      </div>
      {created && (
        <p className="inline-notice" role="status">
          Inmobiliaria creada. No se creó ninguna cuenta ni se envió ninguna invitación, y no tiene créditos: eso se hace desde su ficha.
        </p>
      )}
      {edit.state.status === "starting" && <p role="status">Abriendo la edición…</p>}
      {ready && !open && (
        <div className="na-next">
          <button type="button" className="button button-primary" onClick={() => setOpen(true)}>
            Elegir cómo empezar
          </button>
          <Link href={`/admin/inmobiliarias/${agency.id}/propiedades/nueva?${new URLSearchParams({ modo: "manual", volver: back })}`} className="button button-outline">
            Cargar los datos a mano
          </Link>
          <Link href={back} className="button button-outline">
            Continuar más tarde
          </Link>
        </div>
      )}
      {/* Opened once the context is there: every request of the picker carries it. */}
      {ready && open && (
        <StartPicker
          tool="demo"
          existingCount={0}
          team={{ agencyId: agency.id, agencyName: agency.name, back }}
          onClose={() => setOpen(false)}
        />
      )}
      <p className="dm-help">Importar o subir fotos no genera imágenes ni consume créditos.</p>
    </div>
  );
}

/**
 * «Nueva demo» from the team's list of demos: first the agency (one already
 * loaded, or a new one), then the panel's own flow for it.
 */
export function DemoAgencyChooser() {
  const [agencies, setAgencies] = useState<AgencyRow[] | null>(null);
  const [agencyId, setAgencyId] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    api<{ agencies: AgencyRow[] }>("/api/admin/demos")
      .then((d) => setAgencies(d.agencies))
      .catch((e) => setError(e instanceof Error ? e.message : "No pudimos cargar las inmobiliarias."));
  }, []);
  const next = agencyId
    ? `/admin/inmobiliarias/${agencyId}/propiedades/nueva?${new URLSearchParams({ volver: `/admin/inmobiliarias/${agencyId}/editar` })}`
    : null;
  return (
    <div className="account-page container dm-page dm-narrow">
      <Link href="/admin/inmobiliarias" className="text-link">
        ← Inmobiliarias
      </Link>
      <h1>
        Nueva demo<span className="accent">.</span>
      </h1>
      <p>Primero la inmobiliaria; después, el mismo flujo de «Crear demostración interactiva» de su panel.</p>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <section className="account-panel">
        <h2>Una inmobiliaria que ya cargamos</h2>
        {!agencies && !error && <p role="status">Cargando inmobiliarias…</p>}
        {agencies && agencies.length > 0 && (
          <form
            className="na-next"
            onSubmit={(e) => {
              e.preventDefault();
              if (next) window.location.assign(next);
            }}
          >
            <label className="dm-select">
              Elegí la inmobiliaria
              <select required value={agencyId} onChange={(e) => setAgencyId(e.target.value)}>
                <option value="">Elegir…</option>
                {agencies.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="button button-primary" disabled={!next}>
              Continuar
            </button>
          </form>
        )}
        {agencies && !agencies.length && <p className="dm-help">Todavía no hay inmobiliarias cargadas.</p>}
      </section>
      <section className="account-panel">
        <h2>Una inmobiliaria nueva</h2>
        <p className="dm-help">Se crea su ficha (sin cuenta, sin invitación, sin créditos) y enseguida seguís con su primera demo.</p>
        <Link href="/admin/inmobiliarias/nueva" className="button button-outline">
          Crear inmobiliaria
        </Link>
      </section>
    </div>
  );
}
