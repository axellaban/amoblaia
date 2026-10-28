import { describe, expect, it } from "vitest";
import { fileProblem, readCounts, selectionTotals, splitListings } from "@/lib/agency/photo-selection";

describe("splitListings", () => {
  it("reads one link per line, in order, and reads a repeated link once", () => {
    const { urls, repeated, extra } = splitListings("https://a.test/1\nhttps://a.test/2\n\nhttps://a.test/1");
    expect(urls).toEqual(["https://a.test/1", "https://a.test/2"]);
    expect(repeated).toBe(1);
    expect(extra).toBe(0);
  });

  it("reports the links beyond the limit instead of dropping them silently", () => {
    const text = Array.from({ length: 12 }, (_, i) => `https://a.test/${i}`).join("\n");
    const { urls, extra } = splitListings(text);
    expect(urls).toHaveLength(12);
    expect(extra).toBe(2);
  });
});

describe("selectionTotals", () => {
  it("counts photos and only the groups that have some photo chosen", () => {
    const groups = [{ picks: new Set(["a", "b"]) }, { picks: new Set<string>() }, { picks: new Set(["c"]) }];
    expect(selectionTotals(groups)).toEqual({ photos: 3, groups: 2 });
  });

  it("is empty when nothing is chosen", () => {
    expect(selectionTotals([{ picks: new Set<string>() }])).toEqual({ photos: 0, groups: 0 });
  });
});

describe("fileProblem", () => {
  it("accepts JPG, PNG and WebP up to the limit", () => {
    expect(fileProblem({ type: "image/jpeg", size: 1000 })).toBeNull();
    expect(fileProblem({ type: "image/webp", size: 3 * 1024 * 1024 })).toBeNull();
  });

  it("explains each refusal in words, not only by type", () => {
    expect(fileProblem({ type: "image/heic", size: 1000 })).toBe("Solo JPG, PNG o WebP.");
    expect(fileProblem({ type: "image/png", size: 3 * 1024 * 1024 + 1 })).toBe("Pesa más de 3 MB.");
    expect(fileProblem({ type: "image/png", size: 0 })).toBe("El archivo está vacío.");
  });
});

describe("readCounts", () => {
  it("counts each reading state from the real list", () => {
    const counts = readCounts([{ state: "ready" }, { state: "duplicate" }, { state: "error" }, { state: "reading" }, { state: "waiting" }]);
    expect(counts).toEqual({ total: 5, ready: 1, duplicate: 1, error: 1, pending: 2 });
  });
});
