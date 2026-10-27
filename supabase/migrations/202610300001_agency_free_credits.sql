-- Free credits the team gives an agency from the admin panel.
--
-- * habita_agency_credit: with an owner, the credits go to the owner's
--   account at once (the one balance that pays the agency's stagings);
--   without one yet, they wait in agencies.free_credits_pending and move to
--   the owner when the agency is claimed (habita_apply_agency_credits).
-- * Every grant is in credit_ledger and admin_audit, with its reason.
-- Additive and idempotent. Does not redefine any earlier function.
begin;

alter table public.agencies add column if not exists free_credits_pending integer not null default 0;
do $$ begin
 if not exists (select 1 from pg_constraint where conname='agencies_free_credits_pending') then
  alter table public.agencies add constraint agencies_free_credits_pending check (free_credits_pending between 0 and 1000);
 end if;
end $$;

-- Moves the credits waiting for an agency to its owner. Safe to call again.
create or replace function public.habita_apply_agency_credits(p_agency uuid) returns integer language plpgsql security definer set search_path=public as $$
declare a agencies; g uuid; n integer;
begin
 select * into a from agencies where id=p_agency for update;
 if not found or a.owner_id is null or a.free_credits_pending<=0 then return 0; end if;
 n:=a.free_credits_pending;
 insert into credit_grants(user_id,source_key,total,remaining) values(a.owner_id,'admin:'||gen_random_uuid(),n,n) returning id into g;
 insert into credit_ledger(user_id,grant_id,delta,reason) values(a.owner_id,g,n,'admin_adjustment');
 update agencies set free_credits_pending=0 where id=a.id;
 insert into admin_audit(actor_id,action,subject_id,details) values(a.owner_id,'agency_credit_applied',a.id::text,jsonb_build_object('photos',n));
 return n;
end $$;

-- Gives an agency free credits: to its owner now, or waiting until it is claimed.
create or replace function public.habita_agency_credit(p_actor uuid,p_agency uuid,p_photos integer,p_reason text) returns jsonb language plpgsql security definer set search_path=public as $$
declare a agencies;
begin
 if p_photos is null or p_photos<1 or p_photos>1000 or length(trim(coalesce(p_reason,'')))<5 then raise exception 'INVALID_ADJUSTMENT'; end if;
 select * into a from agencies where id=p_agency for update;
 if not found then raise exception 'AGENCY_NOT_FOUND'; end if;
 if a.owner_id is null then
  if a.free_credits_pending+p_photos>1000 then raise exception 'INVALID_ADJUSTMENT'; end if;
  update agencies set free_credits_pending=free_credits_pending+p_photos where id=a.id;
  insert into admin_audit(actor_id,action,subject_id,details)
   values(p_actor,'agency_credit',a.id::text,jsonb_build_object('photos',p_photos,'reason',p_reason,'applied','pending'));
  return jsonb_build_object('applied','pending','pending',a.free_credits_pending+p_photos);
 end if;
 perform amobla_admin_credit(p_actor,a.owner_id,p_photos,p_reason);
 insert into admin_audit(actor_id,action,subject_id,details)
  values(p_actor,'agency_credit',a.id::text,jsonb_build_object('photos',p_photos,'reason',p_reason,'applied','owner'));
 return jsonb_build_object('applied','owner','pending',a.free_credits_pending);
end $$;

revoke all on function public.habita_apply_agency_credits(uuid) from public,anon,authenticated;
grant execute on function public.habita_apply_agency_credits(uuid) to service_role;
revoke all on function public.habita_agency_credit(uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.habita_agency_credit(uuid,uuid,integer,text) to service_role;
commit;
