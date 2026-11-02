import { describe, expect, it } from "vitest";
import { readVisit, VISIT_SECONDS, visitToken } from "@/lib/agency/visit-token";

const KEY = "clave-de-prueba";
const CODE = "abcdefghjk";
const NOW = Date.UTC(2026, 10, 2);

describe("the agency's visit to its panel (cookie)", () => {
  it("opens the code it was made for, until it expires", () => {
    const token = visitToken(CODE, KEY, NOW);
    expect(readVisit(token, KEY, NOW)).toEqual({ code: CODE, exp: Math.floor(NOW / 1000) + VISIT_SECONDS });
    expect(readVisit(token, KEY, NOW + VISIT_SECONDS * 1000)).toBeNull();
  });

  it("never outlives the invitation", () => {
    const until = NOW + 3600 * 1000;
    const token = visitToken(CODE, KEY, NOW, until);
    expect(readVisit(token, KEY, NOW)?.exp).toBe(Math.floor(until / 1000));
    expect(readVisit(token, KEY, until + 1000)).toBeNull();
  });

  it("refuses another key, a changed code or expiry, and junk", () => {
    const token = visitToken(CODE, KEY, NOW);
    expect(readVisit(token, "otra-clave", NOW)).toBeNull();
    expect(readVisit(token.replace(CODE, "zzzzzzzzzz"), KEY, NOW)).toBeNull();
    const [code, exp, mac] = token.split(".");
    expect(readVisit(`${code}.${Number(exp) + 60}.${mac}`, KEY, NOW)).toBeNull();
    expect(readVisit(undefined, KEY, NOW)).toBeNull();
    expect(readVisit("a.b.c", KEY, NOW)).toBeNull();
    expect(readVisit(token, "", NOW)).toBeNull();
  });
});
