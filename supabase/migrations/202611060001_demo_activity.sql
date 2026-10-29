-- Activity of each commercial demo: what its visitors and its agency did.
-- Three steps, and a demo shows the highest one reached:
--   1 ingresó       a visit to the public page               (kind 'visita')
--   2 interactuó    a click, a comparison or a download      (kinds 'interaccion', 'descarga')
--   3 creó su panel the agency took the demo into its account (kind 'panel')
--
-- * demo_activity keeps one row per visitor and kind (unique), so a page
--   reload or a repeated click never counts twice.
-- * demos gets a summary (activity_level, activity_at, activity_visitors) so
--   the team's list reads it without a join. Written only by the function below.
-- * Only the server (service_role) writes or reads, after deciding whether the
--   visitor is the team (requests from a signed-in admin are never recorded).
-- Additive and idempotent: safe to run again. See docs/DEMOS_COMERCIALES.md.
begin;

alter table public.demos add column if not exists activity_level smallint not null default 0;
alter table public.demos add column if not exists activity_at timestamptz;
alter table public.demos add column if not exists activity_visitors integer not null default 0;
do $$ begin
 if not exists (select 1 from pg_constraint where conname='demos_activity_level') then
  alter table public.demos add constraint demos_activity_level check (activity_level between 0 and 3);
 end if;
end $$;

create table if not exists public.demo_activity (
 id uuid primary key default gen_random_uuid(),
 demo_id uuid not null references public.demos(id) on delete cascade,
 visitor text not null check (length(visitor) between 1 and 80),
 kind text not null check (kind in ('visita', 'interaccion', 'descarga', 'panel')),
 level smallint not null check (level between 1 and 3),
 created_at timestamptz not null default now(),
 unique (demo_id, visitor, kind)
);
create index if not exists demo_activity_demo on public.demo_activity(demo_id, created_at desc);

alter table public.demo_activity enable row level security;
revoke all on public.demo_activity from anon, authenticated;

-- Records one step. A repeated step is ignored; the summary keeps the highest level.
create or replace function public.habita_record_demo_activity(p_demo uuid, p_visitor text, p_kind text) returns void language plpgsql security definer set search_path=public as $$
declare lvl smallint;
begin
 lvl := case p_kind when 'visita' then 1 when 'interaccion' then 2 when 'descarga' then 2 when 'panel' then 3 end;
 if lvl is null or p_visitor is null or length(btrim(p_visitor)) not between 1 and 80 then raise exception 'INVALID_ACTIVITY'; end if;
 insert into demo_activity(demo_id, visitor, kind, level) values(p_demo, p_visitor, p_kind, lvl) on conflict (demo_id, visitor, kind) do nothing;
 if not found then return; end if;
 update demos set
  activity_level = greatest(activity_level, lvl),
  activity_at = now(),
  activity_visitors = activity_visitors + (case when p_kind = 'visita' then 1 else 0 end)
 where id = p_demo;
end $$;

-- The agency took its demos into its own account: step 3 on each of them.
create or replace function public.habita_record_agency_activity(p_agency uuid) returns void language plpgsql security definer set search_path=public as $$
declare d uuid;
begin
 for d in select id from demos where agency_id = p_agency loop
  perform habita_record_demo_activity(d, 'cuenta', 'panel');
 end loop;
end $$;

revoke all on function public.habita_record_demo_activity(uuid, text, text) from public, anon, authenticated;
grant execute on function public.habita_record_demo_activity(uuid, text, text) to service_role;
revoke all on function public.habita_record_agency_activity(uuid) from public, anon, authenticated;
grant execute on function public.habita_record_agency_activity(uuid) to service_role;

commit;
