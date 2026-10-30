import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AnswerText, Assistant } from "@/components/assistant";
import { assistantInstructions } from "@/lib/assistant/prompt";
import { allowQuestion } from "@/lib/assistant/rate";
import { assistantInput, cleanPath, MAX_MESSAGES } from "@/lib/assistant/shared";

vi.mock("@/lib/analytics", () => ({ track: () => {} }));

const CODE = "codigoSecretoDeVeinteMasCaracteres";

describe("what the browser sends to Miguel Ángel", () => {
  it("keeps a short conversation that ends with the user's question", () => {
    const input = assistantInput({
      messages: [
        { role: "assistant", content: "¡Hola!" },
        { role: "user", content: "  ¿Cómo cargo una propiedad?  " },
      ],
      place: { kind: "panel" },
      path: "/panel/creditos?x=1",
    });
    expect(input.messages).toEqual([{ role: "user", content: "¿Cómo cargo una propiedad?" }]);
    expect(input.path).toBe("/panel/creditos");
  });

  it("sends only the latest messages", () => {
    const messages = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `m${i}` }));
    messages.push({ role: "user", content: "última" });
    expect(assistantInput({ messages, place: { kind: "panel" } }).messages.length).toBeLessThanOrEqual(MAX_MESSAGES);
  });

  it("rejects an empty question, a foreign role, a long message and an unknown place", () => {
    expect(() => assistantInput({ messages: [], place: { kind: "panel" } })).toThrow();
    expect(() => assistantInput({ messages: [{ role: "assistant", content: "hola" }], place: { kind: "panel" } })).toThrow();
    expect(() => assistantInput({ messages: [{ role: "system", content: "hola" }], place: { kind: "panel" } })).toThrow();
    expect(() => assistantInput({ messages: [{ role: "user", content: "x".repeat(1501) }], place: { kind: "panel" } })).toThrow();
    expect(() => assistantInput({ messages: [{ role: "user", content: "hola" }], place: { kind: "demo", token: "tok" } })).toThrow();
  });

  it("opens in a demo only with its token and an invitation code", () => {
    const input = assistantInput({ messages: [{ role: "user", content: "hola" }], place: { kind: "demo", token: "abcDEF123456", code: CODE } });
    expect(input.place).toEqual({ kind: "demo", token: "abcDEF123456", code: CODE });
  });

  it("keeps the path relative and drops the query, where the invitation code travels", () => {
    expect(cleanPath(`/demo/tok?presentacion=1&codigo=${CODE}`)).toBe("/demo/tok");
    expect(cleanPath("https://otro.sitio/panel")).toBe("/");
    expect(cleanPath("//otro.sitio")).toBe("/");
  });
});

describe("Miguel Ángel's instructions", () => {
  it("know the panel, the credits and where the question comes from", () => {
    const text = assistantInstructions({ kind: "panel", path: "/panel/sitio", agencyName: "Inmobiliaria Sur", role: "member", credits: 7, support: false });
    for (const part of ["Miguel Ángel", "/panel/creditos", "1 crédito la primera vez", "Inmobiliaria Sur", "/panel/sitio", "7 créditos", "no el dueño"])
      expect(text).toContain(part);
  });

  it("know the demo they are in", () => {
    const text = assistantInstructions({ kind: "demo", path: "/demo/tok", agencyName: "Inmobiliaria Sur", title: "Casa en el lago", freeCredits: 1 });
    for (const part of ["Casa en el lago", "1 crédito de regalo", "Guardar mi panel"]) expect(text).toContain(part);
  });
});

describe("the brake on questions", () => {
  it("allows 20 questions in ten minutes and then waits", () => {
    const now = 1_000_000;
    for (let i = 0; i < 20; i++) expect(allowQuestion("k1", now + i)).toBe(true);
    expect(allowQuestion("k1", now + 30)).toBe(false);
    expect(allowQuestion("k1", now + 11 * 60_000)).toBe(true);
    expect(allowQuestion("k2", now)).toBe(true);
  });
});

describe("the chat", () => {
  it("renders the answer's lists, bold text and internal links, never raw HTML or outside links", () => {
    const html = renderToStaticMarkup(
      <AnswerText text={"Pasos:\n1. Entrá a **Créditos IA**\n2. Tocá [Precios](/precios)\n- [afuera](https://malo.example) <b>x</b>"} />,
    );
    expect(html).toContain("<ol><li>Entrá a <strong>Créditos IA</strong></li>");
    expect(html).toContain('<a href="/precios">Precios</a>');
    expect(html).not.toContain('href="https://malo.example"');
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  it("starts closed, as Miguel Ángel's portrait at the corner", () => {
    const html = renderToStaticMarkup(<Assistant place={{ kind: "panel" }} />);
    expect(html).toContain("pb-launcher");
    expect(html).toContain("Abrir el chat con Miguel Ángel");
    expect(html).not.toContain("pb-panel");
  });
});
