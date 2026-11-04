-- Plan «Gratis»: 10 créditos por mes para cada inmobiliaria verificada.
--
-- * Who: the owner of an agency that was claimed (claimed_at) and whose claim
--   is not waiting for a review ('personal' / 'mismatch'). The agency's
--   balance is its owner's, so the whole team uses them.
-- * When: lazily, the first time the balance is read or spent in each calendar
--   month (Argentina time). They are one more credit_grants row
--   ('free-month:<user>:<YYYY-MM>', unique), so reading the balance twice, or
--   two requests at once, never grants them twice.
-- * They do not accumulate: they expire at the end of the month. Spending
--   already takes the grant that expires first, so the month's free credits
--   are used before purchased ones, which last 12 months.
-- * In the movements as 'free_monthly'.
--
-- Hooked into amobla_refresh_annual, which every balance read and every
-- reservation already calls (amobla_account, generation and video reservations).
-- Its body is the one from 202610230002_billing_audit.sql, unchanged, plus one line.
-- COMMERCIAL CHANGE: apply once the rule is confirmed. Idempotent.
begin;

create or replace function public.habita_refresh_free_monthly(p_user uuid) returns void language plpgsql security definer set search_path=public as $$
declare local_month timestamp; a timestamptz; b timestamptz; g uuid; n constant integer := 10;
begin
 if not exists(
   select 1 from agencies
   where owner_id=p_user and claimed_at is not null
     and coalesce(claim_review,'ok') not in ('personal','mismatch')
 ) then return; end if;
 -- Argentina is UTC−3 all year (no daylight saving).
 local_month := date_trunc('month', (now() at time zone 'UTC') - interval '3 hours');
 a := (local_month + interval '3 hours') at time zone 'UTC';
 b := (local_month + interval '1 month' + interval '3 hours') at time zone 'UTC';
 insert into credit_grants(user_id,source_key,total,remaining,starts_at,expires_at)
 values(p_user,'free-month:'||p_user||':'||to_char(local_month,'YYYY-MM'),n,n,a,b)
 on conflict(source_key) do nothing returning id into g;
 if g is not null then
  insert into credit_ledger(user_id,grant_id,delta,reason) values(p_user,g,n,'free_monthly');
 end if;
end $$;

create or replace function public.amobla_refresh_annual(p_user uuid) returns void language plpgsql security definer set search_path=public as $$
declare r record; i integer; a timestamptz; b timestamptz; g uuid;
begin
 for r in select p.*,o.snapshot from payments p join orders o on o.id=p.order_id
   where p.user_id=p_user and p.status in ('approved','partially_refunded') and o.snapshot->>'kind'='year'
   and p.coverage_start<=now() and p.coverage_end>now()
 loop
  for i in 0..11 loop
   a:=r.coverage_start+make_interval(months=>i); b:=least(r.coverage_end,r.coverage_start+make_interval(months=>i+1));
   if a<=now() and b>now() then
    insert into credit_grants(user_id,source_key,payment_id,total,remaining,starts_at,expires_at)
    values(p_user,r.id||':'||i,r.id,(r.snapshot->>'photos')::int,(r.snapshot->>'photos')::int,a,b)
    on conflict(source_key) do nothing returning id into g;
    if g is not null then insert into credit_ledger(user_id,grant_id,delta,reason) values(p_user,g,(r.snapshot->>'photos')::int,'annual_period'); end if;
   end if;
  end loop;
 end loop;
 perform habita_refresh_free_monthly(p_user);
end $$;

revoke all on function public.habita_refresh_free_monthly(uuid) from public,anon,authenticated;
grant execute on function public.habita_refresh_free_monthly(uuid) to service_role;
revoke all on function public.amobla_refresh_annual(uuid) from public,anon,authenticated;
grant execute on function public.amobla_refresh_annual(uuid) to service_role;
commit;
