"use client";
// A property of the agency the team is editing: the shared editor, with the
// edit banner on top and every write sent with this tab's context.
import { useSearchParams } from "next/navigation";
import { AdminEditBanner, useAgencyEdit } from "./admin-edit-context";
import { DemoEditor } from "./demo-editor";
import { VideoStudio } from "./video-studio";
import { safeReturn } from "@/lib/agency/shared";
import type { StudioData } from "@/lib/video/studio-data";

/** The list the workspace came from (kept inside the workspace's own ?volver=). */
function listOf(workspace: string, agencyId: string) {
  try {
    return safeReturn(new URL(workspace, "https://x.local").searchParams.get("volver"), `/admin/inmobiliarias?abierta=${agencyId}`);
  } catch {
    return `/admin/inmobiliarias?abierta=${agencyId}`;
  }
}

export function AgencyPropertyEditor({ agencyId, agencyName, demoId }: { agencyId: string; agencyName: string; demoId: string }) {
  const edit = useAgencyEdit(agencyId);
  const params = useSearchParams();
  const workspace = safeReturn(params.get("volver"), `/admin/inmobiliarias/${agencyId}/editar`);
  const banner = (
    <AdminEditBanner
      agencyName={agencyName}
      edit={edit}
      backHref={workspace}
      backLabel="Volver a propiedades"
      exitHref={listOf(workspace, agencyId)}
      note="Organizar y editar datos no genera imágenes ni consume créditos."
    />
  );
  // The editor opens once the context is there, so no write leaves this page without it.
  if (edit.state.status === "starting" || edit.state.status === "error")
    return (
      <div className="account-page container dm-page">
        {banner}
        {edit.state.status === "starting" && <p role="status">Abriendo la edición…</p>}
      </div>
    );
  return <DemoEditor id={demoId} banner={banner} agencyContext={agencyId} />;
}

/**
 * «Generar video» of a property of the agency the team is editing: the same
 * Video Studio as the agency's panel (no second video interface), with the
 * edit banner, and back to this property's editor on «Fotos y espacios».
 */
export function AgencyVideoStudio({ agencyId, agencyName, demoId, data }: { agencyId: string; agencyName: string; demoId: string; data: StudioData }) {
  const edit = useAgencyEdit(agencyId);
  const params = useSearchParams();
  const workspace = safeReturn(params.get("volver"), `/admin/inmobiliarias/${agencyId}/editar`);
  const editor = `/admin/inmobiliarias/${agencyId}/propiedades/${demoId}?${new URLSearchParams({ seccion: "fotos", volver: workspace })}`;
  return (
    <div className="account-page container dm-page">
      <AdminEditBanner
        agencyName={agencyName}
        edit={edit}
        backHref={editor}
        backLabel="Volver a la propiedad"
        exitHref={listOf(workspace, agencyId)}
        note="El video Clásico se crea en este navegador y no consume créditos."
      />
      {edit.state.status === "starting" ? (
        <p role="status">Abriendo la edición…</p>
      ) : (
        <VideoStudio
          demoId={demoId}
          demo={data.demo}
          kind={data.kind}
          info={data.info}
          published={data.published}
          canEdit
          placement={data.placement}
          backTo={editor}
          team
          previewHref={`/admin/demos/${demoId}/vista-previa`}
        />
      )}
    </div>
  );
}
