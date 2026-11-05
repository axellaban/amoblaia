// «Equipo y accesos»: what the panel and the server share. Pure, client-safe.
import type { AgencyRole, InvitedRole } from "./shared";

/** The two roles a new invitation offers, Miembro first (the default). */
export const INVITE_ROLE_CHOICES: InvitedRole[] = ["editor", "admin"];

/** The visible role: Administrador (owner and admin) or Miembro (editor); «Solo vista» only for accesses created before. */
export const VISIBLE_ROLE: Record<AgencyRole, string> = {
  owner: "Administrador",
  admin: "Administrador",
  editor: "Miembro",
  viewer: "Solo vista",
};
export const VISIBLE_ROLE_HELP: Record<"admin" | "editor" | "viewer", string> = {
  admin: "Todo lo de un miembro, y además invita, cambia permisos, quita accesos y aprueba solicitudes.",
  editor: "Ve, crea y edita propiedades, crea demostraciones y genera imágenes y videos con los créditos compartidos.",
  viewer: "Ve las propiedades y comparte sus enlaces. No cambia nada.",
};

export type InviteStatus = "pending" | "accepted" | "expired" | "revoked";
export const INVITE_STATUS_LABEL: Record<InviteStatus, string> = {
  pending: "Pendiente",
  accepted: "Aceptada",
  expired: "Vencida",
  revoked: "Revocada",
};

export type InviteHistory = { id: string; email: string; role: InvitedRole; status: InviteStatus; createdAt: string; expiresAt: string };

export type AccessRequest = {
  id: string;
  email: string | null;
  source: "demo" | "link" | "invitation" | "panel";
  status: "pending" | "approved" | "rejected" | "cancelled";
  createdAt: string;
};

export type AdminTransfer = {
  id: string;
  requesterId: string;
  requesterEmail: string | null;
  requesterName: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled" | "superseded";
  createdAt: string;
};

export type WorkspaceAdministration = {
  principal: { id: string; email: string | null; name: string | null } | null;
  /** The signed-in account is the principal administrator. */
  isPrincipal: boolean;
  /** The signed-in account is the one whose credits pay (agencies.owner_id): only it buys. */
  billingIsYou: boolean;
  /** This account's own open request to become principal. */
  myRequest: { id: string; createdAt: string } | null;
  /** Open requests addressed to the principal (only for the principal). */
  transfers: AdminTransfer[];
};

/**
 * Whether a member of the team may be removed or have its role lowered:
 * never the account that pays (owner), the principal administrator, nor
 * oneself. This keeps at least one valid administrator in every agency.
 */
export function protectedMember(m: { id: string; role: AgencyRole }, principalId: string | null, viewerId: string) {
  if (m.role === "owner") return "Es la cuenta de facturación de la inmobiliaria: su acceso no se puede quitar ni cambiar.";
  if (principalId && m.id === principalId) return "Es el administrador principal: primero transferí la administración a otra persona.";
  if (m.id === viewerId) return "No podés cambiar ni quitar tu propio acceso: pedíselo a otro administrador.";
  return null;
}

/** Where the panel says who pays and who buys: purchases credit only the billing account. */
export const BUY_ONLY_BILLING =
  "Los créditos de la inmobiliaria se compran desde la cuenta de facturación. Pedile a quien la tiene que compre más, o escribinos para cambiarla.";
