import { describe, expect, it } from "vitest";
import { intentDestination, intentOf, withIntent } from "@/lib/agency/demo-invite";

const PHOTO = "0b9f6a3e-5c1d-4e2a-9f7b-1a2b3c4d5e6f";
const INVITE = "/panel/empezar?codigo=abc&demo=tok";

describe("what the agency asked for in its demo, through the sign-up", () => {
  it("travels with the invitation and comes back validated", () => {
    const href = withIntent(INVITE, { kind: "generate", photo: PHOTO, style: "scandinavian" });
    expect(href).toBe(`${INVITE}&accion=generar&foto=${PHOTO}&estilo=scandinavian`);
    const q = Object.fromEntries(new URLSearchParams(href.split("?")[1]));
    expect(intentOf(q)).toEqual({ kind: "generate", photo: PHOTO, style: "scandinavian" });
    expect(intentOf({ accion: "ambientar", foto: PHOTO })).toEqual({ kind: "stage", photo: PHOTO });
    expect(intentOf({ accion: "importar" })).toEqual({ kind: "import" });
  });
  it("ignores anything malformed", () => {
    expect(intentOf({ accion: "generar", foto: "../x", estilo: "scandinavian" })).toBeNull();
    expect(intentOf({ accion: "borrar", foto: PHOTO })).toBeNull();
    expect(intentOf({ accion: "generar", foto: PHOTO, estilo: "<script>" })).toEqual({ kind: "stage", photo: PHOTO });
    expect(withIntent(INVITE, null)).toBe(INVITE);
  });
  it("opens the property with the photo and style ready, or the panel's import", () => {
    expect(intentDestination("d1", { kind: "generate", photo: PHOTO, style: "modern" })).toBe(`/panel/propiedades/d1?bienvenida=1&foto=${PHOTO}&estilo=modern`);
    expect(intentDestination("d1", { kind: "stage", photo: PHOTO }, false)).toBe(`/panel/propiedades/d1?foto=${PHOTO}`);
    expect(intentDestination("d1", null)).toBe("/panel/propiedades/d1?bienvenida=1");
    expect(intentDestination("d1", null, false)).toBe("/panel/propiedades/d1");
    expect(intentDestination("d1", { kind: "import" })).toBe("/panel?bienvenida=1&continuar=importar#crear");
    expect(intentDestination(null, null)).toBe("/panel?bienvenida=1");
  });
});
