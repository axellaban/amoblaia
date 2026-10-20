import { describe, expect, it } from "vitest";
import { buildPrompt, freeAllows } from "../src/lib/catalog";

describe("Free tier rules", () => {
  it("allows only living rooms and bedrooms, without furniture removal", () => {
    expect(freeAllows("living", "furnish")).toBe(true);
    expect(freeAllows("bedroom", "redesign")).toBe(true);
    expect(freeAllows("kitchen", "furnish")).toBe(false);
    expect(freeAllows("living", "remove")).toBe(false);
    expect(freeAllows("living", "enhance")).toBe(false);
    expect(freeAllows("bedroom", "dusk")).toBe(false);
  });
  it("asks for a distinct proposal for each of the three results", () => {
    const options = [1, 2, 3].map((n) =>
      buildPrompt("living", "modern", "furnish", "", n),
    );
    expect(new Set(options).size).toBe(3);
    expect(options[1]).toContain("design option 2 of 3");
    expect(buildPrompt("living", "modern", "remove", "", 2)).not.toContain(
      "design option",
    );
  });
});

describe("Photo editing prompts", () => {
  it("enhances exposure without asking for alternate furniture", () => {
    const prompt = buildPrompt("living", "modern", "enhance", "", 2);
    expect(prompt).toContain("balanced exposure");
    expect(prompt).toContain("Preserve every existing object");
    expect(prompt).not.toContain("design option");
  });
  it("changes dusk illumination without inventing permanent features", () => {
    const prompt = buildPrompt("outdoor", "modern", "dusk", "", 2);
    expect(prompt).toContain("early dusk");
    expect(prompt).toContain(
      "Only the illumination and visible sky may change",
    );
    expect(prompt).not.toContain("design option");
  });
});
