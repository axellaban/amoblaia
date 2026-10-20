import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, afterAll, it, expect, describe } from "vitest";
let db: PGlite;
const u = "00000000-0000-4000-8000-000000000011",
  v = "00000000-0000-4000-8000-000000000012",
  p = "00000000-0000-4000-8000-000000000013",
  f = "00000000-0000-4000-8000-000000000014",
  foreign = "00000000-0000-4000-8000-000000000015";
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid,name text,bucket_id text);alter table storage.objects enable row level security;create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;insert into auth.users values('${u}'),('${v}');`,
  );
  for (const file of readdirSync("supabase/migrations").sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await db.query("select amobla_account($1,true),amobla_account($2,true)", [
    u,
    v,
  ]);
  await db.exec(
    `insert into folders(id,user_id,name) values('${f}','${u}','Palermo'),('${foreign}','${v}','Private');insert into projects(id,user_id,original_hash,original_path,name,original_bytes) values('${p}','${u}','hash','image.jpg','Foto',100);`,
  );
}, 30000);
afterAll(async () => await db?.close());
describe("Private library operations", () => {
  it("does not rename or move another user's project", async () => {
    await expect(
      db.query("select amobla_manage_project($1,$2,'rename','Hacked')", [v, p]),
    ).rejects.toThrow("PROJECT_NOT_FOUND");
    await expect(
      db.query("select amobla_manage_project($1,$2,'move',null,$3)", [
        u,
        p,
        foreign,
      ]),
    ).rejects.toThrow("FOLDER_NOT_FOUND");
  });
  it("renames, assigns, trashes and restores without deleting the image or resetting usage", async () => {
    await db.query("select amobla_manage_project($1,$2,'rename','Mi living')", [
      u,
      p,
    ]);
    await db.query("select amobla_manage_project($1,$2,'move',null,$3)", [
      u,
      p,
      f,
    ]);
    await db.query("select amobla_manage_project($1,$2,'trash')", [u, p]);
    const row = (
      await db.query<{
        name: string;
        folder_id: string;
        trashed_at: string | null;
        deleted_at: string | null;
      }>(
        "select name,folder_id,trashed_at,deleted_at from projects where id=$1",
        [p],
      )
    ).rows[0];
    expect(row.name).toBe("Mi living");
    expect(row.folder_id).toBe(f);
    expect(row.trashed_at).not.toBeNull();
    expect(row.deleted_at).toBeNull();
    await expect(
      db.query(
        "select amobla_reserve_generation($1,$2,gen_random_uuid(),'living','modern','furnish','','prompt')",
        [u, p],
      ),
    ).rejects.toThrow("PROJECT_NOT_FOUND");
    await db.query("select amobla_manage_project($1,$2,'restore')", [u, p]);
    expect(
      (
        await db.query<{ trashed_at: string | null }>(
          "select trashed_at from projects where id=$1",
          [p],
        )
      ).rows[0].trashed_at,
    ).toBeNull();
  });
  it("refuses to trash a photo while its generation is active", async () => {
    await db.query(
      "select amobla_reserve_generation($1,$2,gen_random_uuid(),'living','modern','furnish','','prompt')",
      [u, p],
    );
    await expect(
      db.query("select amobla_manage_project($1,$2,'trash')", [u, p]),
    ).rejects.toThrow("BUSY");
  });
  it("keeps folders and requests inaccessible to other users and anonymous clients", async () => {
    await db.exec(`set role authenticated;set request.jwt.claim.sub='${v}'`);
    const r = await db.query<{ name: string }>("select name from folders");
    expect(r.rows.map((r) => r.name)).toEqual(["Private"]);
    await expect(db.query("select * from contact_requests")).rejects.toThrow(
      /permission denied/,
    );
    await db.exec("reset role");
  });
});
describe("Recorded contact requests", () => {
  it("deduplicates a repeat submission and rate-limits distinct requests", async () => {
    const args = [
      "soporte",
      "qa@example.com",
      "Necesito ayuda con mi proyecto",
      "qa-hash",
    ];
    const first = (
      await db.query<{ id: string }>(
        "select amobla_contact($1,$2,$3,$4) as id",
        args,
      )
    ).rows[0].id;
    expect(
      (
        await db.query<{ id: string }>(
          "select amobla_contact($1,$2,$3,$4) as id",
          args,
        )
      ).rows[0].id,
    ).toBe(first);
    for (let i = 0; i < 4; i++)
      await db.query(
        "select amobla_contact('soporte','qa@example.com',$1,'qa-hash')",
        [`Different request ${i}`],
      );
    await expect(
      db.query(
        "select amobla_contact('soporte','qa@example.com','Sixth request','qa-hash')",
      ),
    ).rejects.toThrow("CONTACT_LIMIT");
  });
});
