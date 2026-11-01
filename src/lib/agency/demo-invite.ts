// The demo as the way into the agency's panel. The presentation link the
// team sends privately may carry the invitation code; the demo then offers
// "Probar esta propiedad en mi panel". Only a live code for that same agency
// opens it: the buyers' link, or a demo token alone, never gives access.
// Client-safe and pure: the server looks the invitation up and passes it in.

/** Browser key: the listing an agency pasted in its demo ("¿Querés probarlo con otra propiedad?"), for its panel to continue with. */
export const PENDING_IMPORT_KEY = "habita_pending_import";
/** A pending listing older than this is not offered anymore. */
export const PENDING_IMPORT_TTL_MS = 7 * 24 * 3600 * 1000;

/** The URL parameter that carries the invitation code (also on /panel/empezar). */
export const INVITE_PARAM = "codigo";

/**
 * An invitation code: the short one of the links made from a demo (10
 * characters) or the long one of earlier links and of the invitations sent
 * without a demo.
 */
export const INVITE_CODE = /^[A-Za-z0-9_-]{10,64}$/;

/**
 * The short code: lowercase letters and digits that cannot be mistaken for
 * one another (no 0/o, 1/l/i), so it survives being read aloud or retyped.
 * 31^10 ≈ 8·10^14 codes; each one also expires, works once and can be revoked.
 */
export const SHORT_CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
export const SHORT_CODE_LENGTH = 10;
const SHORT_LINK = /^(?:[a-z0-9-]*-)?([2-9a-hjkmnp-z]{10})$/;

/** "Casa en Sierra de los Padres" → "casa-en-sierra-de-los-padres": the readable part of the short link. */
export function propertySlug(title: string | null | undefined) {
  const words = (title ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " y ")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  // Whole words, up to 40 characters: a long title does not make a long link.
  let slug = "";
  for (const word of words) {
    const next = slug ? `${slug}-${word}` : word;
    if (next.length > 40) break;
    slug = next;
  }
  return slug || (words[0]?.slice(0, 40) ?? "") || "propiedad";
}

/** The demo's short link: /p/<property>-<code>, and /precios or /ficha after it. */
export const shortLinkPath = (title: string | null | undefined, code: string, view: "precios" | "ficha" | null = null) =>
  `/p/${propertySlug(title)}-${code}${view ? `/${view}` : ""}`;

/** The code of a short link's segment, or null. The readable part is not checked: a renamed property keeps its link. */
export function shortLinkCode(segment: string) {
  return SHORT_LINK.exec(segment)?.[1] ?? null;
}

export type DemoInvite =
  /** The private invitation to take this demo into the agency's own panel. */
  | { href: string; freeCredits: number }
  /** A code was sent but it can no longer be used (expired, used, revoked or another agency's). */
  | { unavailable: true }
  /** No code: the presentation keeps its general call to action. */
  | null;

export const invitationPath = (code: string, demoToken: string) =>
  `/panel/empezar?${new URLSearchParams({ [INVITE_PARAM]: code, demo: demoToken })}`;

/** The agency's presentation: a path only, with the invitation inside it when there is one. */
export const presentationPath = (demoToken: string, code: string | null = null) =>
  `/demo/${demoToken}/presentacion${code ? `/${code}` : ""}`;

/** The buyers' page as the agency sees it from its presentation (?vista=ficha before). */
export const buyerViewPath = (demoToken: string, code: string) => `${presentationPath(demoToken, code)}/ficha`;

/** The plans inside the agency's demo, under its own bar: the link the team sends when it asks for prices. */
export const pricesViewPath = (demoToken: string, code: string) => `${presentationPath(demoToken, code)}/precios`;

export function inviteFor(
  demo: { token: string; agencyId: string },
  code: string | null,
  invitation: { agencyId: string; freeCredits: number } | null,
): DemoInvite {
  if (!code) return null;
  if (!invitation || invitation.agencyId !== demo.agencyId) return { unavailable: true };
  return { href: invitationPath(code, demo.token), freeCredits: invitation.freeCredits };
}

/**
 * The invitation code is a secret: analytics and ad pixels must never carry
 * it. Replaces its value in any URL-like text, keeping the rest readable.
 */
export const redactInvite = (text: string) =>
  text
    .replace(/([?&#]codigo=)[^&#\s"]*/gi, "$1[oculto]")
    .replace(/(\/demo\/[^/\s"?#]+\/presentacion\/)[^/\s"?#]+/gi, "$1[oculto]")
    // The short link /p/<property>-<code>: the property stays readable.
    .replace(/(\/p\/(?:[^/\s"?#]*-)?)[2-9a-hjkmnp-z]{10}(?=[/?#\s"]|$)/g, "$1[oculto]");
