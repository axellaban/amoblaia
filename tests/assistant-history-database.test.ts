import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Miguel Ángel's history on the real migrations (PGlite). See 202611120001_assistant_conversations.sql.
let db: PGlite;
const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
   create table auth.users(id uuid primary key, is_anonymous boolean not null default false);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create table storage.objects(id uuid,name text,bucket_id text);alter table storage.objects enable row level security;
   create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
   grant usage on schema public to authenticated;`);
  for (const file of readdirSync("supabase/migrations").sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
}, 60000);
afterAll(async () => await db?.close());

const CHAT = "11111111-1111-4111-8111-111111111111";
const log = async (conversation: string | null, owner: string, question: string, answer: string | null, error: string | null = null) =>
  (
    await one<{ id: string }>(
      "select habita_assistant_log($1,$2,'demo',null,null,null,'Inmobiliaria Sur',null,'Casa en el lago',false,'/demo/tok',$3,$4,'gpt-4.1-mini',$5) as id",
      [conversation, owner, question, answer, error],
    )
  )!.id;

describe("the history of Miguel Ángel's conversations", () => {
  it("keeps the browser's id and groups each question with its answer", async () => {
    expect(await log(CHAT, "demo:abc", "¿Cuánto cuesta?", "Mirá los planes en Precios.")).toBe(CHAT);
    expect(await log(CHAT, "demo:abc", "¿Y cómo guardo mi panel?", "Tocá Guardar mi panel.")).toBe(CHAT);
    const c = await one<{ questions: number; failures: number; last_question: string; agency_name: string; demo_title: string }>(
      "select questions,failures,last_question,agency_name,demo_title from assistant_conversations where id=$1",
      [CHAT],
    );
    expect(c).toMatchObject({ questions: 2, failures: 0, last_question: "¿Y cómo guardo mi panel?", agency_name: "Inmobiliaria Sur", demo_title: "Casa en el lago" });
    const messages = (await db.query<{ role: string; content: string }>("select role,content from assistant_messages where conversation_id=$1 order by id", [CHAT])).rows;
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
  });

  it("never lets someone else write into a conversation: they get a new one", async () => {
    const other = await log(CHAT, "user:intruso", "hola", "¡Hola!");
    expect(other).not.toBe(CHAT);
    expect((await one<{ questions: number }>("select questions from assistant_conversations where id=$1", [CHAT]))!.questions).toBe(2);
  });

  it("keeps a question without answer, with the reason", async () => {
    const id = await log(null, "demo:xyz", "¿Hola?", null, "OpenAI 429");
    const c = await one<{ questions: number; failures: number }>("select questions,failures from assistant_conversations where id=$1", [id]);
    expect(c).toEqual({ questions: 1, failures: 1 });
    const answer = await one<{ content: string; error: string }>("select content,error from assistant_messages where conversation_id=$1 and role='assistant'", [id]);
    expect(answer).toEqual({ content: "", error: "OpenAI 429" });
  });

  it("is closed to the browser's roles", async () => {
    const grants = await one<{ n: number }>(
      "select count(*)::int as n from information_schema.role_table_grants where table_name in ('assistant_conversations','assistant_messages') and grantee in ('anon','authenticated')",
    );
    expect(grants!.n).toBe(0);
  });
});
