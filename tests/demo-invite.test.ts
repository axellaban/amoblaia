import { describe, expect, it } from "vitest";
import { buyerViewPath, invitationPath, inviteFor, presentationPath, pricesViewPath, redactInvite } from "@/lib/agency/demo-invite";

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
    expect(presentationPath(demo.token, CODE)).toBe(`/demo/${demo.token}/presentacion/${CODE}`);
    expect(presentationPath(demo.token)).toBe(`/demo/${demo.token}/presentacion`);
    expect(buyerViewPath(demo.token, CODE)).toBe(`/demo/${demo.token}/presentacion/${CODE}/ficha`);
    expect(pricesViewPath(demo.token, CODE)).toBe(`/demo/${demo.token}/presentacion/${CODE}/precios`);
    // Links never carry a query string: the buyers' and the agency's ones are paths.
    expect(`${presentationPath(demo.token, CODE)}`).not.toMatch(/[?&]/);
  });
});

describe("redactInvite", () => {
  it("hides the invitation code wherever a URL carries it, and nothing else", () => {
    expect(redactInvite(`https://habita.test/demo/x?presentacion=1&codigo=${CODE}`)).toBe("https://habita.test/demo/x?presentacion=1&codigo=[oculto]");
    expect(redactInvite(`https://habita.test/demo/x/presentacion/${CODE}/ficha`)).toBe("https://habita.test/demo/x/presentacion/[oculto]/ficha");
    expect(redactInvite("https://habita.test/demo/x/presentacion")).toBe("https://habita.test/demo/x/presentacion");
    expect(redactInvite(`/panel/empezar?codigo=${CODE}&demo=tok`)).toBe("/panel/empezar?codigo=[oculto]&demo=tok");
    expect(redactInvite("https://habita.test/precios?plan=agente")).toBe("https://habita.test/precios?plan=agente");
  });
});
