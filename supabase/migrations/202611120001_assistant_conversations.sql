-- Conversations with Miguel Ángel, the assistant of the panel and the demos,
-- for the team's history in /admin/asistente.
--
-- * assistant_conversations: one per chat opened in a browser tab, with
--   where it happened (panel or demo), the account, the agency and the demo.
-- * assistant_messages: each question and its answer, in order. A question
--   that got no answer is kept with the reason (error).
-- * owner is who may keep writing to a conversation (the account, or the demo
--   invitation): a conversation id sent by someone else starts a new one.
-- * Only the server (service_role) writes or reads.
-- Additive and idempotent: safe to run again.
begin;

create table if not exists public.assistant_conversations (
 id uuid primary key default gen_random_uuid(),
 owner text not null check (length(owner) between 1 and 120),
 place text not null check (place in ('panel', 'demo')),
 user_id uuid references auth.users(id) on delete set null,
 user_email text check (user_email is null or length(user_email) <= 254),
 agency_id uuid references public.agencies(id) on delete set null,
 agency_name text check (agency_name is null or length(agency_name) <= 200),
 demo_id uuid references public.demos(id) on delete set null,
 demo_title text check (demo_title is null or length(demo_title) <= 300),
 support boolean not null default false,
 path text check (path is null or length(path) <= 200),
 questions integer not null default 0,
 failures integer not null default 0,
 last_question text check (last_question is null or length(last_question) <= 300),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists assistant_conversations_recent on public.assistant_conversations(updated_at desc);
create index if not exists assistant_conversations_agency on public.assistant_conversations(agency_id, updated_at desc);
create index if not exists assistant_conversations_demo on public.assistant_conversations(demo_id, updated_at desc);

create table if not exists public.assistant_messages (
 id bigint generated always as identity primary key,
 conversation_id uuid not null references public.assistant_conversations(id) on delete cascade,
 role text not null check (role in ('user', 'assistant')),
 content text not null check (length(content) <= 12000),
 model text check (model is null or length(model) <= 80),
 error text check (error is null or length(error) <= 300),
 created_at timestamptz not null default now()
);
create index if not exists assistant_messages_conversation on public.assistant_messages(conversation_id, id);

alter table public.assistant_conversations enable row level security;
alter table public.assistant_messages enable row level security;
revoke all on public.assistant_conversations from anon, authenticated;
revoke all on public.assistant_messages from anon, authenticated;

-- Records one question and its answer (or why there was none). Returns the
-- conversation's id: the same one while its owner keeps writing, a new one
-- when the id is unknown or belongs to someone else.
create or replace function public.habita_assistant_log(
 p_conversation uuid, p_owner text, p_place text, p_user uuid, p_email text,
 p_agency uuid, p_agency_name text, p_demo uuid, p_demo_title text, p_support boolean,
 p_path text, p_question text, p_answer text, p_model text, p_error text
) returns uuid language plpgsql security definer set search_path=public as $$
declare cid uuid;
begin
 if p_question is null or length(btrim(p_question)) = 0 then raise exception 'INVALID_QUESTION'; end if;
 if p_conversation is not null then
  select id into cid from assistant_conversations where id = p_conversation and owner = p_owner for update;
 end if;
 if cid is null then
  -- The browser's id for a new chat is kept; one already taken by someone else is not.
  insert into assistant_conversations(id, owner, place, user_id, user_email, agency_id, agency_name, demo_id, demo_title, support, path)
  values (
   case when p_conversation is not null and not exists (select 1 from assistant_conversations where id = p_conversation) then p_conversation else gen_random_uuid() end,
   p_owner, p_place, p_user, left(p_email, 254), p_agency, left(p_agency_name, 200), p_demo, left(p_demo_title, 300), coalesce(p_support, false), left(p_path, 200))
  returning id into cid;
 end if;
 insert into assistant_messages(conversation_id, role, content) values (cid, 'user', left(p_question, 12000));
 if length(btrim(coalesce(p_answer, ''))) > 0 or p_error is not null then
  insert into assistant_messages(conversation_id, role, content, model, error) values (cid, 'assistant', left(coalesce(p_answer, ''), 12000), left(p_model, 80), left(p_error, 300));
 end if;
 update assistant_conversations set
  questions = questions + 1,
  failures = failures + (case when p_error is not null then 1 else 0 end),
  last_question = left(p_question, 300),
  path = coalesce(left(p_path, 200), path),
  -- The agency and the account as they are now (a demo's agency may have since opened its panel).
  user_id = coalesce(p_user, user_id),
  user_email = coalesce(left(p_email, 254), user_email),
  agency_id = coalesce(p_agency, agency_id),
  agency_name = coalesce(left(p_agency_name, 200), agency_name),
  updated_at = now()
 where id = cid;
 return cid;
end $$;

revoke all on function public.habita_assistant_log(uuid, text, text, uuid, text, uuid, text, uuid, text, boolean, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.habita_assistant_log(uuid, text, text, uuid, text, uuid, text, uuid, text, boolean, text, text, text, text, text) to service_role;

commit;
