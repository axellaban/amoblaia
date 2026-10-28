import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { viewersOf, type DemoViewRow } from "../src/lib/demos/shared";

const team = (email: string) => email === "equipo@habita.test";
const row = (over: Partial<DemoViewRow> & { visitor: string }): DemoViewRow => ({
  user_id: null,
  viewer_email: null,
  views: 1,
  first_viewed_at: "2026-10-28T10:00:00.000000+00:00",
  last_viewed_at: "2026-10-28T10:00:00.000000+00:00",
  ...over,
});

describe("viewersOf", () => {
  it("says nobody opened the link when there are no rows", () => {
    expect(viewersOf([], team)).toEqual({ people: 0, lastAt: null, viewers: [] });
  });

  it("does not count the team's own visits, but still lists them", () => {
    const access = viewersOf(
      [
        row({ visitor: "cuenta:1", user_id: "1", viewer_email: "equipo@habita.test", last_viewed_at: "2026-10-28T18:00:00.000000+00:00" }),
        row({ visitor: "visitante:a", last_viewed_at: "2026-10-27T09:00:00.000000+00:00" }),
      ],
      team,
    );
    expect(access.people).toBe(1);
    expect(access.lastAt).toBe("2026-10-27T09:00:00.000000+00:00");
    expect(access.viewers.map((v) => v.kind)).toEqual(["team", "visitor"]);
    expect(access.viewers[0].label).toBe("equipo@habita.test");
  });

  it("names accounts by e-mail and visitors without one by their first visit", () => {
    const access = viewersOf(
      [
        row({ visitor: "visitante:b", first_viewed_at: "2026-10-28T12:00:00.000000+00:00", last_viewed_at: "2026-10-28T12:00:00.000000+00:00" }),
        row({ visitor: "visitante:a", first_viewed_at: "2026-10-27T08:00:00.000000+00:00", last_viewed_at: "2026-10-27T08:00:00.000000+00:00" }),
        row({ visitor: "cuenta:9", user_id: "9", viewer_email: "comprador@mail.test", views: 3, last_viewed_at: "2026-10-28T15:00:00.000000+00:00" }),
      ],
      team,
    );
    expect(access.people).toBe(3);
    expect(access.viewers.map((v) => v.label)).toEqual(["comprador@mail.test", "Visitante 2", "Visitante 1"]);
    expect(access.viewers[0]).toMatchObject({ kind: "account", views: 3 });
    expect(access.lastAt).toBe("2026-10-28T15:00:00.000000+00:00");
  });
});

let db: PGlite;
let n = 0;
const id = () => `00000000-0000-4000-8000-${String(800000000000 + ++n).padStart(12, "0")}`;
const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
   create table auth.users(id uuid primary key, is_anonymous boolean not null default false);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create table storage.objects(id uuid,name text,bucket_id text);alter table storage.objects enable row level security;
   create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;`);
  for (const file of readdirSync("supabase/migrations").sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
}, 30000);
afterAll(async () => await db?.close());

async function publishedDemo() {
  const agency = (await one<{ id: string }>("insert into agencies(name) values('Inmobiliaria Norte') returning id"))!.id;
  const property = (await one<{ id: string }>(
    "insert into demo_properties(agency_id,title) values($1,'Casa 4 ambientes') returning id",
    [agency],
  ))!.id;
  return (await one<{ id: string }>(
    "insert into demos(agency_id,property_id,token,status) values($1,$2,$3,'published') returning id",
    [agency, property, `tok_${id().replace(/-/g, "")}`],
  ))!.id;
}
const record = (demo: string, visitor: string, user: string | null = null, email: string | null = null) =>
  db.query("select amobla_record_demo_view($1,$2,$3,$4)", [demo, visitor, user, email]);

describe("amobla_record_demo_view", () => {
  it("counts a browser once per row and adds its later visits", async () => {
    const demo = await publishedDemo();
    await record(demo, "visitante:uno");
    await record(demo, "visitante:uno");
    const rows = (await db.query<DemoViewRow>("select * from demo_views where demo_id=$1", [demo])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].views).toBe(2);
  });

  it("keeps the account of a signed-in visit and does not drop it on a later anonymous one", async () => {
    const demo = await publishedDemo();
    const user = id();
    await record(demo, `cuenta:${user}`, user, "comprador@mail.test");
    await record(demo, `cuenta:${user}`, null, null);
    const row = await one<{ user_id: string; viewer_email: string; views: number }>(
      "select user_id,viewer_email,views from demo_views where demo_id=$1",
      [demo],
    );
    expect(row).toEqual({ user_id: user, viewer_email: "comprador@mail.test", views: 2 });
  });

  it("is not callable by browsers", async () => {
    await db.exec("set role authenticated");
    await expect(db.query("select amobla_record_demo_view($1,'visitante:x',null,null)", [id()])).rejects.toThrow();
    await db.exec("reset role");
  });
});
