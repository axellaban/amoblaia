// Fase 5C/5D: videos with AI animation through fal.ai. The modes and their
// credits (pure), the provider's queue (only fal's addresses, no stored
// payloads), the jobs on the server (credits charged before any provider
// cost, given back exactly once when the animation fails or gets stuck,
// clips copied to private storage, joined by the browser) and the credit
// functions in the database.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("sharp", () => ({
  default: () => ({ resize: () => ({ jpeg: () => ({ toBuffer: async () => Buffer.from("jpeg-16x9") }) }) }),
}));

const DEMO = "00000000-0000-4000-8000-0000000000d1";
const AG = "00000000-0000-4000-8000-0000000000a1";
const USER = "00000000-0000-4000-8000-000000000001";
const PAYER = "00000000-0000-4000-8000-0000000000b1";
const PHOTOS = [1, 2, 3, 4, 5, 6, 7].map((n) => `00000000-0000-4000-8000-0000000000f${n}`);

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  files: {} as Record<string, number>,
  uploads: [] as string[],
  balance: 100,
  charges: [] as { payer: string; video: string; credits: number }[],
  refunds: [] as string[],
  seq: 0,
}));

vi.mock("@/lib/supabase/server", () => {
  const table = (name: string) => (db.tables[name] ??= []);
  const query = (name: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    let update: Row | null = null;
    let insert: Row[] | null = null;
    let remove = false;
    let orderKey: string | null = null;
    const run = () => {
      const rows = table(name);
      if (insert) {
        const out = insert.map((r) => {
          const row = { id: `00000000-0000-4000-9000-${String(++db.seq).padStart(12, "0")}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), storage_path: null, clips_ready_at: null, attempts: 0, ...r };
          rows.push(row);
          return row;
        });
        return out;
      }
      let hit = rows.filter((r) => filters.every((f) => f(r)));
      if (remove) {
        db.tables[name] = rows.filter((r) => !hit.includes(r));
        return hit;
      }
      if (update) for (const r of hit) Object.assign(r, update);
      if (orderKey) hit = [...hit].sort((a, b) => Number(a[orderKey!] ?? 0) - Number(b[orderKey!] ?? 0));
      return hit;
    };
    const b = {
      select: () => b,
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), b),
      is: (k: string, v: unknown) => (filters.push((r) => (r[k] ?? null) === v), b),
      in: (k: string, v: unknown[]) => (filters.push((r) => v.includes(r[k])), b),
      gt: (k: string, v: number) => (filters.push((r) => Number(r[k]) > v), b),
      lt: (k: string, v: string) => (filters.push((r) => String(r[k]) < v), b),
      order: (k: string) => ((orderKey = k === "position" ? k : orderKey), b),
      limit: () => b,
      insert: (r: Row | Row[]) => ((insert = Array.isArray(r) ? r : [r]), b),
      update: (r: Row) => ((update = r), b),
      delete: () => ((remove = true), b),
      single: async () => ({ data: run()[0] ?? null, error: null }),
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      then: (resolve: (v: { data: unknown; error: null }) => void) => resolve({ data: run(), error: null }),
    };
    return b;
  };
  const rpc = async (name: string, args: Record<string, unknown>) => {
    if (name === "habita_video_charge") {
      const credits = args.p_credits as number;
      if (db.balance < credits) return { data: null, error: { message: "NO_CREDITS" } };
      db.balance -= credits;
      db.charges.push({ payer: args.p_payer as string, video: args.p_video as string, credits });
      const v = table("property_videos").find((r) => r.id === args.p_video);
      if (v) Object.assign(v, { credits_charged: credits, payer_id: args.p_payer });
      return { data: credits, error: null };
    }
    if (name === "habita_video_refund") {
      const v = table("property_videos").find((r) => r.id === args.p_video);
      if (!db.refunds.includes(args.p_video as string) && v && Number(v.credits_charged) > 0) {
        db.refunds.push(args.p_video as string);
        db.balance += Number(v.credits_charged);
      }
      if (v) v.credits_charged = 0;
      return { data: 0, error: null };
    }
    return { data: null, error: { message: "unknown" } };
  };
  const storage = {
    from: () => ({
      upload: async (path: string, bytes: Buffer) => ((db.files[path] = bytes.length), db.uploads.push(path), { data: { path }, error: null }),
      createSignedUploadUrl: async (path: string) => ({ data: { path, token: "tok", signedUrl: "https://x/upload" }, error: null }),
      createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://x/${path}` }, error: null }),
      list: async (folder: string, opts: { search: string }) => {
        const path = `${folder}/${opts.search}`;
        return { data: db.files[path] ? [{ name: opts.search, metadata: { size: db.files[path] } }] : [], error: null };
      },
    }),
  };
  return { adminClient: () => ({ from: (t: string) => query(t), rpc, storage }), currentUser: async () => null };
});
vi.mock("@/lib/demos/server", () => ({
  previewDemo: async () => ({ photos: PHOTOS.map((id, i) => ({ id, label: `Foto ${i + 1}`, versions: i === 0 ? [{ style: "moderno", v: "1" }] : [] })) }),
  adminImagePaths: async ({ style }: { style: string | null }) => ({ original: "o.jpg", staged: style ? "s.jpg" : null }),
  renderImage: async () => Buffer.from("jpeg"),
}));
vi.mock("@/lib/demos/input", () => ({ validStyle: (s: unknown) => s === "moderno" }));

import { AI_PHOTOS, AI_TIMING, clipPrompt, isAiMode, MODE_INFO, photoCountProblem, planVideo, timingOf, VIDEO_CREDITS, DEFAULT_TIMING, CLIP_SECONDS } from "../src/lib/video/plan";
import { aiLabel, clipTime } from "../src/lib/video/render";
import { clipInput, clipState, DEFAULT_MODEL, downloadClip, isFalMedia, readResult, submitClip } from "../src/lib/video/fal";
import { advanceAiVideos, aiUploadTarget, AI_STALE_MS, startAiVideo } from "../src/lib/video/ai";
import { finishVideo, listVideos } from "../src/lib/video/server";

// ---- a fake fal: its queue answers by request; files are served from fal.media.
const fal = vi.hoisted(() => ({ submitted: [] as { url: string; body: Record<string, unknown>; headers: Record<string, string> }[], state: {} as Record<string, "IN_PROGRESS" | "COMPLETED" | "ERROR">, failSubmit: false, downloads: 0 }));
function fakeFetch(input: string | URL, init?: RequestInit) {
  const url = String(input);
  const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  if (init?.method === "POST" && url.startsWith("https://queue.fal.run/")) {
    if (fal.failSubmit) return json({ detail: "down" }, 500);
    const id = `req-${fal.submitted.length + 1}`;
    fal.submitted.push({ url, body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> });
    fal.state[id] = "IN_PROGRESS";
    return json({ request_id: id, status_url: `https://queue.fal.run/fal-ai/ltx-2/requests/${id}/status`, response_url: `https://queue.fal.run/fal-ai/ltx-2/requests/${id}` });
  }
  const m = /requests\/(req-\d+)(\/status)?$/.exec(url);
  if (m) {
    const s = fal.state[m[1]];
    if (m[2]) return json(s === "ERROR" ? { status: "COMPLETED", error: "model failed" } : { status: s });
    return json({ video: { url: `https://v3b.fal.media/files/${m[1]}.mp4`, duration: 6.04 } });
  }
  if (url.startsWith("https://v3b.fal.media/")) {
    fal.downloads++;
    return Promise.resolve(new Response(new Uint8Array(4096), { status: 200, headers: { "content-length": "4096" } }));
  }
  return Promise.resolve(new Response("nope", { status: 404 }));
}

beforeEach(() => {
  db.tables = {};
  db.files = {};
  db.uploads.length = 0;
  db.balance = 100;
  db.charges.length = 0;
  db.refunds.length = 0;
  fal.submitted.length = 0;
  fal.state = {};
  fal.failSubmit = false;
  fal.downloads = 0;
  process.env.FAL_KEY = "test-key";
  process.env.HABITA_VIDEO_AI = "1";
  delete process.env.FAL_VIDEO_MODEL;
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AI modes, credits and timing", () => {
  it("«Foto en movimiento» costs 3 credits for one photo; the cinematic tour 10 for 2 to 6", () => {
    expect(VIDEO_CREDITS).toMatchObject({ classic: 0, clip: 3, cinematic: 10, balanced: 0 });
    expect([isAiMode("clip"), isAiMode("cinematic"), isAiMode("classic"), isAiMode("balanced")]).toEqual([true, true, false, false]);
    expect(AI_PHOTOS).toEqual({ clip: { min: 1, max: 1 }, cinematic: { min: 2, max: 6 } });
    expect(photoCountProblem("clip", 1)).toBeNull();
    expect(photoCountProblem("clip", 2)).toMatch(/una sola foto/);
    expect(photoCountProblem("cinematic", 1)).toMatch(/entre 2 y 6/);
    expect(photoCountProblem("cinematic", 6)).toBeNull();
    expect(photoCountProblem("cinematic", 7)).toMatch(/entre 2 y 6/);
    expect(photoCountProblem("classic", 12)).toBeNull();
    expect(MODE_INFO.clip.name).toBe("Foto en movimiento");
  });

  it("AI scenes last a clip (never past its end); the «Clásico» keeps its timing", () => {
    expect(timingOf("classic")).toBe(DEFAULT_TIMING);
    expect(timingOf("cinematic")).toBe(AI_TIMING);
    expect(AI_TIMING.photo).toBeLessThanOrEqual(CLIP_SECONDS * 1000);
    const p = planVideo(3, "9:16", { timing: AI_TIMING, intro: false, outro: false });
    expect(p.durationMs).toBe(3 * AI_TIMING.photo - 2 * AI_TIMING.fade);
    expect(clipTime({ start: 1000 }, 500, 6)).toBe(0);
    expect(clipTime({ start: 1000 }, 3500, 6)).toBe(2.5);
    expect(clipTime({ start: 0 }, 9000, 6)).toBeCloseTo(5.95);
  });

  it("asks only for a camera move, never for changes; alternates moves along the tour", () => {
    expect(clipPrompt(0)).toMatch(/Do not add, remove or change any object/);
    expect(clipPrompt(0)).toMatch(/No people/);
    expect(clipPrompt(0)).not.toBe(clipPrompt(1));
    expect(clipPrompt(4)).toBe(clipPrompt(0));
  });

  it("labels AI motion and AI stagings; untouched photos carry no label", () => {
    expect(aiLabel({ staged: false })).toBeNull();
    expect(aiLabel({ staged: true })).toBe("Ambientación virtual con IA");
    expect(aiLabel({ staged: false, clip: {} })).toBe("Movimiento generado con IA");
    expect(aiLabel({ staged: true, clip: {} })).toBe("Ambientación y movimiento con IA");
  });
});

describe("fal.ai queue", () => {
  it("sends the photo as a data URI with LTX-2 Fast's settings, without storing the request at fal", async () => {
    const req = await submitClip(Buffer.from("jpg"), "move");
    expect(req).toMatchObject({ requestId: "req-1", statusUrl: expect.stringMatching(/^https:\/\/queue\.fal\.run\//) });
    const sent = fal.submitted[0];
    expect(sent.url).toBe(`https://queue.fal.run/${DEFAULT_MODEL}`);
    expect(sent.headers.Authorization).toBe("Key test-key");
    expect(sent.headers["X-Fal-Store-IO"]).toBe("0");
    expect(JSON.parse(sent.headers["X-Fal-Object-Lifecycle-Preference"])).toEqual({ expiration_duration_seconds: 86400 });
    expect(sent.body).toMatchObject({ image_url: `data:image/jpeg;base64,${Buffer.from("jpg").toString("base64")}`, prompt: "move", duration: 6, resolution: "1080p", generate_audio: false });
    expect(clipInput("fal-ai/kling-video/v2.6/pro/image-to-video", Buffer.from("x"), "p")).toMatchObject({ duration: "5" });
  });

  it("reads states: pending, done with the clip, failed with the reason; busy fal is asked again", async () => {
    const req = await submitClip(Buffer.from("jpg"), "move");
    expect(await clipState(req)).toEqual({ state: "pending" });
    fal.state["req-1"] = "COMPLETED";
    expect(await clipState(req)).toEqual({ state: "done", url: "https://v3b.fal.media/files/req-1.mp4", durationMs: 6040 });
    fal.state["req-1"] = "ERROR";
    expect(await clipState(req)).toMatchObject({ state: "failed", reason: "model failed" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("busy", { status: 503 })));
    expect(await clipState(req)).toEqual({ state: "pending" });
  });

  it("never calls or downloads from addresses outside fal", async () => {
    expect(await clipState({ statusUrl: "https://evil.example/status", responseUrl: "https://queue.fal.run/x" })).toMatchObject({ state: "failed" });
    expect(isFalMedia("https://v3b.fal.media/files/a.mp4")).toBe(true);
    expect(isFalMedia("https://fal.media.evil.com/a.mp4")).toBe(false);
    expect(isFalMedia("http://v3b.fal.media/a.mp4")).toBe(false);
    expect(readResult({ video: { url: "https://169.254.169.254/latest" } })).toBeNull();
    await expect(downloadClip("https://example.com/a.mp4")).rejects.toThrow();
    await expect(submitClip(Buffer.from("x"), "p", "../../etc")).rejects.toThrow();
  });
});

describe("AI videos on the server", () => {
  const start = (extra: Record<string, unknown> = {}) =>
    startAiVideo({
      agencyId: AG,
      demoId: DEMO,
      actorId: USER,
      payerId: PAYER,
      key: crypto.randomUUID(),
      mode: "cinematic",
      format: "9:16",
      options: { photos: PHOTOS.slice(0, 4), staged: true, info: true, fields: ["title"] },
      ...extra,
    });
  const video = (id: string) => db.tables.property_videos.find((r) => r.id === id)!;
  const clips = (id: string) => (db.tables.property_video_clips ?? []).filter((c) => c.video_id === id);

  it("charges the credits first, then sends each photo (its staging when chosen) to be animated", async () => {
    const key = crypto.randomUUID();
    const v = await start({ key });
    expect(v.status).toBe("processing");
    expect(db.charges).toEqual([{ payer: PAYER, video: v.id, credits: 10 }]);
    expect(db.balance).toBe(90);
    expect(video(v.id)).toMatchObject({ provider: "fal", mode: "cinematic", animated_count: 4, credits_charged: 10, width: 1080, height: 1920, storage_path: `${AG}/${DEMO}/${v.id}.mp4` });
    expect(clips(v.id).map((c) => [c.position, c.status, c.staged, c.style])).toEqual([
      [0, "running", true, "moderno"],
      [1, "running", false, null],
      [2, "running", false, null],
      [3, "running", false, null],
    ]);
    expect(fal.submitted).toHaveLength(4);
    // The same key again: the same video, nothing charged or sent twice.
    expect((await start({ key })).id).toBe(v.id);
    expect(db.charges).toHaveLength(1);
    expect(fal.submitted).toHaveLength(4);
  });

  it("«Foto en movimiento»: one photo, 3 credits", async () => {
    const v = await start({ mode: "clip", options: { photos: [PHOTOS[1]], staged: true, info: false, fields: [] } });
    expect(db.charges[0].credits).toBe(3);
    expect(clips(v.id)).toHaveLength(1);
  });

  it("without enough credits nothing is created or sent", async () => {
    db.balance = 9;
    await expect(start()).rejects.toMatchObject({ status: 402, message: expect.stringMatching(/usa 10/) });
    expect(db.tables.property_videos).toHaveLength(0);
    expect(fal.submitted).toHaveLength(0);
  });

  it("refuses wrong photo counts, unknown photos and a missing provider key", async () => {
    await expect(start({ options: { photos: [PHOTOS[0]], staged: true, info: false, fields: [] } })).rejects.toMatchObject({ status: 400 });
    await expect(start({ options: { photos: PHOTOS, staged: true, info: false, fields: [] } })).rejects.toMatchObject({ status: 400 });
    await expect(start({ mode: "clip", options: { photos: ["00000000-0000-4000-8000-00000000ffff"], staged: true, info: false, fields: [] } })).rejects.toMatchObject({ status: 409 });
    await expect(start({ mode: "classic" })).rejects.toMatchObject({ status: 400 });
    delete process.env.FAL_KEY;
    await expect(start()).rejects.toMatchObject({ status: 503 });
    expect(db.charges).toHaveLength(0);
  });

  it("stays «Próximamente» until HABITA_VIDEO_AI=1, even with the provider's key", async () => {
    delete process.env.HABITA_VIDEO_AI;
    await expect(start()).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/todavía no está disponible/) });
    process.env.HABITA_VIDEO_AI = "0";
    await expect(start({ mode: "clip", options: { photos: [PHOTOS[0]], staged: true, info: false, fields: [] } })).rejects.toMatchObject({ status: 409 });
    expect(db.charges).toHaveLength(0);
    expect(fal.submitted).toHaveLength(0);
    const { aiVideoLive } = await import("../src/lib/video/fal");
    expect(aiVideoLive()).toBe(false);
    process.env.HABITA_VIDEO_AI = "1";
    expect(aiVideoLive()).toBe(true);
    delete process.env.FAL_KEY;
    expect(aiVideoLive()).toBe(false);
  });

  it("if the provider cannot take the photos, the video fails and the credits come back", async () => {
    fal.failSubmit = true;
    const v = await start();
    expect(v).toMatchObject({ status: "failed", error: expect.stringMatching(/devolvimos los créditos/) });
    expect(db.refunds).toEqual([v.id]);
    expect(db.balance).toBe(100);
  });

  it("moves forward on read: clips stored privately, then ready to be joined by the browser", async () => {
    const v = await start({ options: { photos: PHOTOS.slice(0, 2), staged: false, info: false, fields: [] } });
    await advanceAiVideos({ demoId: DEMO });
    let list = await listVideos(DEMO, () => "x.mp4");
    expect(list[0]).toMatchObject({ status: "processing", credits: 10, ai: { stage: "animating", done: 0, total: 2, clips: null } });
    fal.state["req-1"] = "COMPLETED";
    await advanceAiVideos({ demoId: DEMO });
    expect(db.uploads).toEqual([`${AG}/${DEMO}/${v.id}/clip-0.mp4`]);
    list = await listVideos(DEMO, () => "x.mp4");
    expect(list[0].ai).toMatchObject({ stage: "animating", done: 1, total: 2, items: ["ready", "running"] });
    await expect(aiUploadTarget(DEMO, v.id)).rejects.toMatchObject({ status: 409 });
    await expect(finishVideo({ demoId: DEMO, id: v.id, ok: true, durationMs: 1, error: null })).rejects.toMatchObject({ status: 409 });
    fal.state["req-2"] = "COMPLETED";
    await advanceAiVideos({ demoId: DEMO });
    expect(video(v.id).clips_ready_at).toBeTruthy();
    list = await listVideos(DEMO, () => "x.mp4");
    expect(list[0].ai).toEqual({
      stage: "joining",
      done: 2,
      total: 2,
      items: ["ready", "ready"],
      clips: [
        { url: `https://x/${AG}/${DEMO}/${v.id}/clip-0.mp4`, staged: false },
        { url: `https://x/${AG}/${DEMO}/${v.id}/clip-1.mp4`, staged: false },
      ],
    });
    // A failed join is only noted (the clips are paid): it can be retried.
    expect(await finishVideo({ demoId: DEMO, id: v.id, ok: false, durationMs: null, error: "Falló el armado" })).toMatchObject({ status: "processing", error: "Falló el armado" });
    const target = await aiUploadTarget(DEMO, v.id);
    expect(target.upload.path).toBe(`${AG}/${DEMO}/${v.id}.mp4`);
    db.files[target.upload.path] = 9_000_000;
    expect(await finishVideo({ demoId: DEMO, id: v.id, ok: true, durationMs: 11900, error: null })).toMatchObject({ status: "completed", size_bytes: 9_000_000 });
    expect(db.refunds).toHaveLength(0);
    // Done: nothing more is asked or downloaded.
    const downloads = fal.downloads;
    await advanceAiVideos({ demoId: DEMO });
    expect(fal.downloads).toBe(downloads);
  });

  it("a photo the model fails is sent once more; failing again fails the video and refunds once", async () => {
    const v = await start({ mode: "clip", options: { photos: [PHOTOS[2]], staged: false, info: false, fields: [] } });
    fal.state["req-1"] = "ERROR";
    await advanceAiVideos({ demoId: DEMO });
    expect(fal.submitted).toHaveLength(2);
    expect(clips(v.id)[0]).toMatchObject({ status: "running", attempts: 2 });
    fal.state["req-2"] = "ERROR";
    await advanceAiVideos({ demoId: DEMO });
    expect(video(v.id)).toMatchObject({ status: "failed", credits_charged: 0, error: expect.stringMatching(/devolvimos los créditos/) });
    expect(db.refunds).toEqual([v.id]);
    expect(db.balance).toBe(100);
    await advanceAiVideos({ demoId: DEMO });
    expect(db.refunds).toEqual([v.id]);
    expect(fal.submitted).toHaveLength(2);
  });

  it("an animation stuck past the limit is failed and refunded; the browser's rule never touches AI videos", async () => {
    const v = await start();
    video(v.id).created_at = new Date(Date.now() - AI_STALE_MS - 60_000).toISOString();
    video(v.id).updated_at = new Date(Date.now() - AI_STALE_MS - 60_000).toISOString();
    const list = await listVideos(DEMO, () => "x.mp4");
    expect(list[0].status).toBe("processing"); // listVideos alone: only browser renders are abandoned.
    await advanceAiVideos({ demoId: DEMO });
    expect(video(v.id)).toMatchObject({ status: "failed", error: expect.stringMatching(/tardó demasiado/) });
    expect(db.balance).toBe(100);
  });

  it("a failed video that still holds credits is refunded by the next read", async () => {
    const v = await start();
    Object.assign(video(v.id), { status: "failed" });
    await advanceAiVideos({ demoId: DEMO });
    expect(db.refunds).toEqual([v.id]);
  });
});

describe("credit functions", () => {
  let pg: PGlite;
  beforeAll(async () => {
    pg = new PGlite();
    await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
     create table auth.users(id uuid primary key, is_anonymous boolean not null default false);
     create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
     create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
     create table storage.objects(id uuid,name text,bucket_id text);alter table storage.objects enable row level security;
     create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
     grant usage on schema public to authenticated;`);
    for (const file of readdirSync("supabase/migrations").sort()) await pg.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
    // Idempotent: applying it again changes nothing.
    await pg.exec(readFileSync("supabase/migrations/202611210001_video_ai.sql", "utf8"));
  }, 60000);
  afterAll(async () => await pg?.close());

  it("charges across grants (soonest to expire first), never twice, and refunds exactly once", async () => {
    const payer = "00000000-0000-4000-8000-000000000301";
    await pg.query("insert into auth.users(id) values($1)", [payer]);
    await pg.query("insert into profiles(id) values($1)", [payer]);
    const soon = (await pg.query<{ id: string }>("insert into credit_grants(user_id,source_key,total,remaining,expires_at) values($1,'pack:a',6,4,now()+interval '3 days') returning id", [payer])).rows[0].id;
    const later = (await pg.query<{ id: string }>("insert into credit_grants(user_id,source_key,total,remaining) values($1,'pack:b',20,20) returning id", [payer])).rows[0].id;
    await pg.query("insert into credit_grants(user_id,source_key,total,remaining) values($1,'trial:x',25,25)", [payer]);
    const agency = (await pg.query<{ id: string }>("insert into agencies(name) values('Inmo') returning id")).rows[0].id;
    const prop = (await pg.query<{ id: string }>("insert into demo_properties(agency_id,title) values($1,'Casa') returning id", [agency])).rows[0].id;
    const demo = (await pg.query<{ id: string }>("insert into demos(agency_id,property_id,token) values($1,$2,'tok_abcdefghijklmnopqrstuvwy') returning id", [agency, prop])).rows[0].id;
    const newVideo = async (mode: string) =>
      (
        await pg.query<{ id: string }>(
          "insert into property_videos(agency_id,demo_id,actor_id,idempotency_key,mode,format,photo_count,provider) values($1,$2,$3,$4,$5,'9:16',4,'fal') returning id",
          [agency, demo, payer, crypto.randomUUID(), mode],
        )
      ).rows[0].id;
    const remaining = async () => (await pg.query<{ id: string; remaining: number }>("select id,remaining from credit_grants where user_id=$1 order by source_key", [payer])).rows;

    const v = await newVideo("cinematic");
    expect((await pg.query("select habita_video_charge($1,$2,10) as n", [payer, v])).rows[0]).toEqual({ n: 10 });
    expect(await remaining()).toEqual([
      { id: soon, remaining: 0 },
      { id: later, remaining: 14 },
      expect.objectContaining({ remaining: 25 }), // The free trial never pays a video.
    ]);
    expect((await pg.query("select credits_charged,payer_id from property_videos where id=$1", [v])).rows[0]).toEqual({ credits_charged: 10, payer_id: payer });
    // Charging the same video again takes nothing.
    await pg.query("select habita_video_charge($1,$2,10)", [payer, v]);
    expect((await remaining())[1].remaining).toBe(14);
    const ledger = await pg.query<{ grant_id: string; delta: number; reason: string }>("select grant_id,delta,reason from credit_ledger where video_id=$1 order by id", [v]);
    expect(ledger.rows).toEqual([
      { grant_id: soon, delta: -4, reason: "video_reserved" },
      { grant_id: later, delta: -6, reason: "video_reserved" },
    ]);

    // Short balance: nothing is taken.
    const big = await newVideo("cinematic");
    await expect(pg.query("select habita_video_charge($1,$2,15)", [payer, big])).rejects.toThrow(/NO_CREDITS/);
    expect((await remaining())[1].remaining).toBe(14);

    // Refund: to the same grants, once.
    expect((await pg.query("select habita_video_refund($1) as n", [v])).rows[0]).toEqual({ n: 10 });
    expect((await pg.query("select habita_video_refund($1) as n", [v])).rows[0]).toEqual({ n: 0 });
    expect((await remaining()).slice(0, 2)).toEqual([
      { id: soon, remaining: 4 },
      { id: later, remaining: 20 },
    ]);
    expect((await pg.query("select credits_charged from property_videos where id=$1", [v])).rows[0]).toEqual({ credits_charged: 0 });
    expect((await pg.query("select count(*)::int as n from credit_ledger where video_id=$1 and reason='video_refund'", [v])).rows[0]).toEqual({ n: 2 });
  });

  it("clips belong to a video, one per position, known states; nothing for anon/authenticated", async () => {
    const payer = "00000000-0000-4000-8000-000000000302";
    await pg.query("insert into auth.users(id) values($1)", [payer]);
    const agency = (await pg.query<{ id: string }>("insert into agencies(name) values('Otra') returning id")).rows[0].id;
    const prop = (await pg.query<{ id: string }>("insert into demo_properties(agency_id,title) values($1,'Depto') returning id", [agency])).rows[0].id;
    const demo = (await pg.query<{ id: string }>("insert into demos(agency_id,property_id,token) values($1,$2,'tok_abcdefghijklmnopqrstuvwz') returning id", [agency, prop])).rows[0].id;
    const v = (
      await pg.query<{ id: string }>("insert into property_videos(agency_id,demo_id,actor_id,idempotency_key,mode,format,photo_count,provider) values($1,$2,$3,$4,'clip','16:9',1,'fal') returning id", [agency, demo, payer, crypto.randomUUID()])
    ).rows[0].id;
    const ins = "insert into property_video_clips(video_id,position,photo_id,model,status) values($1,$2,$3,'fal-ai/ltx-2/image-to-video/fast',$4)";
    await pg.query(ins, [v, 0, crypto.randomUUID(), "pending"]);
    await expect(pg.query(ins, [v, 0, crypto.randomUUID(), "pending"])).rejects.toThrow(/unique|duplicate/i);
    await expect(pg.query(ins, [v, 1, crypto.randomUUID(), "dreaming"])).rejects.toThrow(/check/i);
    await pg.exec("set role authenticated");
    await expect(pg.query("select * from property_video_clips")).rejects.toThrow(/permission/i);
    await expect(pg.query("select habita_video_refund($1)", [v])).rejects.toThrow(/permission/i);
    await pg.exec("reset role");
  });
});
