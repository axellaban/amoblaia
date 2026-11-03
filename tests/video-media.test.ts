import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { isMediaPath, MUSIC_GENRES, MUSIC_TRACKS, readMusic, readWatermark, trackOf } from "../src/lib/video/media";
import { watermarkBox } from "../src/lib/video/render";

const PATH = "00000000-0000-4000-8000-0000000000a1/00000000-0000-4000-8000-0000000000d1/00000000-0000-4000-8000-0000000000f1.mp3";

describe("Video music and watermark", () => {
  it("has a library with unique tracks in every style", () => {
    expect(new Set(MUSIC_TRACKS.map((t) => t.id)).size).toBe(MUSIC_TRACKS.length);
    for (const g of MUSIC_GENRES) expect(MUSIC_TRACKS.filter((t) => t.genre === g).length).toBeGreaterThanOrEqual(3);
    for (const t of MUSIC_TRACKS) expect(t.prompt).toMatch(/instrumental only/);
    expect(trackOf("chill-terrace")?.name).toBe("Terrace");
    expect(trackOf("nope")).toBeNull();
  });

  it("keeps only valid music choices", () => {
    expect(readMusic({ kind: "library", track: "chill-terrace", volume: 250 })).toEqual({ kind: "library", track: "chill-terrace", volume: 100 });
    expect(readMusic({ kind: "library", track: "unknown" })).toBeNull();
    expect(readMusic({ kind: "upload", path: PATH, name: "<b>Tema</b>.mp3", volume: 2 })).toEqual({ kind: "upload", path: PATH, name: "bTema/b.mp3", volume: 10 });
    expect(readMusic({ kind: "upload", path: "../other/file.mp3" })).toBeNull();
    expect(readMusic(null)).toBeNull();
  });

  it("keeps only valid watermarks, bottom right by default", () => {
    expect(readWatermark({ kind: "profile" })).toEqual({ kind: "profile", corner: "br" });
    expect(readWatermark({ kind: "profile", corner: "tl" })).toEqual({ kind: "profile", corner: "tl" });
    expect(readWatermark({ kind: "upload", path: PATH.replace(".mp3", ".png"), name: "logo.png", corner: "zz" })).toMatchObject({ kind: "upload", corner: "br" });
    expect(readWatermark({ kind: "upload", path: "x.png" })).toBeNull();
    expect(isMediaPath(PATH.replace(".mp3", ".exe"))).toBe(false);
  });

  it("places the watermark inside the frame, above the AI label at the bottom right", () => {
    const plan = { width: 1080, height: 1920 };
    const logo = { width: 600, height: 200 };
    for (const corner of ["tl", "tr", "bl", "br"] as const) {
      const b = watermarkBox(plan, logo, corner, false);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(plan.width);
      expect(b.y + b.h).toBeLessThanOrEqual(plan.height);
      expect(b.w / b.h).toBeCloseTo(3);
    }
    expect(watermarkBox(plan, logo, "br", true).y).toBeLessThan(watermarkBox(plan, logo, "br", false).y);
    expect(watermarkBox(plan, logo, "bl", true).y).toBe(watermarkBox(plan, logo, "bl", false).y);
  });
});

describe("Music library on fal", async () => {
  const { falDetail, musicModels, readAudio } = await import("../src/lib/video/media-server");
  it("reads fal's reason and its audio leniently", () => {
    expect(falDetail({ detail: "User is not allowed" })).toBe("User is not allowed");
    expect(falDetail({ detail: [{ msg: "field required" }, { msg: "bad" }] })).toBe("field required; bad");
    expect(falDetail(null)).toBe("");
    expect(readAudio({ audio: { url: "https://v3.fal.media/files/a.wav", content_type: "audio/wav" } })).toEqual({ url: "https://v3.fal.media/files/a.wav", type: "audio/wav" });
    expect(readAudio({ audio_file: { url: "https://v3.fal.media/files/a.mp3" } })?.url).toBe("https://v3.fal.media/files/a.mp3");
    expect(readAudio({ audio: { url: "https://evil.example/a.wav" } })).toBeNull();
  });
  it("tries Lyria 2 first, then other music models", () => {
    const models = musicModels();
    expect(models[0]).toBe("fal-ai/lyria2");
    expect(new Set(models).size).toBe(models.length);
    expect(models.length).toBeGreaterThan(1);
  });
});
