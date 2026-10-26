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
  pickCover,
  publicImageUrl,
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
  it("lets demo editors into the demos panel only", () => {
    vi.stubEnv("ADMIN_EMAILS", "equipo@amobla.com");
    expect(isAdmin("FacundoGregorini@gmail.com", "demos")).toBe(true);
    expect(isAdmin("facundogregorini@gmail.com")).toBe(false);
    expect(isAdmin("equipo@amobla.com", "demos")).toBe(true);
    expect(isAdmin("cliente@example.com", "demos")).toBe(false);
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
    expect(photoChanges({ room: "kitchen", style: "scandinavian", visible: false })).toEqual({
      room: "kitchen",
      style: "scandinavian",
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
  it("builds a WhatsApp link that needs no app to open the demo", () => {
    const url = whatsappShareUrl("https://amoblaia.vercel.app/demo/abc", "Sur", "Depto");
    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(url)).toContain("https://amoblaia.vercel.app/demo/abc");
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
  it("versions image URLs so approving another proposal refreshes caches", () => {
    const photo = { id: "p1", label: "Living", staged: true, version: "abcd1234" };
    expect(publicImageUrl("tok", photo, "staged", 960)).toBe("/demo/tok/imagen/p1?v=staged&r=abcd1234&w=960");
    expect(imageWidth("700")).toBe(960);
    expect(imageWidth("99999")).toBe(2048);
    expect(imageWidth("x")).toBe(1600);
  });
  it("chooses the cover among visible photos, preferring a staged one", () => {
    const photos = [
      { id: "a", visible: true, approved_generation_id: null },
      { id: "b", visible: true, approved_generation_id: "11111111-aaaa" },
      { id: "c", visible: false, approved_generation_id: "22222222-bbbb" },
    ];
    expect(pickCover(photos, null)?.id).toBe("b");
    expect(pickCover(photos, "a")?.id).toBe("a");
    expect(pickCover(photos, "c")?.id).toBe("b");
    expect(pickCover([], null)).toBeNull();
  });
  it("states the mandatory AI transparency texts", () => {
    expect(DEMO_TEXT.disclaimer).toContain("inteligencia artificial");
    expect(DEMO_TEXT.disclaimer).toContain("no necesariamente están incluidos");
    expect(DEMO_TEXT.badge).toBe("Ambientación virtual con IA");
  });
});
