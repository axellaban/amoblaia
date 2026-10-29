import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { mainOf } from "../src/lib/demos/server";

const shown = (entries: [string, string[]][]) => new Map(entries.map(([id, styles]) => [id, new Map(styles.map((s) => [s, {}]))]));

describe("The demo's main style", () => {
  it("is the saved one while some photo has a version in it", () => {
    const photos = [{ id: "a", style: "modern" }, { id: "b", style: "modern" }];
    expect(mainOf(photos, shown([["a", ["industrial"]], ["b", ["modern", "industrial"]]]))).toBe("modern");
  });

  it("is the style most photos have when the saved default has no versions", () => {
    const photos = [{ id: "a", style: "modern" }, { id: "b", style: "modern" }, { id: "c", style: "modern" }];
    expect(mainOf(photos, shown([["a", ["industrial"]], ["b", ["industrial", "luxury"]], ["c", []]]))).toBe("industrial");
  });

  it("keeps the saved style when nothing is staged yet", () => {
    expect(mainOf([{ id: "a", style: "modern" }], shown([]))).toBe("modern");
  });
});
