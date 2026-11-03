-- A fifth step on the team's demo list: "generó imagen" = a visitor generated
-- an image on the public demo. The steps are now:
--   1 ingresó · 2 interactuó · 3 generó imagen · 4 creó su panel · 5 suscribió
-- Existing 'panel' and 'compra' rows move up one level. demos.activity_level is
-- then recomputed from its rows. Additive and idempotent: each renumbering
-- matches the old level only, so running it again changes nothing.
begin;

alter table public.demos drop constraint if exists demos_activity_level;
alter table public.demos add constraint demos_activity_level check (activity_level between 0 and 5);

alter table public.demo_activity drop constraint if exists demo_activity_kind_check;
alter table public.demo_activity add constraint demo_activity_kind_check check (kind in ('visita', 'interaccion', 'descarga', 'generacion', 'panel', 'compra'));
alter table public.demo_activity drop constraint if exists demo_activity_level_check;
alter table public.demo_activity add constraint demo_activity_level_check check (level between 1 and 5);

-- Compra first, so the panel's new level 4 never meets a row still at 4.
update public.demo_activity set level = 5 where kind = 'compra' and level = 4;
update public.demo_activity set level = 4 where kind = 'panel' and level = 3;
update public.demos d set activity_level = coalesce((select max(a.level) from public.demo_activity a where a.demo_id = d.id), 0);

create or replace function public.habita_record_demo_activity(p_demo uuid, p_visitor text, p_kind text) returns void language plpgsql security definer set search_path=public as $$
declare lvl smallint;
begin
 lvl := case p_kind when 'visita' then 1 when 'interaccion' then 2 when 'descarga' then 2 when 'generacion' then 3 when 'panel' then 4 when 'compra' then 5 end;
 if lvl is null or p_visitor is null or length(btrim(p_visitor)) not between 1 and 80 then raise exception 'INVALID_ACTIVITY'; end if;
 insert into demo_activity(demo_id, visitor, kind, level) values(p_demo, p_visitor, p_kind, lvl) on conflict (demo_id, visitor, kind) do nothing;
 if not found then return; end if;
 update demos set
  activity_level = greatest(activity_level, lvl),
  activity_at = now(),
  activity_visitors = activity_visitors + (case when p_kind = 'visita' then 1 else 0 end)
 where id = p_demo;
end $$;

commit;
