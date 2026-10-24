import { describe, expect, it, vi } from "vitest";
import {
  embedCode,
  imagePath,
  normalizeWhatsapp,
  parseImageRef,
  styleOptions,
  whatsappLink,
} from "../src/lib/showcase-shared";
import { comparisonLayout } from "../src/lib/comparison-layout";
import {
  STAGING_LABEL,
  disclosureFor,
  isStagingMode,
  labelRequired,
} from "../src/lib/disclosure";
import { buildPrompt } from "../src/lib/catalog";
import { isBareRoute } from "../src/lib/routes";

const uuid = "00000000-0000-4000-8000-000000000123";

describe("WhatsApp contact", () => {
  it("normalizes numbers with country and area code", () => {
    expect(normalizeWhatsapp("+54 9 223 555-1234")).toBe("5492235551234");
    expect(normalizeWhatsapp("223-555")).toBeNull();
    expect(normalizeWhatsapp(5492235551234)).toBeNull();
    expect(normalizeWhatsapp("1".repeat(16))).toBeNull();
  });
  it("opens a chat with the property, link, room and style, without sending it", () => {
    const href = whatsappLink({
      phone: "5492235551234",
      title: "Depto «Güemes» & balcón",
      url: "https://amobla.example/ficha/abc",
      intent: "consulta",
      room: "Living",
      style: "Nórdico",
    })!;
    const url = new URL(href);
    expect(url.origin + url.pathname).toBe("https://wa.me/5492235551234");
    const text = url.searchParams.get("text")!;
    expect(text).toContain("consultar por la propiedad «Depto «Güemes» & balcón»");
    expect(text).toContain("propuesta Nórdico del ambiente «Living»");
    expect(text).toContain("https://amobla.example/ficha/abc");
    // Nothing in the link sends a message: it only pre-fills the chat.
    expect([...url.searchParams.keys()]).toEqual(["text"]);
    const visit = new URL(
      whatsappLink({
        phone: "5492235551234",
        title: "Casa",
        url: "https://x/ficha/y",
        intent: "visita",
      })!,
    ).searchParams.get("text")!;
    expect(visit).toContain("coordinar una visita");
    expect(visit).not.toContain("propuesta");
    expect(
      whatsappLink({ phone: "", title: "x", url: "y", intent: "consulta" }),
    ).toBeNull();
  });
});

describe("Public image references", () => {
  it("round-trips and rejects anything else", () => {
    const t = "tok_PublicShowcaseToken_0001";
    expect(imagePath(t, { kind: "original", id: uuid })).toBe(
      `/ficha/${t}/imagen/o-${uuid}`,
    );
    expect(parseImageRef(`o-${uuid}`)).toEqual({ kind: "original", id: uuid });
    expect(parseImageRef(`p-${uuid}`)).toEqual({ kind: "proposal", id: uuid });
    expect(parseImageRef("logo")).toEqual({ kind: "logo" });
    for (const bad of ["x-" + uuid, "p-1", "p-../../secret", "", "o-"])
      expect(parseImageRef(bad)).toBeNull();
  });
  it("offers only styles that have a proposal, in catalog order", () => {
    expect(
      styleOptions([
        { id: "a", style: "industrial", mode: "furnish" },
        { id: "b", style: "modern", mode: "furnish" },
        { id: "c", style: "industrial", mode: "redesign" },
      ]),
    ).toEqual([
      { style: "modern", name: "Moderno", ids: ["b"] },
      { style: "industrial", name: "Industrial", ids: ["a", "c"] },
    ]);
    expect(styleOptions([])).toEqual([]);
  });
});

describe("Embed code", () => {
  it("points at the embed route and only trusts its own origin", () => {
    const code = embedCode(
      "https://amobla.example",
      "tok_PublicShowcaseToken_0001",
      'Casa "linda" <b>',
    );
    expect(code).toContain(
      'src="https://amobla.example/embed/ficha/tok_PublicShowcaseToken_0001"',
    );
    expect(code).toContain('title="Casa &quot;linda&quot; &lt;b> · ambientación virtual"');
    expect(code).toContain('e.origin==="https://amobla.example"');
    expect(code).toContain("e.source===f.contentWindow");
  });
});

describe("Downloadable comparison layout", () => {
  for (const orientation of ["horizontal", "vertical"] as const)
    it(`keeps both photos whole and undistorted (${orientation})`, () => {
      const original = { width: 2048, height: 1536 };
      const proposal = { width: 1536, height: 1024 };
      const l = comparisonLayout(original, proposal, orientation);
      [original, proposal].forEach((src, i) => {
        const p = l.photos[i];
        expect(Math.abs(p.width / p.height - src.width / src.height)).toBeLessThan(
          0.01,
        );
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.x + p.width).toBeLessThanOrEqual(l.width);
        expect(p.y + p.height).toBeLessThanOrEqual(l.footer.y);
        // Each title sits right above its photo.
        expect(l.titles[i].y + l.titles[i].height).toBe(p.y);
      });
      // Phones read the vertical one: titles stay legible once downscaled.
      if (orientation === "vertical") {
        expect(l.width).toBeLessThanOrEqual(1400);
        expect(l.fontSize / l.width).toBeGreaterThan(0.035);
      }
    });
  it("rejects broken sizes", () => {
    expect(() =>
      comparisonLayout({ width: 0, height: 10 }, { width: 1, height: 1 }, "vertical"),
    ).toThrow();
  });
});

describe("Disclosure and generation rules", () => {
  it("labels staging always, with the agreed text", () => {
    expect(disclosureFor("furnish")).toBe(
      "Ambientación virtual · Mobiliario agregado digitalmente",
    );
    expect(disclosureFor("redesign")).toBe(STAGING_LABEL);
    expect(labelRequired("furnish")).toBe(true);
    expect(labelRequired("remove")).toBe(true);
    expect(labelRequired("enhance")).toBe(false);
    expect(isStagingMode("remove")).toBe(false);
  });
  it("limits staging to movable furniture and keeps defects", () => {
    for (const mode of ["furnish", "redesign"]) {
      const prompt = buildPrompt("living", "luxury", mode, "pisos de mármol", 2);
      expect(prompt).toContain("ONLY MOVABLE FURNITURE AND DECOR MAY CHANGE");
      expect(prompt).toContain("Do not repaint");
      expect(prompt).toContain("stains, cracks, damp marks");
      expect(prompt).toContain("make the space look larger");
      expect(prompt).toContain("never to walls, floors or ceilings");
      expect(prompt).toContain("or the furniture-only rule");
      expect(prompt).toContain("marble-topped furniture");
    }
    expect(buildPrompt("living", "modern", "enhance", "")).not.toContain(
      "ONLY MOVABLE FURNITURE",
    );
  });
  it("keeps shared showcase pages free of site chrome and tags", () => {
    expect(isBareRoute("/ficha/abc")).toBe(true);
    expect(isBareRoute("/embed/ficha/abc")).toBe(true);
    expect(isBareRoute("/fichas")).toBe(false);
    expect(isBareRoute("/estudio")).toBe(false);
  });
});

describe("Framing headers", () => {
  it("lets only the embed route be framed", async () => {
    vi.stubEnv("EMBED_FRAME_ANCESTORS", "");
    const config = (await import("../next.config")).default;
    const rules = await config.headers!();
    const matching = (path: string) =>
      rules.filter((r) =>
        new RegExp(
          "^" +
            r.source
              .replace("/:path*", "(?:/.*)?")
              .replace("((?!embed/).*)", "(?!embed/).*") +
            "$",
        ).test(path),
      );
    const header = (path: string, key: string) =>
      matching(path)
        .flatMap((r) => r.headers)
        .filter((h) => h.key === key)
        .map((h) => h.value);
    for (const path of ["/", "/estudio", "/fichas", "/ficha/abc", "/api/fichas"]) {
      expect(header(path, "X-Frame-Options")).toEqual(["DENY"]);
      expect(header(path, "Content-Security-Policy")).toEqual([
        "frame-ancestors 'none'",
      ]);
    }
    expect(header("/embed/ficha/abc", "X-Frame-Options")).toEqual([]);
    expect(header("/embed/ficha/abc", "Content-Security-Policy")).toEqual([
      "frame-ancestors *",
    ]);
    expect(header("/ficha/abc", "X-Robots-Tag")).toEqual(["noindex, nofollow"]);
    vi.unstubAllEnvs();
  });
});
