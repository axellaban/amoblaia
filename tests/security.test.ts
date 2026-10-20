import { describe, it, expect } from "vitest";
import {
  createSession,
  verifySession,
  validOrigin,
  SESSION_SECONDS,
} from "../src/lib/session";
import { buildPrompt } from "../src/lib/catalog";
const password = "a-strong-pilot-password-for-tests";
describe("Acceso al piloto", () => {
  it("acepta una sesión firmada y rechaza otra clave o una firma alterada", () => {
    const token = createSession(password, 1000000);
    expect(verifySession(token, password, 1000000)).toBe(true);
    expect(
      verifySession(token, "another-password-at-least-sixteen", 1000000),
    ).toBe(false);
    expect(verifySession(`${token}x`, password, 1000000)).toBe(false);
  });
  it("rechaza sesiones vencidas, malformadas y claves cortas", () => {
    const token = createSession(password, 1000000);
    expect(
      verifySession(token, password, 1000000 + SESSION_SECONDS * 1000),
    ).toBe(false);
    for (const value of [
      undefined,
      "abc",
      "NaN.hi",
      "999999999999.abc",
      "1001.a.extra",
    ])
      expect(verifySession(value, password, 1000000)).toBe(false);
    expect(verifySession(token, "short", 1000000)).toBe(false);
  });
  it("bloquea solicitudes sin origen o desde otra web", () => {
    expect(
      validOrigin(
        new Request("https://example.com/api/generate", {
          headers: { origin: "https://example.com" },
        }),
      ),
    ).toBe(true);
    expect(
      validOrigin(
        new Request("https://example.com/api/generate", {
          headers: { origin: "https://evil.example" },
        }),
      ),
    ).toBe(false);
    expect(validOrigin(new Request("https://example.com/api/generate"))).toBe(
      false,
    );
  });
});
describe("Instrucciones de staging", () => {
  it("valida las opciones y conserva restricciones arquitectónicas", () => {
    expect(() => buildPrompt("invalid", "modern", "furnish", "")).toThrow();
    const prompt = buildPrompt(
      "bedroom",
      "scandinavian",
      "furnish",
      "Warm linens",
    );
    expect(prompt).toContain("bedroom");
    expect(prompt).toContain("Preserve the exact camera position");
    expect(prompt).toContain("Warm linens");
    expect(prompt).toContain("Do not conceal damage");
  });
  it("distingue retirar muebles de amoblar y limita indicaciones", () => {
    const prompt = buildPrompt("living", "modern", "remove", "x".repeat(1000));
    expect(prompt).toContain("Show the same room empty");
    expect(prompt).not.toContain("x".repeat(501));
  });
});
