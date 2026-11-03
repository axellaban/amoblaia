-- Photo groups: photos imported from a listing or from files, before any
-- ficha exists. A group is a demos row with kind 'fotos': it keeps the
-- existing photos, staging and downloads, but it is not a property of the
-- agency's list, it cannot be published, and "crear ficha" turns it into a
-- 'ficha' (its photos, versions and link are kept). Additive and idempotent.

alter table public.demos add column if not exists kind text not null default 'ficha';

do $$
begin
 if not exists (select 1 from pg_constraint where conname='demos_kind') then
  alter table public.demos add constraint demos_kind check (kind in ('ficha','fotos'));
 end if;
end $$;

create index if not exists demos_agency_kind on public.demos(agency_id,kind);

-- The panel's counts are of properties (fichas) only: a group is not one yet.
create or replace function public.habita_agency_counts(p_agency uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object(
  'total',(select count(*) from demos where agency_id=p_agency and kind='ficha'),
  'published',(select count(*) from demos where agency_id=p_agency and kind='ficha' and status='published'),
  'staged',(select count(distinct d.id) from demos d join demo_photos ph on ph.property_id=d.property_id
            join generations g on g.project_id=ph.project_id
            where d.agency_id=p_agency and d.kind='ficha' and g.status='succeeded' and not g.is_free),
  'review',(select count(distinct d.id) from demos d join demo_photos ph on ph.property_id=d.property_id
            join generations g on g.project_id=ph.project_id
            where d.agency_id=p_agency and d.kind='ficha' and g.status='needs_review'),
  'operations',(select coalesce(jsonb_agg(distinct d.settings->>'operation') filter (where d.settings->>'operation' is not null),'[]'::jsonb)
                from demos d where d.agency_id=p_agency and d.kind='ficha')
 )
$$;
revoke all on function public.habita_agency_counts(uuid) from public,anon,authenticated;
grant execute on function public.habita_agency_counts(uuid) to service_role;
