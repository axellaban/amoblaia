-- A fourth step on the team's demo list: "suscribió" = the agency bought
-- credits (an approved payment of its account). The steps are now:
--   1 ingresó · 2 interactuó · 3 creó su panel · 4 suscribió
-- Additive and idempotent: safe to run again. See docs/DEMOS_COMERCIALES.md.
begin;

alter table public.demos drop constraint if exists demos_activity_level;
alter table public.demos add constraint demos_activity_level check (activity_level between 0 and 4);

alter table public.demo_activity drop constraint if exists demo_activity_kind_check;
alter table public.demo_activity add constraint demo_activity_kind_check check (kind in ('visita', 'interaccion', 'descarga', 'panel', 'compra'));
alter table public.demo_activity drop constraint if exists demo_activity_level_check;
alter table public.demo_activity add constraint demo_activity_level_check check (level between 1 and 4);

create or replace function public.habita_record_demo_activity(p_demo uuid, p_visitor text, p_kind text) returns void language plpgsql security definer set search_path=public as $$
declare lvl smallint;
begin
 lvl := case p_kind when 'visita' then 1 when 'interaccion' then 2 when 'descarga' then 2 when 'panel' then 3 when 'compra' then 4 end;
 if lvl is null or p_visitor is null or length(btrim(p_visitor)) not between 1 and 80 then raise exception 'INVALID_ACTIVITY'; end if;
 insert into demo_activity(demo_id, visitor, kind, level) values(p_demo, p_visitor, p_kind, lvl) on conflict (demo_id, visitor, kind) do nothing;
 if not found then return; end if;
 update demos set
  activity_level = greatest(activity_level, lvl),
  activity_at = now(),
  activity_visitors = activity_visitors + (case when p_kind = 'visita' then 1 else 0 end)
 where id = p_demo;
end $$;

-- The agency bought credits: step 4 on each of its demos.
create or replace function public.habita_record_agency_purchase(p_agency uuid) returns void language plpgsql security definer set search_path=public as $$
declare d uuid;
begin
 for d in select id from demos where agency_id = p_agency loop
  perform habita_record_demo_activity(d, 'cuenta', 'compra');
 end loop;
end $$;

revoke all on function public.habita_record_agency_purchase(uuid) from public, anon, authenticated;
grant execute on function public.habita_record_agency_purchase(uuid) to service_role;

commit;
