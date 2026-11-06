import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { startDestination } from "@/lib/start-destination";

const person = { email: "ana@inmo.com", is_anonymous: false };

describe("startDestination (/inicio)", () => {
  const before = process.env.ADMIN_EMAILS;
  afterEach(() => {
    process.env.ADMIN_EMAILS = before;
  });

  it("sends an agency's account to its panel", () => {
    expect(startDestination(person, "agency")).toBe("/panel");
  });

  it("sends an account without an agency to create one", () => {
    expect(startDestination(person, "none")).toBe("/panel/empezar");
  });

  it("sends the team to its agencies, with or without an agency of its own", () => {
    process.env.ADMIN_EMAILS = "equipo@habita.test";
    const team = { email: "Equipo@habita.test", is_anonymous: false };
    expect(startDestination(team, "none")).toBe("/admin/inmobiliarias");
    expect(startDestination(team, "agency")).toBe("/admin/inmobiliarias");
  });

  it("keeps the photos reachable when the lookup fails or nobody is signed in", () => {
    expect(startDestination(person, "failed")).toBe("/proyectos");
    expect(startDestination(null, "none")).toBe("/proyectos");
    expect(startDestination({ is_anonymous: true }, "none")).toBe("/proyectos");
  });

  it("opens the agency's image studio, or /estudio for everyone else, with ?ir=imagenes", () => {
    expect(startDestination(person, "agency", true)).toBe("/panel/imagenes");
    expect(startDestination(person, "none", true)).toBe("/estudio");
    expect(startDestination(null, "none", true)).toBe("/estudio");
  });
});
