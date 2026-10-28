// The demo as the way into the agency's panel. The presentation link the
// team sends privately may carry the invitation code; the demo then offers
// "Probar esta propiedad en mi panel". Only a live code for that same agency
// opens it: the buyers' link, or a demo token alone, never gives access.
// Client-safe and pure: the server looks the invitation up and passes it in.

/** The URL parameter that carries the invitation code (also on /panel/empezar). */
export const INVITE_PARAM = "codigo";

export type DemoInvite =
  /** The private invitation to take this demo into the agency's own panel. */
  | { href: string; freeCredits: number }
  /** A code was sent but it can no longer be used (expired, used, revoked or another agency's). */
  | { unavailable: true }
  /** No code: the presentation keeps its general call to action. */
  | null;

export const invitationPath = (code: string, demoToken: string) =>
  `/panel/empezar?${new URLSearchParams({ [INVITE_PARAM]: code, demo: demoToken })}`;

export const presentationPath = (demoToken: string, code: string) =>
  `/demo/${demoToken}?${new URLSearchParams({ presentacion: "1", [INVITE_PARAM]: code })}`;

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
export const redactInvite = (text: string) => text.replace(/([?&#]codigo=)[^&#\s"]*/gi, "$1[oculto]");
