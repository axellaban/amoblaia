import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Backlog CRO #8: of 5 who saw the invitation's form, 2 left and the 3 who signed up used Google.
// A new access starts with Google; the e-mail and password are one tap away, never removed.
vi.mock("@/lib/analytics", () => ({ track: () => {} }));
vi.mock("@/lib/supabase/client", () => ({ browserClient: () => ({}) }));
vi.mock("../src/components/google-signin", () => ({ GoogleSignIn: () => <div data-google="1">Continuar con Google</div> }));

import { InvitationSignup } from "../src/components/agency-invitation";

const invitation = { agencyId: "a1", agencyName: "Inmo Prueba", properties: 1, freeCredits: 3, expiresAt: "2026-12-01T00:00:00Z" };
const render = (preview = false) =>
  renderToStaticMarkup(<InvitationSignup code="codigo" here="/panel/empezar?codigo=codigo" invitation={invitation} preview={preview} />);

describe("the invitation's sign-up", () => {
  it("opens with Google and folds the e-mail behind one tap", () => {
    const html = render();
    expect(html).toContain('data-google="1"');
    expect(html).toContain("Prefiero usar mi email y una contraseña");
    expect(html).toContain('data-cta="invitation_use_email"');
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain("Entrar a mi panel</button>");
    // Google comes before the way to the e-mail.
    expect(html.indexOf('data-google="1"')).toBeLessThan(html.indexOf("Prefiero usar mi email"));
  });

  it("still shows the e-mail form for the team's preview", () => {
    const html = render(true);
    expect(html).toContain('type="password"');
    expect(html).not.toContain("Prefiero usar mi email");
  });
});
