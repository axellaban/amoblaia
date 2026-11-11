import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// La migración de Prospectos sobre el SQL real (PGlite). Datos sintéticos.
let db: PGlite;
let n = 0;
const id = () => `00000000-0000-4000-8000-${String(710000000000 + ++n).padStart(12, "0")}`;
const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
const save = async (account: string, patch: Record<string, unknown>) =>
  (await one<{ r: Record<string, unknown> }>("select habita_prospect_pool_save($1,$2,$3) as r", [actor, account, patch]))!.r;
let actor: string;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
   create table auth.users(id uuid primary key, is_anonymous boolean not null default false);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create table storage.objects(id uuid,name text,bucket_id text);alter table storage.objects enable row level security;
   create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
   grant usage on schema public to authenticated;`);
  for (const file of readdirSync("supabase/migrations").sort()) await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  actor = id();
  await db.query("insert into auth.users(id) values($1)", [actor]);
}, 60000);
afterAll(async () => await db?.close());

async function prospect() {
  const agency = (await one<{ id: string }>("insert into agencies(name) values($1) returning id", [`Inmobiliaria Prueba ${++n}`]))!.id;
  return (await one<{ id: string }>("insert into prospect_accounts(agency_id) values($1) returning id", [agency]))!.id;
}

describe("prospect_profiles", () => {
  it("guarda las variables fusionando, y null borra una", async () => {
    const a = await prospect();
    await save(a, { profile: { listings_total: 80, uses_staging: "no" }, status: "descubierto", score: 41.5, scoring_version: "prospectos_v1" });
    const b = await save(a, { profile: { uses_staging: null, empty_listings: 12 }, status: "enriquecido" });
    expect(b.profile).toEqual({ listings_total: 80, empty_listings: 12 });
    expect(b.status).toBe("enriquecido");
    expect(Number(b.score)).toBe(41.5);
  });

  it("entrar a la cola guarda la foto y la fecha; salir las borra y deja el cambio en el historial", async () => {
    const a = await prospect();
    await save(a, { profile: { listings_total: 80 }, status: "calificado" });
    const queued = await save(a, { status: "en_cola", explore: true, snapshot: { score: 70, profile: { listings_total: 80 } } });
    expect(queued.queued_at).not.toBeNull();
    expect(queued.queue_snapshot).toEqual({ score: 70, profile: { listings_total: 80 } });
    expect(queued.explore).toBe(true);
    // Un guardado estando en la cola no pisa la foto.
    const edited = await save(a, { profile: { empty_listings: 3 }, status: "en_cola" });
    expect(edited.queue_snapshot).toEqual(queued.queue_snapshot);
    const out = await save(a, { status: "enriquecido" });
    expect(out.queued_at).toBeNull();
    expect(out.queue_snapshot).toBeNull();
    expect(out.explore).toBe(false);
    const events = (await db.query<{ details: { changes: { prospecto: { from: string; to: string } } } }>("select details from prospect_events where account_id=$1 and type='account_updated' order by recorded_at", [a])).rows;
    expect(events.map((e) => `${e.details.changes.prospecto.from}>${e.details.changes.prospecto.to}`)).toEqual(["calificado>en_cola", "en_cola>enriquecido"]);
  });

  it("descartar exige motivo y rechaza estados o campos desconocidos", async () => {
    const a = await prospect();
    await expect(save(a, { status: "descartado" })).rejects.toThrow(/REASON_REQUIRED/);
    expect((await save(a, { status: "descartado", discard_reason: "Solo campos" })).discard_reason).toBe("Solo campos");
    expect((await save(a, { status: "descubierto" })).discard_reason).toBeNull();
    await expect(save(a, { status: "otra" })).rejects.toThrow(/INVALID_FIELD/);
    await expect(save(a, { stage: "sent" })).rejects.toThrow(/INVALID_FIELD/);
    await expect(save(id(), { status: "descubierto" })).rejects.toThrow(/ACCOUNT_NOT_FOUND/);
  });

  it("la lectura trae los perfiles y los datos de la planilla solo de las pendientes", async () => {
    const a = await prospect();
    await db.query("update prospect_accounts set source_data='{\"Instagram\":\"@prueba\"}', address='Calle Falsa 123' where id=$1", [a]);
    await save(a, { status: "descubierto" });
    const r = (await one<{ r: { profiles: { account_id: string }[]; extra: { account_id: string; address: string; source_data: Record<string, string> }[] } }>("select habita_prospect_pool() as r"))!.r;
    expect(r.profiles.some((p) => p.account_id === a)).toBe(true);
    expect(r.extra.find((x) => x.account_id === a)).toMatchObject({ address: "Calle Falsa 123", source_data: { Instagram: "@prueba" } });
  });

  it("es privada: ni anon ni authenticated leen la tabla ni ejecutan las funciones", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await expect(db.query("select * from prospect_profiles")).rejects.toThrow(/permission denied/);
      await expect(db.query("select habita_prospect_pool()")).rejects.toThrow(/permission denied/);
      await db.exec("reset role");
    }
  });
});
