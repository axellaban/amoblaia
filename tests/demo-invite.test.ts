import { describe, expect, it } from "vitest";
import { invitationPath, inviteFor, presentationPath, redactInvite } from "@/lib/agency/demo-invite";

const demo = { token: "tok_demo_aaaaaaaaaaaaaaaa", agencyId: "ag1" };
const CODE = "codigoSecretoDeVeinteMasCaracteres";

describe("inviteFor", () => {
  it("keeps the general call to action when the link carries no code", () => {
    expect(inviteFor(demo, null, null)).toBeNull();
  });

  it("opens the panel only with a live invitation for this same agency", () => {
    expect(inviteFor(demo, CODE, { agencyId: "ag1", freeCredits: 3 })).toEqual({ href: invitationPath(CODE, demo.token), freeCredits: 3 });
  });

  it("never lets a code of another agency, or a spent one, open this demo's panel", () => {
    expect(inviteFor(demo, CODE, { agencyId: "ag2", freeCredits: 0 })).toEqual({ unavailable: true });
    expect(inviteFor(demo, CODE, null)).toEqual({ unavailable: true });
  });
});

describe("links", () => {
  it("leads from the demo to the invitation with its demo, and back", () => {
    expect(invitationPath(CODE, demo.token)).toBe(`/panel/empezar?codigo=${CODE}&demo=${demo.token}`);
    expect(presentationPath(demo.token, CODE)).toBe(`/demo/${demo.token}?presentacion=1&codigo=${CODE}`);
  });
});

describe("redactInvite", () => {
  it("hides the invitation code wherever a URL carries it, and nothing else", () => {
    expect(redactInvite(`https://habita.test/demo/x?presentacion=1&codigo=${CODE}`)).toBe("https://habita.test/demo/x?presentacion=1&codigo=[oculto]");
    expect(redactInvite(`/panel/empezar?codigo=${CODE}&demo=tok`)).toBe("/panel/empezar?codigo=[oculto]&demo=tok");
    expect(redactInvite("https://habita.test/precios?plan=agente")).toBe("https://habita.test/precios?plan=agente");
  });
});
