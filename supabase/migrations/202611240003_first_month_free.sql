-- One offer, said once: «10 créditos gratis por mes».
--
-- An agency's welcome credits (free_credits_pending, 10 by default) are the
-- free credits of its first month: it can already use them in its demo,
-- before creating its account, and when the account is created they become
-- that month's free grant ('free-month:<owner>:<YYYY-MM>', the same key
-- 202611240002 uses), so nobody gets 10 of welcome plus 10 of the month.
-- Anything above 10 (credits the team added by hand) stays a regular grant,
-- as before. If the owner already had this month's free grant (a second
-- agency), everything moves as a regular grant, as before.
-- The team can still add credits from the admin panel (habita_agency_credit).
-- Idempotent: redefines only habita_apply_agency_credits.
begin;

create or replace function public.habita_apply_agency_credits(p_agency uuid) returns integer language plpgsql security definer set search_path=public as $$
declare a agencies; g uuid; n integer; first_month integer := 0; local_month timestamp; k text;
begin
 select * into a from agencies where id=p_agency for update;
 if not found or a.owner_id is null or a.free_credits_pending<=0 then return 0; end if;
 n:=a.free_credits_pending;
 -- Argentina is UTC−3 all year (no daylight saving), as in habita_refresh_free_monthly.
 local_month := date_trunc('month', (now() at time zone 'UTC') - interval '3 hours');
 k := 'free-month:'||a.owner_id||':'||to_char(local_month,'YYYY-MM');
 if not exists(select 1 from credit_grants where source_key=k) then
  first_month := least(n,10);
  insert into credit_grants(user_id,source_key,total,remaining,starts_at,expires_at)
  values(a.owner_id,k,first_month,first_month,
   (local_month + interval '3 hours') at time zone 'UTC',
   (local_month + interval '1 month' + interval '3 hours') at time zone 'UTC')
  on conflict(source_key) do nothing returning id into g;
  if g is null then first_month := 0;
  else insert into credit_ledger(user_id,grant_id,delta,reason) values(a.owner_id,g,first_month,'free_monthly');
  end if;
 end if;
 if n-first_month>0 then
  insert into credit_grants(user_id,source_key,total,remaining) values(a.owner_id,'admin:'||gen_random_uuid(),n-first_month,n-first_month) returning id into g;
  insert into credit_ledger(user_id,grant_id,delta,reason) values(a.owner_id,g,n-first_month,'admin_adjustment');
 end if;
 update agencies set free_credits_pending=0 where id=a.id;
 insert into admin_audit(actor_id,action,subject_id,details) values(a.owner_id,'agency_credit_applied',a.id::text,jsonb_build_object('photos',n,'first_month',first_month));
 return n;
end $$;

revoke all on function public.habita_apply_agency_credits(uuid) from public,anon,authenticated;
grant execute on function public.habita_apply_agency_credits(uuid) to service_role;
commit;
