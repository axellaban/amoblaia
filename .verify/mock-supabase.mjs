// Test double at the HTTP boundary: PostgREST RPCs run the real migrations in PGlite;
// storage serves example photos. Only for local verification, never deployed.
import http from "node:http";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
const require = createRequire("/vercel/amoblaia/package.json");
const { PGlite } = require("@electric-sql/pglite");
const sharp = require("sharp");
const R = "/vercel/amoblaia";
const owner = "00000000-0000-4000-8000-0000000000a1", stranger = "00000000-0000-4000-8000-0000000000a2";
const living = "00000000-0000-4000-8000-0000000000b1", bedroom = "00000000-0000-4000-8000-0000000000b2", foreign = "00000000-0000-4000-8000-0000000000b4";
export const ids = { reviewed: "00000000-0000-4000-8000-0000000000c1", pending: "00000000-0000-4000-8000-0000000000c2", bedroomReviewed: "00000000-0000-4000-8000-0000000000c5", foreignReviewed: "00000000-0000-4000-8000-0000000000c7", nordic: "00000000-0000-4000-8000-0000000000c8" };
export const token = "tok_IntegrationShowcase_000001";
const db = new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid,name text,bucket_id text);alter table storage.objects enable row level security;create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;insert into auth.users values('${owner}'),('${stranger}');`);
for (const f of readdirSync(R + "/supabase/migrations").sort()) await db.exec(readFileSync(`${R}/supabase/migrations/${f}`, "utf8"));
await db.query("select amobla_account($1,false),amobla_account($2,false)", [owner, stranger]);
await db.exec(`
 insert into projects(id,user_id,original_hash,original_path,name,original_bytes) values
  ('${living}','${owner}','h1','${owner}/h1/original.jpg','Calle Privada 123',100),
  ('${bedroom}','${owner}','h2','${owner}/h2/original.jpg','dormitorio.jpg',100),
  ('${foreign}','${stranger}','h4','${stranger}/h4/original.jpg','ajena.jpg',100);
 insert into generations(id,user_id,project_id,request_key,room,style,mode,prompt,status,result_path,reviewed_at) values
  ('${ids.reviewed}','${owner}','${living}',gen_random_uuid(),'living','modern','furnish','p','succeeded','${owner}/${living}/modern.jpg',now()),
  ('${ids.nordic}','${owner}','${living}',gen_random_uuid(),'living','scandinavian','furnish','p','succeeded','${owner}/${living}/nordic.jpg',now()),
  ('${ids.pending}','${owner}','${living}',gen_random_uuid(),'living','industrial','furnish','p','succeeded','${owner}/${living}/industrial.jpg',null),
  ('${ids.bedroomReviewed}','${owner}','${bedroom}',gen_random_uuid(),'bedroom','coastal','redesign','p','succeeded','${owner}/${bedroom}/coastal.jpg',now()),
  ('${ids.foreignReviewed}','${stranger}','${foreign}',gen_random_uuid(),'living','modern','furnish','p','succeeded','${stranger}/${foreign}/f.jpg',now());
 insert into showcases(id,user_id,token,title,agency_name,whatsapp) values ('00000000-0000-4000-8000-0000000000d1','${owner}','${token}','Depto 3 ambientes en Güemes','Inmobiliaria Costa','5492235551234');
`);
await db.query("select amobla_set_showcase_rooms($1,$2,$3::jsonb)", [owner, "00000000-0000-4000-8000-0000000000d1", JSON.stringify([{ project_id: living, label: "Living comedor" }, { project_id: bedroom, label: "Dormitorio" }])]);
const files = { "h1/original.jpg": "living-before", "h2/original.jpg": "bedroom-before", "modern.jpg": "living-modern", "nordic.jpg": "living-scandinavian", "industrial.jpg": "living-industrial", "coastal.jpg": "bedroom-coastal", "f.jpg": "living-luxury" };
const body = (req) => new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => r(d)); });
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const send = (code, data, type = "application/json") => { res.writeHead(code, { "Content-Type": type }); res.end(typeof data === "string" || Buffer.isBuffer(data) ? data : JSON.stringify(data)); };
  try {
    const rpc = /^\/rest\/v1\/rpc\/(amobla_[a-z_]+)$/.exec(url.pathname);
    if (rpc && req.method === "POST") {
      const args = JSON.parse((await body(req)) || "{}");
      const keys = Object.keys(args);
      const r = await db.query(`select ${rpc[1]}(${keys.map((k, i) => `${k}=>$${i + 1}`).join(",")}) as r`, keys.map((k) => (typeof args[k] === "object" && args[k] !== null ? JSON.stringify(args[k]) : args[k])));
      return send(200, JSON.stringify(r.rows[0].r ?? null));
    }
    if (url.pathname.startsWith("/storage/v1/object/")) {
      const p = decodeURIComponent(url.pathname.split("property-images/")[1] || "");
      const key = Object.keys(files).find((k) => p.endsWith(k));
      if (!key) return send(404, { error: "not_found", message: "Object not found", statusCode: "404" });
      return send(200, await sharp(`${R}/public/ejemplos/${files[key]}.webp`).jpeg().toBuffer(), "image/jpeg");
    }
    if (url.pathname === "/__public") return send(200, (await db.query("select amobla_public_showcase($1) as r", [token])).rows[0].r);
    if (url.pathname === "/__active") { await db.query("update showcases set active=$1", [url.searchParams.get("value") === "true"]); return send(200, { ok: true }); }
    if (url.pathname.startsWith("/auth/v1/")) return send(401, { message: "no session" });
    send(404, { message: "not mocked " + url.pathname });
  } catch (e) { console.error(e); send(500, { message: String(e.message) }); }
}).listen(54321, () => console.log("mock ready"));
