// Where an agency stands, for the team, derived only from facts in the
// database (owner, invitations, published properties). Pure: shared with
// the browser.

export type AgencyStage = "no-account" | "invited" | "account" | "live";

export const STAGE_LABEL: Record<AgencyStage, string> = {
  "no-account": "Sin cuenta",
  invited: "Invitación pendiente",
  account: "Cuenta reclamada",
  live: "Primera propiedad publicada",
};

export function agencyStage(a: { hasOwner: boolean; liveClaimExpires: string | null; published: number }): AgencyStage {
  if (a.hasOwner) return a.published > 0 ? "live" : "account";
  return a.liveClaimExpires ? "invited" : "no-account";
}

export type ClaimState = "pending" | "used" | "revoked" | "expired";
export const CLAIM_LABEL: Record<ClaimState, string> = {
  pending: "Pendiente",
  used: "Usada",
  revoked: "Revocada",
  expired: "Vencida",
};

export function claimState(c: { expires_at: string; used_at: string | null; revoked_at: string | null }, now = Date.now()): ClaimState {
  if (c.used_at) return "used";
  if (c.revoked_at) return "revoked";
  return new Date(c.expires_at).getTime() <= now ? "expired" : "pending";
}

export type AdminAgencyRow = {
  id: string;
  name: string;
  slug: string | null;
  hasOwner: boolean;
  claimedAt: string | null;
  sitePublished: boolean;
  createdAt: string;
  properties: number;
  published: number;
  partialImports: number;
  failedImports: number;
  review: number;
  liveClaimExpires: string | null;
  lastClaimAt: string | null;
};

export type AdminAgencyDetail = {
  agency: {
    id: string;
    name: string;
    slug: string | null;
    website: string | null;
    hasOwner: boolean;
    claimedAt: string | null;
    sitePublished: boolean;
    createdAt: string;
    contactName: string | null;
    notes: string | null;
  };
  counts: { total: number; published: number; staged: number; review: number };
  /** balance: the owner's credits (null without owner or when unreadable); pending: waiting for the claim (null before the migration). */
  credits: { balance: number | null; pending: number | null };
  claims: { id: string; createdAt: string; expiresAt: string; usedAt: string | null; revokedAt: string | null; state: ClaimState }[];
  members: { role: "owner" | "collaborator"; since: string }[];
  imports: {
    id: string;
    url: string;
    status: "partial" | "failed";
    error: string | null;
    createdAt: string;
    photosTotal: number;
    photosDone: number;
    settingsSaved: boolean;
    demoId: string | null;
  }[];
  properties: { id: string; status: "draft" | "published"; token: string; createdAt: string; title: string }[];
  propertiesTotal: number;
};
