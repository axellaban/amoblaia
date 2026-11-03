-- Every new agency starts with 10 free credits.
--
-- * One the team prepares (no owner yet): they wait in free_credits_pending,
--   show in its invitation and move to the owner when it is claimed, like any
--   other reserved credits (habita_apply_agency_credits).
-- * One created from the panel: they go to its owner at once.
-- Agencies that already exist keep what they have. Idempotent.
begin;

alter table public.agencies alter column free_credits_pending set default 10;

-- A new agency with its owner, atomically, with its welcome credits applied.
create or replace function public.habita_create_agency(p_user uuid,p_name text,p_slug text) returns uuid language plpgsql security definer set search_path=public as $$
declare a uuid;
begin
 insert into profiles(id) values(p_user) on conflict do nothing;
 perform 1 from profiles where id=p_user for update;
 if (select blocked from profiles where id=p_user) then raise exception 'ACCOUNT_BLOCKED'; end if;
 if exists(select 1 from agency_members where user_id=p_user) then raise exception 'AGENCY_EXISTS'; end if;
 if p_name is null or length(btrim(p_name)) not between 1 and 120 then raise exception 'INVALID_AGENCY_NAME'; end if;
 insert into agencies(name,slug,owner_id,claimed_at,created_by)
 values(btrim(p_name),habita_free_slug(p_slug),p_user,now(),p_user) returning id into a;
 insert into agency_members(agency_id,user_id,role) values(a,p_user,'owner');
 perform habita_apply_agency_credits(a);
 return a;
end $$;

revoke all on function public.habita_create_agency(uuid,text,text) from public,anon,authenticated;
grant execute on function public.habita_create_agency(uuid,text,text) to service_role;
commit;
