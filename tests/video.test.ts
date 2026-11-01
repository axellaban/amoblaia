// Fase 5B: the "Clásico" video. The plan (pure), the server's job rows and
// links, and the table: idempotent, owned by the property, completed only
// when the MP4 is really stored, never left "processing".
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

const store = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  files: {} as Record<string, number>,
  uploads: [] as string[],
  staleUpdates: 0,
}));
vi.mock("@/lib/supabase/server", () => {
  const query = () => {
    const f: Record<string, unknown> = {};
    const lt: Record<string, string> = {};
    const inF: Record<string, unknown[]> = {};
    let update: Record<string, unknown> | null = null;
    let insert: Record<string, unknown> | null = null;
    const match = () => store.rows.filter((r) => Object.entries(f).every(([k, v]) => r[k] === v) && Object.entries(inF).every(([k, v]) => v.includes(r[k])) && Object.entries(lt).every(([k, v]) => String(r[k]) < v));
    const run = () => {
      if (insert) {
        const row = { id: `00000000-0000-4000-8000-${String(store.rows.length + 1).padStart(12, "0")}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), storage_path: null, ...insert };
        store.rows.push(row);
        return [row];
      }
      const rows = match();
      if (update) {
        if (Object.keys(lt).length) store.staleUpdates += rows.length;
        for (const r of rows) Object.assign(r, update);
      }
      return rows;
    };
    const b = {
      select: () => b,
      eq: (k: string, v: unknown) => ((f[k] = v), b),
      in: (k: string, v: unknown[]) => ((inF[k] = v), b),
      lt: (k: string, v: string) => ((lt[k] = v), b),
      order: () => b,
      limit: () => b,
      insert: (row: Record<string, unknown>) => ((insert = row), b),
      update: (row: Record<string, unknown>) => ((update = row), b),
      single: async () => ({ data: run()[0] ?? null, error: null }),
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      then: (resolve: (v: { data: unknown; error: null }) => void) => resolve({ data: run(), error: null }),
    };
    return b;
  };
  const storage = {
    from: () => ({
      createSignedUploadUrl: async (path: string) => (store.uploads.push(path), { data: { path, token: "tok", signedUrl: "https://x/upload" }, error: null }),
      list: async (folder: string, opts: { search: string }) => {
        const path = `${folder}/${opts.search}`;
        return { data: store.files[path] ? [{ name: opts.search, metadata: { size: store.files[path] } }] : [], error: null };
      },
      createSignedUrl: async (path: string, _s: number, o?: { download?: string }) => ({ data: { signedUrl: `https://x/${path}${o?.download ? `?dl=${o.download}` : ""}` }, error: null }),
    }),
  };
  return { adminClient: () => ({ from: () => query(), storage }), currentUser: async () => null };
});

import { coverCrop, planVideo, sceneAt, suggestPhotos, MAX_VIDEO_PHOTOS } from "../src/lib/video/plan";
import { createVideo, finishVideo, listVideos, MAX_VIDEO_BYTES, STALE_MS } from "../src/lib/video/server";

const AG = "00000000-0000-4000-8000-0000000000a1";
const DEMO = "00000000-0000-4000-8000-0000000000d1";
const USER = "00000000-0000-4000-8000-000000000001";
const key = () => crypto.randomUUID();

describe("Video plan", () => {
  it("intro + one scene per photo + outro, crossfaded, at 30 fps", () => {
    const p = planVideo(4, "9:16");
    expect(p.scenes.map((s) => s.kind)).toEqual(["intro", "photo", "photo", "photo", "photo", "outro"]);
    expect(p).toMatchObject({ width: 1080, height: 1920, fps: 30, durationMs: 2400 + 4 * 3200 + 3000 - 5 * 700 });
    expect(p.frames).toBe(Math.ceil((p.durationMs / 1000) * 30));
    expect(planVideo(1, "16:9")).toMatchObject({ width: 1920, height: 1080 });
    expect(() => planVideo(0, "9:16")).toThrow();
    expect(() => planVideo(MAX_VIDEO_PHOTOS + 1, "9:16")).toThrow();
  });
  it("fades into the next scene only in the overlap", () => {
    const p = planVideo(2, "9:16");
    expect(sceneAt(p, 500)).toMatchObject({ mix: 0, next: null, scene: { kind: "intro" } });
    const mid = sceneAt(p, 2400 - 350);
    expect(mid.scene.kind).toBe("intro");
    expect(mid.next?.kind).toBe("photo");
    expect(mid.mix).toBeCloseTo(0.5, 1);
    expect(sceneAt(p, p.durationMs + 1000).scene.kind).toBe("outro");
  });
  it("crops like «cover»: never outside the photo, never stretched", () => {
    for (const [img, frame] of [[{ width: 4000, height: 3000 }, { width: 1080, height: 1920 }], [{ width: 1200, height: 1600 }, { width: 1920, height: 1080 }]] as const)
      for (const zoom of [1, 1.1])
        for (const pan of [-1, 0, 1]) {
          const c = coverCrop(img, frame, zoom, pan, -pan);
          expect(c.sx).toBeGreaterThanOrEqual(-1e-6);
          expect(c.sy).toBeGreaterThanOrEqual(-1e-6);
          expect(c.sx + c.sw).toBeLessThanOrEqual(img.width + 1e-6);
          expect(c.sy + c.sh).toBeLessThanOrEqual(img.height + 1e-6);
          expect(c.sw / c.sh).toBeCloseTo(frame.width / frame.height, 5);
        }
  });
  it("suggests staged photos first, in order, up to 8", () => {
    const photos = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, staged: i % 3 === 0 }));
    expect(suggestPhotos(photos).map((p) => p.id)).toEqual(["p0", "p3", "p6", "p9", "p1", "p2", "p4", "p5"]);
  });
});

describe("Video jobs on the server", () => {
  beforeEach(() => {
    store.rows.length = 0;
    store.files = {};
    store.uploads.length = 0;
    store.staleUpdates = 0;
  });
  const create = (k = key(), extra: Record<string, unknown> = {}) =>
    createVideo({ agencyId: AG, demoId: DEMO, actorId: USER, key: k, mode: "classic", format: "9:16", photoCount: 4, ...extra });

  it("creates one row per key, with an upload address under the agency and property", async () => {
    const k = key();
    const a = await create(k);
    const b = await create(k);
    expect(a.id).toBe(b.id);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ status: "processing", provider: "browser", credits_charged: 0, mode: "classic" });
    expect(a.upload?.path).toBe(`${AG}/${DEMO}/${a.id}.mp4`);
  });

  it("refuses AI modes until they are live, unknown formats and bad photo counts", async () => {
    await expect(create(key(), { mode: "cinematic" })).rejects.toMatchObject({ status: 409 });
    await expect(create(key(), { mode: "teleport" })).rejects.toMatchObject({ status: 400 });
    await expect(create(key(), { format: "1:1" })).rejects.toMatchObject({ status: 400 });
    await expect(create(key(), { photoCount: 0 })).rejects.toMatchObject({ status: 400 });
    await expect(create("not-a-key")).rejects.toMatchObject({ status: 400 });
  });

  it("a key reused for another property or person is refused", async () => {
    const k = key();
    await create(k);
    await expect(createVideo({ agencyId: AG, demoId: "00000000-0000-4000-8000-0000000000d2", actorId: USER, key: k, mode: "classic", format: "9:16", photoCount: 4 })).rejects.toMatchObject({ status: 409 });
  });

  it("is completed only when the MP4 is in storage and within the limit", async () => {
    const v = await create();
    await expect(finishVideo({ demoId: DEMO, id: v.id, ok: true, durationMs: 14700, error: null })).rejects.toMatchObject({ status: 409 });
    store.files[v.upload!.path] = MAX_VIDEO_BYTES + 1;
    await expect(finishVideo({ demoId: DEMO, id: v.id, ok: true, durationMs: 14700, error: null })).rejects.toMatchObject({ status: 413 });
    store.files[v.upload!.path] = 8_000_000;
    const done = await finishVideo({ demoId: DEMO, id: v.id, ok: true, durationMs: 14700, error: null });
    expect(done).toMatchObject({ status: "completed", size_bytes: 8_000_000, duration_ms: 14700 });
    // Finishing again changes nothing; another property's video is not found.
    expect((await finishVideo({ demoId: DEMO, id: v.id, ok: false, durationMs: null, error: "x" })).status).toBe("completed");
    await expect(finishVideo({ demoId: "00000000-0000-4000-8000-0000000000d2", id: v.id, ok: true, durationMs: 1, error: null })).rejects.toMatchObject({ status: 404 });
  });

  it("a failed render is recorded with its reason", async () => {
    const v = await create();
    expect(await finishVideo({ demoId: DEMO, id: v.id, ok: false, durationMs: null, error: "Cancelaste el video." })).toMatchObject({ status: "failed", error: "Cancelaste el video." });
  });

  it("lists with short links only for completed videos, and fails abandoned renders", async () => {
    const v = await create();
    store.files[v.upload!.path] = 1000;
    await finishVideo({ demoId: DEMO, id: v.id, ok: true, durationMs: 1000, error: null });
    const old = await create();
    const row = store.rows.find((r) => r.id === old.id)!;
    row.updated_at = new Date(Date.now() - STALE_MS - 60_000).toISOString();
    const list = await listVideos(DEMO, () => "casa-vertical.mp4");
    expect(store.staleUpdates).toBe(1);
    expect(list.find((x) => x.id === old.id)).toMatchObject({ status: "failed", url: null });
    expect(list.find((x) => x.id === v.id)).toMatchObject({ status: "completed", url: expect.stringContaining(".mp4"), downloadUrl: expect.stringContaining("dl=casa-vertical.mp4") });
  });
});

describe("property_videos table", () => {
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
    await pg.exec(readFileSync("supabase/migrations/202611190001_property_videos.sql", "utf8"));
  }, 30000);
  afterAll(async () => await pg?.close());

  it("private bucket for MP4 only; one row per key; known states; no access for anon/authenticated", async () => {
    expect((await pg.query("select public, allowed_mime_types from storage.buckets where id='property-videos'")).rows[0]).toEqual({ public: false, allowed_mime_types: ["video/mp4"] });
    const user = "00000000-0000-4000-8000-000000000201";
    await pg.query("insert into auth.users(id) values($1)", [user]);
    const agency = (await pg.query<{ id: string }>("insert into agencies(name) values('Inmo') returning id")).rows[0].id;
    const prop = (await pg.query<{ id: string }>("insert into demo_properties(agency_id,title) values($1,'Casa') returning id", [agency])).rows[0].id;
    const demo = (await pg.query<{ id: string }>("insert into demos(agency_id,property_id,token) values($1,$2,'tok_abcdefghijklmnopqrstuvwx') returning id", [agency, prop])).rows[0].id;
    const k = crypto.randomUUID();
    const ins = "insert into property_videos(agency_id,demo_id,actor_id,idempotency_key,mode,format,photo_count) values($1,$2,$3,$4,$5,$6,$7)";
    await pg.query(ins, [agency, demo, user, k, "classic", "9:16", 4]);
    await expect(pg.query(ins, [agency, demo, user, k, "classic", "9:16", 4])).rejects.toThrow(/unique|duplicate/i);
    await expect(pg.query(ins, [agency, demo, user, crypto.randomUUID(), "classic", "1:1", 4])).rejects.toThrow(/check/i);
    await expect(pg.query(ins, [agency, demo, user, crypto.randomUUID(), "classic", "9:16", 31])).rejects.toThrow(/check/i);
    await pg.exec("set role authenticated");
    await expect(pg.query("select * from property_videos")).rejects.toThrow(/permission/i);
    await pg.exec("reset role");
  });
});
