import { describe, expect, it } from "vitest";
import {
  classify,
  clientIp,
  deviceCookieValue,
  fingerprintHash,
  linkHash,
  mergeAliases,
  normalizeEmail,
  readDeviceCookie,
  validLinkToken,
  type SessionKind,
} from "../src/lib/internal/shared";

const SECRET = "x".repeat(40);
const DEVICE = "6f1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const none: SessionKind = { kind: "none" };
const team: SessionKind = { kind: "internal", userId: "u-team", personId: "p-1" };
const client: SessionKind = { kind: "external", userId: "u-client" };
const device = (status: "internal" | "unknown" | "external" | "revoked") => ({ id: DEVICE, status, personId: "p-1" });

describe("classification: the QA scenarios as rules", () => {
  it("1–2. an internal account is internal, with or without a marked device", () => {
    expect(classify(team, null)).toMatchObject({ internal: true, reason: "team_session", personId: "p-1", clearDevice: false });
    expect(classify(team, device("internal"))).toMatchObject({ internal: true, reason: "team_session" });
    // Even on a browser the team revoked: the session decides (and the route gives it a new device).
    expect(classify(team, device("revoked"))).toMatchObject({ internal: true, clearDevice: false });
  });

  it("3. a public demo without session on a browser the team marked is internal", () => {
    expect(classify(none, device("internal"))).toMatchObject({ internal: true, reason: "internal_device", personId: "p-1" });
  });

  it("4–5. a new Chrome profile or a private window starts unknown (external) until it signs in, is linked or matches the team fingerprint", () => {
    expect(classify(none, null)).toMatchObject({ internal: false, reason: null, clearDevice: false });
  });

  it("7. a legitimate external visitor is external, and an unknown or confirmed-external device never excludes", () => {
    expect(classify(none, null).internal).toBe(false);
    expect(classify(none, device("unknown")).internal).toBe(false);
    expect(classify(none, device("external")).internal).toBe(false);
    expect(classify(client, null)).toMatchObject({ internal: false, clearDevice: false });
  });

  it("8. another account signing in on a team browser clears the mark, so the next person never inherits it", () => {
    expect(classify(client, device("internal"))).toMatchObject({ internal: false, clearDevice: true });
    // The old local mark (PostHog) of that browser goes too.
    expect(classify(client, null, true)).toMatchObject({ internal: false, clearDevice: true });
  });

  it("8. a revoked device stops being internal, even if the browser still says so", () => {
    expect(classify(none, device("revoked"), true)).toMatchObject({ internal: false, clearDevice: true });
  });

  it("the browser's own mark only excludes itself, and only when nothing better is known", () => {
    expect(classify(none, null, true)).toMatchObject({ internal: true, reason: "device_hint" });
  });
});

describe("signed device cookie", () => {
  it("round-trips and cannot be forged, altered or reused with another secret", () => {
    const value = deviceCookieValue(DEVICE, SECRET);
    expect(readDeviceCookie(value, SECRET)).toBe(DEVICE);
    expect(readDeviceCookie(value, "y".repeat(40))).toBeNull();
    expect(readDeviceCookie(value.replace(DEVICE, "00000000-0000-4000-8000-000000000000"), SECRET)).toBeNull();
    expect(readDeviceCookie(`${value}x`, SECRET)).toBeNull();
    expect(readDeviceCookie(`${value}.extra`, SECRET)).toBeNull();
    expect(readDeviceCookie("v1.not-a-uuid.sig", SECRET)).toBeNull();
    expect(readDeviceCookie(undefined, SECRET)).toBeNull();
  });

  it("refuses a short secret", () => {
    expect(() => deviceCookieValue(DEVICE, "short")).toThrow();
    expect(readDeviceCookie(deviceCookieValue(DEVICE, SECRET), "short")).toBeNull();
  });
});

describe("team fingerprint (private windows)", () => {
  const base = {
    ip: "45.181.247.137",
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1",
    screen: "390x844@3",
    tz: "America/Argentina/Buenos_Aires",
  };

  it("is the same for the same network and device, whatever the cookies", () => {
    expect(fingerprintHash(base, SECRET)).toBe(fingerprintHash({ ...base }, SECRET));
    expect(fingerprintHash(base, SECRET)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never classifies by IP alone: every part is required", () => {
    expect(fingerprintHash({ ...base, userAgent: null }, SECRET)).toBeNull();
    expect(fingerprintHash({ ...base, screen: undefined }, SECRET)).toBeNull();
    expect(fingerprintHash({ ...base, tz: undefined }, SECRET)).toBeNull();
    expect(fingerprintHash({ ...base, ip: null }, SECRET)).toBeNull();
  });

  it("another person on the same carrier IP with another phone, screen or zone does not match", () => {
    const h = fingerprintHash(base, SECRET);
    expect(fingerprintHash({ ...base, userAgent: base.userAgent.replace("26_1", "18_6") }, SECRET)).not.toBe(h);
    expect(fingerprintHash({ ...base, screen: "430x932@3" }, SECRET)).not.toBe(h);
    expect(fingerprintHash({ ...base, tz: "America/Santiago" }, SECRET)).not.toBe(h);
    expect(fingerprintHash({ ...base, ip: "181.9.226.21" }, SECRET)).not.toBe(h);
  });

  it("rejects malformed screen and zone values (they come from the browser)", () => {
    expect(fingerprintHash({ ...base, screen: "<script>" }, SECRET)).toBeNull();
    expect(fingerprintHash({ ...base, tz: "../../etc" }, SECRET)).toBeNull();
  });

  it("does not store the IP: the hash depends on the server secret", () => {
    expect(fingerprintHash(base, SECRET)).not.toBe(fingerprintHash(base, "z".repeat(40)));
  });

  it("reads the client IP from Vercel's headers", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "45.181.247.137, 10.0.0.1" }))).toBe("45.181.247.137");
    expect(clientIp(new Headers({ "x-real-ip": "2800:810:4a5::1" }))).toBe("2800:810:4a5::1");
    expect(clientIp(new Headers({ "x-forwarded-for": "not an ip" }))).toBeNull();
    expect(clientIp(new Headers())).toBeNull();
  });
});

describe("registry helpers", () => {
  it("normalizes e-mails so several Gmail of one person match however they are typed", () => {
    expect(normalizeEmail("  DescStartups@Gmail.com ")).toBe("descstartups@gmail.com");
    expect(normalizeEmail("growthlabs86@gmail.com")).toBe("growthlabs86@gmail.com");
    expect(normalizeEmail("no-arroba")).toBeNull();
    expect(normalizeEmail(42)).toBeNull();
  });

  it("merges browser aliases without duplicates and with a cap", () => {
    expect(mergeAliases(["a"], ["a", "b", null, undefined, "b"])).toEqual(["a", "b"]);
    expect(mergeAliases([], Array.from({ length: 30 }, (_, i) => `v${i}`)).length).toBe(20);
  });

  it("stores one-time link tokens only as a hash", () => {
    const token = "A".repeat(43);
    expect(validLinkToken(token)).toBe(true);
    expect(validLinkToken("short")).toBe(false);
    expect(linkHash(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(linkHash(token)).not.toContain(token);
  });
});
