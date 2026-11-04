import { describe, expect, it } from "vitest";
import { parseToolRef, toolRef } from "@/lib/demos/tool-ref";

const PHOTO = "ab2d150a-2ac9-4238-ac42-51cad6b410d1";

describe("tool source_ref", () => {
  it("carries the photo that asked, whatever the source", () => {
    expect(parseToolRef(toolRef("original", PHOTO))).toEqual({ kind: "original", id: null, photoId: PHOTO });
    expect(parseToolRef(toolRef("generation:g1", PHOTO))).toEqual({ kind: "generation", id: "g1", photoId: PHOTO });
    expect(parseToolRef(toolRef("retouch:r1", PHOTO))).toEqual({ kind: "retouch", id: "r1", photoId: PHOTO });
  });
  it("reads older jobs that only name their source", () => {
    expect(parseToolRef("original")).toEqual({ kind: "original", id: null, photoId: null });
    expect(parseToolRef("retouch:r1")).toEqual({ kind: "retouch", id: "r1", photoId: null });
    expect(parseToolRef(null)).toEqual({ kind: "original", id: null, photoId: null });
    expect(parseToolRef("")).toEqual({ kind: "original", id: null, photoId: null });
  });
});
