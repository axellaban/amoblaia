// Whether the account that took over an agency looks like the agency's own:
// its e-mail's domain against the agency's website. Pure (and shared with
// tests): the server records the result, the team reviews it.

export type ClaimMethod = "google" | "email" | "existing";
export type ClaimReview = "ok" | "personal" | "mismatch";

/** Mailboxes anyone can open: an agent's own address, never proof of the company. */
const PERSONAL = /^(gmail|googlemail|hotmail|outlook|live|msn|yahoo|ymail|icloud|me|mac|aol|proton|protonmail|gmx|zoho|fibertel|speedy|arnet|uolsinectis)\./;

const host = (url: string | null | undefined) => {
  if (!url) return null;
  try {
    return new URL(/^https?:\/\//.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
};

export function claimReview(email: string, website: string | null | undefined, contactEmail: string | null = null): { review: ClaimReview; domain: string } {
  const domain = email.split("@")[1]?.trim().toLowerCase() ?? "";
  // The contact the team has for the agency is the agency, whatever its mailbox.
  if (contactEmail && contactEmail.trim().toLowerCase() === email.trim().toLowerCase()) return { review: "ok", domain };
  const site = host(website);
  if (site && (domain === site || domain.endsWith(`.${site}`) || site.endsWith(`.${domain}`))) return { review: "ok", domain };
  if (PERSONAL.test(domain)) return { review: "personal", domain };
  return { review: "mismatch", domain };
}

export const CLAIM_REVIEW_LABEL: Record<ClaimReview | "confirmed", string> = {
  ok: "Dominio de la inmobiliaria",
  personal: "Email personal",
  mismatch: "Dominio distinto: revisar",
  confirmed: "Verificado por el equipo",
};
export const CLAIM_METHOD_LABEL: Record<ClaimMethod, string> = {
  google: "con Google",
  email: "con email y contraseña",
  existing: "con una cuenta que ya tenía",
};
