import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Public showcases: what a buyer may see is decided in SQL, so it is tested
// against the real migrations.
let db: PGlite;
const owner = "00000000-0000-4000-8000-0000000000a1",
  stranger = "00000000-0000-4000-8000-0000000000a2",
  living = "00000000-0000-4000-8000-0000000000b1",
  bedroom = "00000000-0000-4000-8000-0000000000b2",
  outside = "00000000-0000-4000-8000-0000000000b3", // owner's, not in the showcase
  foreign = "00000000-0000-4000-8000-0000000000b4", // stranger's
  reviewed = "00000000-0000-4000-8000-0000000000c1",
  pending = "00000000-0000-4000-8000-0000000000c2",
  retouch = "00000000-0000-4000-8000-0000000000c3",
  running = "00000000-0000-4000-8000-0000000000c4",
  bedroomReviewed = "00000000-0000-4000-8000-0000000000c5",
  outsideReviewed = "00000000-0000-4000-8000-0000000000c6",
  foreignReviewed = "00000000-0000-4000-8000-0000000000c7",
  showcase = "00000000-0000-4000-8000-0000000000d1",
  strangerShowcase = "00000000-0000-4000-8000-0000000000d2",
  token = "tok_PublicShowcaseToken_0001",
  strangerToken = "tok_StrangerShowcaseTok_002";

async function one<T>(sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows[0];
}
const publicData = async (t = token) =>
  (
    await one<{ data: Record<string, unknown> | null }>(
      "select amobla_public_showcase($1) as data",
      [t],
    )
  ).data;
const asset = async (kind: string, id: string | null, t = token) =>
  (
    await one<{ path: string | null }>(
      "select amobla_public_showcase_asset($1,$2,$3) as path",
      [t, kind, id ?? "00000000-0000-0000-0000-000000000000"],
    )
  ).path;
const review = (user: string, id: string, action: string) =>
  db.query("select amobla_review_generation($1,$2,$3)", [user, id, action]);
const setRooms = (user: string, id: string, rooms: unknown) =>
  db.query("select amobla_set_showcase_rooms($1,$2,$3::jsonb)", [
    user,
    id,
    JSON.stringify(rooms),
  ]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid,name text,bucket_id text);alter table storage.objects enable row level security;create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;insert into auth.users values('${owner}'),('${stranger}');`,
  );
  for (const file of readdirSync("supabase/migrations").sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  // Re-running the showcase migration must be harmless.
  await db.exec(
    readFileSync(
      "supabase/migrations/202610240001_property_showcases.sql",
      "utf8",
    ),
  );
  await db.query("select amobla_account($1,false),amobla_account($2,false)", [
    owner,
    stranger,
  ]);
  await db.exec(`
   insert into projects(id,user_id,original_hash,original_path,name,original_bytes) values
    ('${living}','${owner}','h1','${owner}/h1/original.jpg','Calle Falsa 123 - living privado',100),
    ('${bedroom}','${owner}','h2','${owner}/h2/original.jpg','dormitorio.jpg',100),
    ('${outside}','${owner}','h3','${owner}/h3/original.jpg','otra-propiedad.jpg',100),
    ('${foreign}','${stranger}','h4','${stranger}/h4/original.jpg','ajena.jpg',100);
   insert into generations(id,user_id,project_id,request_key,room,style,mode,prompt,status,result_path,reviewed_at,created_at) values
    ('${reviewed}','${owner}','${living}',gen_random_uuid(),'living','modern','furnish','p','succeeded','${owner}/${living}/r.jpg',now(),now()-interval '3 min'),
    ('${pending}','${owner}','${living}',gen_random_uuid(),'living','scandinavian','furnish','p','succeeded','${owner}/${living}/p.jpg',null,now()-interval '2 min'),
    ('${retouch}','${owner}','${living}',gen_random_uuid(),'living','modern','enhance','p','succeeded','${owner}/${living}/e.jpg',null,now()-interval '1 min'),
    ('${running}','${owner}','${living}',gen_random_uuid(),'living','modern','furnish','p','running',null,null,now()),
    ('${bedroomReviewed}','${owner}','${bedroom}',gen_random_uuid(),'bedroom','industrial','redesign','p','succeeded','${owner}/${bedroom}/b.jpg',now(),now()),
    ('${outsideReviewed}','${owner}','${outside}',gen_random_uuid(),'living','modern','furnish','p','succeeded','${owner}/${outside}/o.jpg',now(),now()),
    ('${foreignReviewed}','${stranger}','${foreign}',gen_random_uuid(),'living','modern','furnish','p','succeeded','${stranger}/${foreign}/f.jpg',now(),now());
   insert into showcases(id,user_id,token,title,agency_name,whatsapp,agency_logo_path) values
    ('${showcase}','${owner}','${token}','Depto 3 ambientes','Inmobiliaria Sur','5492235551234','${owner}/showcases/${showcase}/logo.jpg'),
    ('${strangerShowcase}','${stranger}','${strangerToken}','Ajena',null,'5491100000000',null);
  `);
}, 60000);
afterAll(async () => await db?.close());

describe("Proposal review", () => {
  it("only lets the owner review finished staging proposals", async () => {
    await expect(review(stranger, pending, "review")).rejects.toThrow(
      "GENERATION_NOT_FOUND",
    );
    await expect(review(owner, retouch, "review")).rejects.toThrow(
      "NOT_REVIEWABLE",
    );
    await expect(review(owner, running, "review")).rejects.toThrow(
      "NOT_REVIEWABLE",
    );
    await expect(review(owner, pending, "publish")).rejects.toThrow(
      "BAD_ACTION",
    );
  });
  it("reviews, unreviews and discards without touching credits", async () => {
    const before = await one<{ n: number }>(
      "select coalesce(sum(remaining),0)::int as n from credit_grants where user_id=$1",
      [owner],
    );
    await review(owner, pending, "review");
    expect(
      (await one<{ r: string | null }>(
        "select reviewed_at as r from generations where id=$1",
        [pending],
      )).r,
    ).not.toBeNull();
    await review(owner, pending, "unreview");
    await review(owner, pending, "discard");
    const row = await one<{ reviewed_at: string | null; discarded_at: string | null; status: string }>(
      "select reviewed_at,discarded_at,status from generations where id=$1",
      [pending],
    );
    expect(row.reviewed_at).toBeNull();
    expect(row.discarded_at).not.toBeNull();
    expect(row.status).toBe("succeeded");
    await expect(review(owner, pending, "review")).rejects.toThrow(
      "NOT_REVIEWABLE",
    );
    const after = await one<{ n: number }>(
      "select coalesce(sum(remaining),0)::int as n from credit_grants where user_id=$1",
      [owner],
    );
    expect(after.n).toBe(before.n);
  });
});

describe("Showcase rooms", () => {
  it("refuses another user's showcase or photos", async () => {
    await expect(
      setRooms(stranger, showcase, [{ project_id: foreign, label: "Living" }]),
    ).rejects.toThrow("SHOWCASE_NOT_FOUND");
    await expect(
      setRooms(owner, showcase, [{ project_id: foreign, label: "Living" }]),
    ).rejects.toThrow("PROJECT_NOT_FOUND");
    await expect(
      setRooms(owner, showcase, [{ project_id: "not-a-uuid", label: "X" }]),
    ).rejects.toThrow("PROJECT_NOT_FOUND");
  });
  it("validates labels, duplicates and size", async () => {
    await expect(
      setRooms(owner, showcase, [{ project_id: living, label: "  " }]),
    ).rejects.toThrow("INVALID_ROOM_LABEL");
    await expect(
      setRooms(owner, showcase, [
        { project_id: living, label: "Living" },
        { project_id: living, label: "Otra vez" },
      ]),
    ).rejects.toThrow("DUPLICATE_ROOM");
    await expect(
      setRooms(
        owner,
        showcase,
        Array.from({ length: 21 }, () => ({ project_id: living, label: "L" })),
      ),
    ).rejects.toThrow("TOO_MANY_ROOMS");
  });
  it("replaces the rooms atomically and in order", async () => {
    await setRooms(owner, showcase, [
      { project_id: bedroom, label: "Dormitorio principal" },
      { project_id: living, label: "Living comedor" },
    ]);
    const rows = await db.query<{ label: string; position: number }>(
      "select label,position from showcase_rooms where showcase_id=$1 order by position",
      [showcase],
    );
    expect(rows.rows.map((r) => r.label)).toEqual([
      "Dormitorio principal",
      "Living comedor",
    ]);
  });
});

describe("What a buyer can see", () => {
  it("shows only reviewed staging proposals, without private data", async () => {
    const data = await publicData();
    expect(data).not.toBeNull();
    const rooms = data!.rooms as {
      id: string;
      label: string;
      proposals: { id: string; style: string; mode: string }[];
    }[];
    expect(rooms.map((r) => r.label)).toEqual([
      "Dormitorio principal",
      "Living comedor",
    ]);
    expect(rooms[0].proposals.map((p) => p.id)).toEqual([bedroomReviewed]);
    // Unreviewed, discarded, retouched and unfinished proposals stay out.
    expect(rooms[1].proposals.map((p) => p.id)).toEqual([reviewed]);
    expect(data!.title).toBe("Depto 3 ambientes");
    expect(data!.whatsapp).toBe("5492235551234");
    expect(data!.hasLogo).toBe(true);
    const text = JSON.stringify(data);
    for (const secret of [
      owner,
      living,
      bedroom,
      "Calle Falsa",
      "original.jpg",
      "logo.jpg",
      "prompt",
    ])
      expect(text).not.toContain(secret);
  });
  it("serves only images that belong to the active showcase", async () => {
    const data = await publicData();
    const [bedroomRoom, livingRoom] = data!.rooms as { id: string }[];
    expect(await asset("original", livingRoom.id)).toBe(
      `${owner}/h1/original.jpg`,
    );
    expect(await asset("original", bedroomRoom.id)).toBe(
      `${owner}/h2/original.jpg`,
    );
    expect(await asset("proposal", reviewed)).toBe(
      `${owner}/${living}/r.jpg`,
    );
    expect(await asset("logo", null)).toBe(
      `${owner}/showcases/${showcase}/logo.jpg`,
    );
    for (const id of [pending, retouch, running, outsideReviewed, foreignReviewed])
      expect(await asset("proposal", id)).toBeNull();
    // A room id of another showcase, or a project id instead of a room id.
    expect(await asset("original", living)).toBeNull();
    expect(await asset("proposal", reviewed, strangerToken)).toBeNull();
    expect(await asset("unknown", reviewed)).toBeNull();
  });
  it("hides a room whose photo went to the trash", async () => {
    await db.query("update projects set trashed_at=now() where id=$1", [
      bedroom,
    ]);
    const rooms = (await publicData())!.rooms as { label: string }[];
    expect(rooms.map((r) => r.label)).toEqual(["Living comedor"]);
    expect(await asset("proposal", bedroomReviewed)).toBeNull();
    await db.query("update projects set trashed_at=null where id=$1", [
      bedroom,
    ]);
  });
  it("turning the link off hides the showcase and every image", async () => {
    const rooms = (await publicData())!.rooms as { id: string }[];
    await db.query("update showcases set active=false where id=$1", [showcase]);
    expect(await publicData()).toBeNull();
    expect(await asset("original", rooms[0].id)).toBeNull();
    expect(await asset("proposal", reviewed)).toBeNull();
    expect(await asset("logo", null)).toBeNull();
    await db.query("update showcases set active=true where id=$1", [showcase]);
    expect(await publicData()).not.toBeNull();
    await db.query("update showcases set deleted_at=now() where id=$1", [
      strangerShowcase,
    ]);
    expect(await publicData(strangerToken)).toBeNull();
    expect(await publicData("tok_DoesNotExist_000000000")).toBeNull();
  });
});

describe("Database permissions", () => {
  it("keeps showcases private to their owner and functions to the server", async () => {
    await db.exec(
      `set role authenticated; select set_config('request.jwt.claim.sub','${stranger}',false);`,
    );
    const visible = await db.query<{ title: string }>(
      "select title from showcases",
    );
    expect(visible.rows.map((r) => r.title)).toEqual(["Ajena"]);
    expect(
      (await db.query("select * from showcase_rooms")).rows,
    ).toHaveLength(0);
    await expect(
      db.query("update showcases set active=false"),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query("select amobla_public_showcase($1)", [token]),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query("select amobla_review_generation($1,$2,'review')", [
        stranger,
        reviewed,
      ]),
    ).rejects.toThrow(/permission denied/);
    await db.exec("reset role; set role anon;");
    await expect(db.query("select * from showcases")).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      db.query("select amobla_public_showcase_asset($1,'logo',null)", [token]),
    ).rejects.toThrow(/permission denied/);
    await db.exec("reset role;");
  });
});
