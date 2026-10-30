import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  adminClient: () => {
    throw new Error("not used");
  },
  currentUser: async () => null,
}));
import { whatsappInput } from "@/lib/demos/input";
import {
  DEFAULT_MESSAGE_TEMPLATE,
  normalizeArNumber,
  notSent,
  renderMessage,
  stageLabel,
  stageOf,
  whatsappWebUrl,
} from "@/lib/demos/send";

describe("normalizeArNumber", () => {
  it.each([
    ["5492236337191", "5492236337191"],
    ["+54 9 223 633-7191", "5492236337191"],
    ["54 223 6337191", "5492236337191"],
    ["02236337191", "5492236337191"],
    ["0223 15 633-7191", "5492236337191"],
    ["2236337191", "5492236337191"],
    ["+54 11 4444-5555", "5491144445555"],
    ["0011 4444 5555", "5491144445555"],
    ["0221 15 4444 555", "5492214444555"],
  ])("normalizes %s", (raw, expected) => {
    expect(normalizeArNumber(raw)).toBe(expected);
  });

  it.each([null, undefined, "", "abc", "12345", "+1 555 123 4567", "549223"])("rejects %s", (raw) => {
    expect(normalizeArNumber(raw as string)).toBeNull();
  });
});

describe("renderMessage", () => {
  const link = "https://habitaia.vercel.app/demo/abc123";

  it("fills the default template with the contact's name", () => {
    expect(renderMessage(DEFAULT_MESSAGE_TEMPLATE, { nombre: "Laura", inmobiliaria: "Acme", link, creditos: 20 })).toBe(
      `Laura, buenas! Te preparé esta demo con una de sus propiedades: ${link}\n\nTe cargué 20 créditos para que puedas probar otros ambientes y estilos.`,
    );
  });

  it("uses the agency's name when there is no contact", () => {
    expect(renderMessage("{nombre}!", { nombre: null, inmobiliaria: "Acme", link, creditos: null })).toBe("Acme!");
    expect(renderMessage("{nombre}!", { nombre: "  ", inmobiliaria: "Acme", link, creditos: null })).toBe("Acme!");
  });

  it("leaves unknown placeholders visible", () => {
    expect(renderMessage("{inmobiliaria} {otra}", { nombre: null, inmobiliaria: "Acme", link, creditos: 1 })).toBe("Acme {otra}");
  });

  it("the link has no query string, so it can be sent as is", () => {
    const text = renderMessage(DEFAULT_MESSAGE_TEMPLATE, { nombre: null, inmobiliaria: "Acme", link, creditos: 5 });
    expect(text).toContain(link);
  });
});

describe("whatsappWebUrl", () => {
  it("opens the chat with the text encoded", () => {
    expect(whatsappWebUrl("5492236337191", "Hola & chau?")).toBe(
      "https://web.whatsapp.com/send?phone=5492236337191&text=Hola%20%26%20chau%3F",
    );
  });
});

describe("stages", () => {
  it("a published demo without visits or send is 'Sin enviar'", () => {
    expect(stageOf(null, 0)).toBe(0);
    expect(stageLabel(stageOf(null, 0))).toBe("Sin enviar");
  });

  it("sent before any visit is 'Enviada'", () => {
    expect(stageOf("2026-10-30T10:00:00Z", 0)).toBe(1);
  });

  it("a visit is 'Ingresó' even if it was never marked as sent", () => {
    expect(stageOf(null, 1)).toBe(2);
    expect(stageLabel(2)).toBe("Ingresó");
  });

  it("the levels above keep their order", () => {
    expect(stageLabel(stageOf(null, 2))).toBe("Interactuó");
    expect(stageLabel(stageOf(null, 5))).toBe("Suscribió");
  });

  it("levels out of range are clamped", () => {
    expect(stageOf(null, 9)).toBe(6);
    expect(stageOf(null, -1)).toBe(0);
  });

  it("'Sin enviar' filter: published and not sent", () => {
    expect(notSent(0, "published")).toBe(true);
    expect(notSent(1, "published")).toBe(false);
    expect(notSent(0, "draft")).toBe(false);
  });
});

describe("whatsappInput", () => {
  it("is optional", () => {
    for (const raw of [undefined, null, "", "   "]) expect(whatsappInput(raw)).toBeNull();
  });
  it("saves the number normalized", () => {
    expect(whatsappInput("0223 15 633-7191")).toBe("5492236337191");
  });
  it("rejects what is not an Argentine number", () => {
    for (const raw of ["123", "+1 555 123 4567", 2236337191, "9".repeat(41)]) expect(() => whatsappInput(raw)).toThrow(/WhatsApp/);
  });
});
