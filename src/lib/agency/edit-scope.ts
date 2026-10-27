// What an administrative edit of an agency may and may not do, in words the
// team reads in the banner, and the header that carries the tab's context.
// Pure: shared by the server and the browser.

/** The header with the tab's signed edit context (see edit-context.ts). */
export const EDIT_HEADER = "x-habita-edicion";
/** Where each tab keeps its own context, by agency. */
export const editStorageKey = (agencyId: string) => `habita_edicion_${agencyId}`;

/** Allowed in "Editar inmobiliaria", every write checked on the server against the tab's agency. */
export const EDIT_ALLOWED = [
  "Datos de la inmobiliaria, notas internas y contacto",
  "Marca y canal de consultas",
  "Crear y editar sus propiedades",
  "Organizar fotos, espacios y versiones",
  "Publicar y despublicar, con confirmación",
] as const;

/** Kept apart: never enabled by editing. */
export const EDIT_SEPARATE = [
  "Compras y pagos del cliente",
  "Cuenta, email y contraseña del dueño",
  "Créditos de regalo: tienen su propio formulario, con motivo y auditoría",
  "Crear versiones con créditos del cliente: el equipo no puede gastarlos",
] as const;

/** The banner's one-line explanation of who pays a new version in this context. */
export function payerNote(staging: { payer: "team" | "agency"; blocked: string | null } | undefined) {
  if (!staging) return "";
  if (staging.payer === "team") return "Las versiones nuevas son una demo del equipo: no usan créditos de la inmobiliaria.";
  return staging.blocked
    ? "Esta inmobiliaria tiene su cuenta: sus versiones se pagan con sus créditos y el equipo no puede gastarlos. Organizar, descargar y publicar sí."
    : "Las versiones nuevas usan los créditos de la inmobiliaria: el costo se revisa antes de empezar.";
}
