import { describe, expect, it } from "vitest";
import { regroupOrder } from "../src/lib/demos/editor-logic";

describe("photo order", () => {
  it("reorders a space without moving the other spaces' photos", () => {
    // Space 1: a, c, e. Space 2: b, d.
    expect(regroupOrder(["a", "b", "c", "d", "e"], ["e", "a", "c"])).toEqual(["e", "b", "a", "d", "c"]);
  });

  it("keeps the order when nothing moved", () => {
    expect(regroupOrder(["a", "b", "c"], ["a", "c"])).toEqual(["a", "b", "c"]);
  });
});
