import { describe, expect, it } from "vitest";
import {
  buyerViewPath,
  INVITE_CODE,
  invitationPath,
  inviteFor,
  presentationPath,
  pricesViewPath,
  propertySlug,
  redactInvite,
  shortLinkCode,
  shortLinkPath,
} from "@/lib/agency/demo-invite";

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

  it("hides the code of a short link, keeping the property readable", () => {
    expect(redactInvite("https://habita.test/p/casa-en-sierra-de-los-padres-k7f3x2qm9a/precios")).toBe(
      "https://habita.test/p/casa-en-sierra-de-los-padres-[oculto]/precios",
    );
    expect(redactInvite("/p/casa-k7f3x2qm9a")).toBe("/p/casa-[oculto]");
    // Other /p/ paths (a portal's listing) are left as they are.
    expect(redactInvite("https://sur.test/p/9")).toBe("https://sur.test/p/9");
  });
});

describe("short links", () => {
  const code = "k7f3x2qm9a";

  it("names the property in whole words, without accents, and keeps it short", () => {
    expect(propertySlug("Casa en Sierra de los Padres")).toBe("casa-en-sierra-de-los-padres");
    expect(propertySlug("Depto. 3 ambientes · Güemes & Alem")).toBe("depto-3-ambientes-guemes-y-alem");
    expect(propertySlug("Casa con pileta, quincho y parque en barrio cerrado Rumencó")).toBe("casa-con-pileta-quincho-y-parque-en");
    expect(propertySlug("Casa con pileta, quincho y parque en barrio cerrado Rumencó").length).toBeLessThanOrEqual(40);
    expect(propertySlug("")).toBe("propiedad");
    expect(propertySlug("¡¡!!")).toBe("propiedad");
  });

  it("builds the link and its views, and reads its code back", () => {
    expect(shortLinkPath("Casa en Sierra de los Padres", code)).toBe(`/p/casa-en-sierra-de-los-padres-${code}`);
    expect(shortLinkPath("Casa", code, "precios")).toBe(`/p/casa-${code}/precios`);
    expect(shortLinkCode(`casa-en-sierra-de-los-padres-${code}`)).toBe(code);
    // The name is only for reading: a renamed property, or no name, still finds its demo.
    expect(shortLinkCode(`otro-nombre-${code}`)).toBe(code);
    expect(shortLinkCode(code)).toBe(code);
    expect(INVITE_CODE.test(code)).toBe(true);
  });

  it("rejects anything that is not a short code", () => {
    expect(shortLinkCode("casa-en-sierra")).toBeNull();
    expect(shortLinkCode("casa-K7F3X2QM9A")).toBeNull();
    // Ambiguous characters (0, 1, i, l, o) are never in a code.
    expect(shortLinkCode("casa-k7f3x2qm9o")).toBeNull();
    expect(shortLinkCode("casa-k7f3x2qm9ab")).toBeNull();
  });
});
