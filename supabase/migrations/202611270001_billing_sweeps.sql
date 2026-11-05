-- The daily billing sweeps (launch prices and reversed subscriptions) failed
-- every day in production: 202610230002_billing_audit was never applied there,
-- so these two columns and two functions did not exist.
-- This adds only them. It does NOT re-run 202610230002, whose versions of
-- amobla_create_order, amobla_apply_payment and amobla_refresh_annual are older
-- than the ones in production (202611240002 and later).
-- Safe to re-run: it only adds missing columns and replaces these two functions.
begin;
alter table public.subscriptions add column if not exists list_price_restored_at timestamptz;
alter table public.subscriptions add column if not exists list_price_checked_at timestamptz;
-- Work lists for the daily cron, oldest first so none is starved.
-- Launch-price subscriptions due for the list price (all their launch-price
-- charges paid) whose switch is not confirmed, least recently checked first.
drop function if exists public.amobla_promo_subscriptions(integer);
create function public.amobla_promo_subscriptions(p_limit integer default 50)
returns table(id text,"order" jsonb) language sql security definer set search_path=public as $$
 select s.id,to_jsonb(o) from subscriptions s join orders o on o.id=s.order_id
 where s.status in ('authorized','paused') and s.list_price_restored_at is null
  and o.snapshot->>'promo_price_cents' is not null
  and (select count(*) from payments p where p.order_id=o.id and p.coverage_start is not null)>=(o.snapshot->>'promo_months')::int
 order by s.list_price_checked_at nulls first,s.created_at limit p_limit;
$$;
-- Open subscriptions the webhook should have ended (a lost notification, or
-- one handled before that rule): a charge charged back, or refunded with no
-- charge still paid after it or in its same cycle (endsCurrentPeriod).
create or replace function public.amobla_reversed_subscriptions(p_limit integer default 50)
returns setof text language sql security definer set search_path=public as $$
 select s.id from subscriptions s
 where s.status in ('authorized','paused')
  and exists(select 1 from payments r where r.order_id=s.order_id and (r.status='charged_back' or (r.status='refunded'
   and not exists(select 1 from payments p where p.order_id=s.order_id and p.id<>r.id and p.status in ('approved','partially_refunded')
    and coalesce(p.paid_at,p.created_at)>coalesce(r.paid_at,r.created_at)-interval '15 days'))))
 order by s.created_at limit p_limit;
$$;
revoke all on function public.amobla_promo_subscriptions(integer) from public,anon,authenticated;
grant execute on function public.amobla_promo_subscriptions(integer) to service_role;
revoke all on function public.amobla_reversed_subscriptions(integer) from public,anon,authenticated;
grant execute on function public.amobla_reversed_subscriptions(integer) to service_role;
commit;
