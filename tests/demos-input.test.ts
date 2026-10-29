import { describe, expect, it, vi, afterEach } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  adminClient: () => {
    throw new Error("not used");
  },
  currentUser: async () => null,
}));
import {
  agencyInput,
  orderInput,
  photoChanges,
  propertyInput,
} from "../src/lib/demos/input";
import {
  cleanUrl,
  ctaHref,
  imageWidth,
  ogImageUrl,
  orderStyles,
  pickCover,
  publicImageUrl,
  shownVersions,
  whatsappShareUrl,
  DEMO_TEXT,
  TOKEN_PATTERN,
} from "../src/lib/demos/shared";
import { isAdmin } from "../src/lib/commerce/http";
afterEach(() => vi.unstubAllEnvs());

describe("Admin permission", () => {
  it("is never implied by being signed in: only emails in ADMIN_EMAILS", () => {
    vi.stubEnv("ADMIN_EMAILS", "");
    expect(isAdmin("someone@example.com")).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
    vi.stubEnv("ADMIN_EMAILS", " Equipo@Amobla.com , otra@amobla.com");
    expect(isAdmin("equipo@amobla.com")).toBe(true);
    expect(isAdmin("cliente@example.com")).toBe(false);
    expect(isAdmin("equipo@amobla.com.evil")).toBe(false);
  });
  it("includes the temporary admins hardcoded until they are in ADMIN_EMAILS", () => {
    vi.stubEnv("ADMIN_EMAILS", "");
    expect(isAdmin("FacundoGregorini@gmail.com")).toBe(true);
  });
});

describe("Form input", () => {
  it("requires the agency name and normalizes optional fields", () => {
    expect(() => agencyInput({ name: "  " })).toThrow(/nombre/);
    expect(agencyInput({ name: "  Sur   Propiedades ", website: "sur.com.ar", notes: " " })).toEqual({
      name: "Sur Propiedades",
      website: "https://sur.com.ar/",
      contact_name: null,
      notes: null,
    });
    expect(() => agencyInput({ name: "X", website: "javascript:alert(1)" })).toThrow(/sitio web/);
  });
  it("requires the property title and rejects non-web listing links", () => {
    expect(() => propertyInput({})).toThrow(/título/);
    expect(() => propertyInput({ title: "Casa", listing_url: "ftp://x.com" })).toThrow();
    expect(propertyInput({ title: "Casa", listing_url: "https://portal.com/aviso/1" }).listing_url).toBe(
      "https://portal.com/aviso/1",
    );
  });
  it("accepts only catalog rooms and styles, and staging modes that keep the room", () => {
    // The style is the demo's (main style), not a photo setting.
    expect(photoChanges({ room: "kitchen", style: "scandinavian", visible: false })).toEqual({
      room: "kitchen",
      visible: false,
    });
    expect(() => photoChanges({ room: "garage" })).toThrow();
    expect(() => photoChanges({ mode: "remove" })).toThrow();
    expect(() => photoChanges({ visible: "yes" })).toThrow();
    expect(photoChanges({ label: "  Dormitorio  principal " })).toEqual({ label: "Dormitorio principal" });
  });
  it("accepts a reordering only with the same photos, each once", () => {
    expect(orderInput(["b", "a"], ["a", "b"])).toEqual(["b", "a"]);
    expect(() => orderInput(["a", "a"], ["a", "b"])).toThrow();
    expect(() => orderInput(["a"], ["a", "b"])).toThrow();
    expect(() => orderInput(["a", "c"], ["a", "b"])).toThrow();
  });
  it("only accepts web addresses", () => {
    expect(cleanUrl("")).toBeNull();
    expect(cleanUrl("data:text/html,x")).toBeUndefined();
    expect(cleanUrl("localhost")).toBeUndefined();
  });
});

describe("Sharing", () => {
  it("sends only the link on WhatsApp: no greeting and no text of ours", () => {
    const link = "https://amoblaia.vercel.app/demo/abc?presentacion=1";
    expect(whatsappShareUrl(link)).toBe(`https://wa.me/?text=${encodeURIComponent(link)}`);
  });
  it("opens the agency's chat when its number is known, with only the link", () => {
    const link = "https://amoblaia.vercel.app/demo/abc?presentacion=1";
    expect(whatsappShareUrl(link, "5492230000101")).toBe(`https://wa.me/5492230000101?text=${encodeURIComponent(link)}`);
    expect(whatsappShareUrl(link, "+54 9 223 000-0101")).toBe(`https://wa.me/5492230000101?text=${encodeURIComponent(link)}`);
    expect(whatsappShareUrl(link, null)).toBe(`https://wa.me/?text=${encodeURIComponent(link)}`);
  });
  it("keeps the demo and the agency in the call to action for attribution", () => {
    const href = new URL(ctaHref("demo-1", "agency-1"), "https://x.test");
    expect(href.pathname).toBe("/estudio");
    expect(href.searchParams.get("demo")).toBe("demo-1");
    expect(href.searchParams.get("inmobiliaria")).toBe("agency-1");
    expect(href.searchParams.get("utm_source")).toBe("demo_comercial");
  });
  it("uses tokens that are long and URL-safe", () => {
    expect(TOKEN_PATTERN.test("abc")).toBe(false);
    expect(TOKEN_PATTERN.test("a".repeat(24))).toBe(true);
    expect(TOKEN_PATTERN.test(`${"a".repeat(23)}/`)).toBe(false);
  });
  it("versions image URLs so a new version refreshes caches", () => {
    const v = { style: "modern", v: "abcd1234" };
    expect(publicImageUrl("tok", "p1", v, 960)).toBe("/demo/tok/imagen/p1?e=modern&r=abcd1234&w=960");
    expect(publicImageUrl("tok", "p1", null, 960)).toBe("/demo/tok/imagen/p1?r=o&w=960");
    expect(ogImageUrl("tok", "p1", v)).toBe("/demo/tok/imagen/p1?e=modern&r=abcd1234&og=1");
    expect(imageWidth("700")).toBe(960);
    expect(imageWidth("99999")).toBe(2048);
    expect(imageWidth("x")).toBe(1600);
  });
  it("shows per style the approved version, else the newest deliverable one", () => {
    const g = (id: string, style: string, extra: Record<string, unknown> = {}) => ({
      id,
      style,
      status: "succeeded",
      result_path: `${id}.jpg`,
      is_free: false,
      ...extra,
    });
    const gens = [
      g("n1", "modern"),
      g("n0", "modern"),
      g("f1", "industrial", { is_free: true }),
      g("r1", "coastal", { status: "running", result_path: null }),
      g("d1", "classic"),
    ];
    const shown = shownVersions({ approved_generation_id: "n0", discarded: ["d1"] }, gens);
    expect([...shown].map(([k, v]) => [k, v.id])).toEqual([["modern", "n0"]]);
    expect(shownVersions({ approved_generation_id: null, discarded: [] }, gens).get("modern")?.id).toBe("n1");
  });
  it("orders styles with the main one first, then as in the catalog", () => {
    expect(orderStyles(["industrial", "modern", "unknown", "coastal"], "industrial")).toEqual([
      "industrial",
      "modern",
      "coastal",
    ]);
  });
  it("chooses the cover among visible photos, preferring one staged in the main style", () => {
    const photos = [
      { id: "a", visible: true, versions: [] },
      { id: "b", visible: true, versions: [{ style: "coastal", v: "1" }] },
      { id: "c", visible: true, versions: [{ style: "modern", v: "2" }] },
      { id: "d", visible: false, versions: [{ style: "modern", v: "3" }] },
    ];
    expect(pickCover(photos, null, "modern")?.id).toBe("c");
    expect(pickCover(photos, null, "classic")?.id).toBe("b");
    expect(pickCover(photos, "a", "modern")?.id).toBe("a");
    expect(pickCover(photos, "d", "modern")?.id).toBe("c");
    expect(pickCover([], null, "modern")).toBeNull();
  });
  it("states the mandatory AI transparency texts", () => {
    expect(DEMO_TEXT.disclaimer).toContain("inteligencia artificial");
    expect(DEMO_TEXT.disclaimer).toContain("no necesariamente están incluidos");
    expect(DEMO_TEXT.badge).toBe("Ambientación virtual con IA");
  });
});
