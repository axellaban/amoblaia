import { describe, expect, it } from "vitest";
import { TOOL_NAMES, parseMaskUrl, toolPrompt, validTool } from "../src/lib/demos/tools";
import { cardStyles } from "../src/lib/demos/editor-logic";

describe("AI tools on a demo photo", () => {
  it("accepts only the three tools", () => {
    expect(validTool("sky")).toBe(true);
    expect(validTool("dusk")).toBe(true);
    expect(validTool("remove")).toBe(true);
    expect(validTool("furnish")).toBe(false);
    expect(validTool(undefined)).toBe(false);
  });

  it("names each tool for the versions list", () => {
    expect(TOOL_NAMES.sky).toBe("Cielo despejado");
    expect(TOOL_NAMES.dusk).toBe("Atardecer");
    expect(TOOL_NAMES.remove).toBe("Sin objetos");
  });

  it("keeps the architecture in every prompt", () => {
    for (const t of ["sky", "dusk", "remove"] as const) expect(toolPrompt(t)).toMatch(/Keep every building|Change nothing outside the mask/);
  });

  it("reads a mask only as a PNG data URL", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
    expect(parseMaskUrl(`data:image/png;base64,${png}`)).toBeInstanceOf(Buffer);
    expect(parseMaskUrl(`data:image/jpeg;base64,${png}`)).toBeNull();
    expect(parseMaskUrl("no es una máscara")).toBeNull();
    expect(parseMaskUrl(undefined)).toBeNull();
  });

  it("keeps a tool's result out of the styles' cards", () => {
    const photo = {
      generations: [{ id: "t1", style: "tool", mode: "tool", status: "succeeded" }],
    } as unknown as Parameters<typeof cardStyles>[0];
    expect(cardStyles(photo, ["modern"])).toEqual(["modern"]);
  });
});
