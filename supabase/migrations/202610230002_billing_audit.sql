-- Billing audit of October 23.
-- 1. One-per-account packs: a second checkout of the same pack reuses the
--    one already open, and a second paid order is recorded as 'duplicate'
--    (the app refunds it; then 'duplicate_refunded') and closed, instead of
--    granting the photos again. Payments of one buyer are serialized.
-- 2. A full refund or chargeback of a subscription charge takes back the
--    period it paid for, so the account never shows a refunded period as paid.
--    Refunding the first of two charges of one monthly renewal (a duplicate)
--    hands its period and used photos to the second, so the buyer keeps the
--    month they paid for once and the account is not blocked.
-- 3. An annual payment with a partial refund keeps granting its monthly photos.
-- 4. The daily billing sweeps read their work from SQL: only launch prices
--    due for the switch, least recently checked first, and never again once
--    back at list.
-- 5. amobla_apply_payment returns the payment's recorded status.
-- Safe to re-run: it only adds missing columns and replaces functions.
begin;
alter table public.subscriptions add column if not exists list_price_restored_at timestamptz;
alter table public.subscriptions add column if not exists list_price_checked_at timestamptz;

-- As in 202610230001, plus: an open checkout of a one-per-account product is
-- reused for a day, so two tabs cannot pay the same pack twice.
create or replace function public.amobla_create_order(p_user uuid,p_id uuid,p_sku text,p_replace boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare o orders; product products; previous subscriptions; snap jsonb;
begin
 perform 1 from profiles where id=p_user for update;
 if not found or (select blocked from profiles where id=p_user) then raise exception 'ACCOUNT_BLOCKED'; end if;
 select * into o from orders where id=p_id;
 if found then
  if o.user_id<>p_user or o.sku<>p_sku then raise exception 'ORDER_MISMATCH'; end if;
  return jsonb_build_object('order',to_jsonb(o),'dispatch',false);
 end if;
 select * into product from products where sku=p_sku and active and price_cents>0;
 if not found then raise exception 'PRODUCT_UNAVAILABLE'; end if;
 if product.per_account_limit is not null then
  if (select count(*) from orders where user_id=p_user and sku=p_sku and status='paid')>=product.per_account_limit then raise exception 'PURCHASE_LIMIT'; end if;
  -- A ready checkout is reused for a day. One still being created is reused
  -- for two minutes (the second tab is told to wait); after that it may have
  -- failed, and must not block a retry.
  select * into o from orders where user_id=p_user and sku=p_sku
   and ((status='checkout_ready' and checkout_url is not null and created_at>now()-interval '1 day')
    or (status='creating' and created_at>now()-interval '2 minutes'))
   order by created_at desc limit 1;
  if found then return jsonb_build_object('order',to_jsonb(o),'dispatch',false); end if;
 end if;
 if product.kind<>'pack' then
  select * into previous from subscriptions where user_id=p_user and status in ('authorized','paused') limit 1;
  if previous.id is not null and (not p_replace or exists(select 1 from orders where id=previous.order_id and sku=p_sku)) then raise exception 'SUBSCRIPTION_EXISTS'; end if;
  if exists(select 1 from subscriptions where user_id=p_user and status='pending') or
   exists(select 1 from orders existing_order where existing_order.user_id=p_user and existing_order.snapshot->>'kind'<>'pack'
    and (existing_order.status in ('creating','checkout_needs_review') or
     (existing_order.status='checkout_ready' and existing_order.id is distinct from previous.order_id))) then raise exception 'SUBSCRIPTION_EXISTS'; end if;
 end if;
 snap:=to_jsonb(product);
 if product.promo_price_cents is null or product.promo_ends_at is null or product.promo_ends_at<=now() or product.kind<>'month' then
  snap:=snap-'promo_price_cents'-'promo_months'-'promo_ends_at';
 end if;
 insert into orders(id,user_id,sku,snapshot,status,replaces_subscription_id)
 values(p_id,p_user,p_sku,snap,'creating',case when product.kind<>'pack' then previous.id else null end) returning * into o;
 return jsonb_build_object('order',to_jsonb(o),'dispatch',true);
end $$;
revoke all on function public.amobla_create_order(uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.amobla_create_order(uuid,uuid,text,boolean) to service_role;

-- As in 202610230001, plus items 1, 2 and 5 above.
drop function if exists public.amobla_apply_payment(text,uuid,text,bigint,timestamptz,text);
create function public.amobla_apply_payment(p_id text,p_order uuid,p_status text,p_amount bigint,p_paid_at timestamptz,p_subscription text default null)
 returns text language plpgsql security definer set search_path=public as $$
declare o orders; previous payments; twin payments; anchor timestamptz; ending timestamptz; g uuid; buyer uuid; own credit_grants; moved credit_grants;
begin
 -- The buyer is locked first, as amobla_create_order does: two payments of
 -- the same one-per-account pack cannot both see the other as unpaid.
 select user_id into buyer from orders where id=p_order;
 if not found then raise exception 'ORDER_NOT_FOUND'; end if;
 perform 1 from profiles where id=buyer for update;
 select * into o from orders where id=p_order for update;
 if p_amount<>(o.snapshot->>'price_cents')::bigint and p_amount is distinct from (o.snapshot->>'promo_price_cents')::bigint then raise exception 'AMOUNT_MISMATCH'; end if;
 if o.snapshot->>'kind'<>'pack' and (p_subscription is null or p_subscription is distinct from o.provider_subscription_id) then raise exception 'SUBSCRIPTION_MISMATCH'; end if;
 select * into previous from payments where id=p_id for update;
 if previous.id is not null and previous.order_id<>o.id then raise exception 'ORDER_MISMATCH'; end if;
 -- Final reversals are never undone by an older notification; a partial
 -- refund is not undone by the 'approved' that preceded it.
 if previous.status in ('refunded','charged_back') and p_status not in ('refunded','charged_back') then return previous.status; end if;
 if previous.status='partially_refunded' and p_status='approved' and previous.coverage_start is not null then return previous.status; end if;
 -- A duplicate never grants; its refund or chargeback only records that the
 -- money went back, so support never refunds it a second time.
 if previous.status='duplicate' and p_status in ('refunded','charged_back') then
  update payments set status='duplicate_refunded' where id=p_id;
  return 'duplicate_refunded';
 end if;
 if previous.status in ('duplicate','duplicate_refunded') then return previous.status; end if;
 insert into payments(id,order_id,user_id,status,amount_cents,paid_at) values(p_id,p_order,o.user_id,p_status,p_amount,p_paid_at)
 on conflict(id) do update set status=case when payments.status='partially_refunded' and excluded.status='approved' then payments.status else excluded.status end;
 if p_status in ('refunded','charged_back') then
  if p_status='refunded' and o.snapshot->>'kind'='month' and previous.coverage_start is not null then
   select * into twin from payments where order_id=o.id and id<>p_id
    and status in ('approved','partially_refunded') and coverage_start>previous.coverage_start
    and abs(extract(epoch from coalesce(paid_at,created_at)-coalesce(previous.paid_at,previous.created_at)))<15*86400
    order by coverage_start limit 1;
  end if;
  if twin.id is not null then
   select * into own from credit_grants where payment_id=p_id and not revoked limit 1;
   select * into moved from credit_grants where payment_id=twin.id and not revoked limit 1;
   if own.id is not null and moved.id is not null then
    update credit_grants set starts_at=own.starts_at,expires_at=own.expires_at,
     remaining=greatest(0,remaining-(own.total-own.remaining)) where id=moved.id;
    update projects set grant_id=moved.id where grant_id=own.id;
   end if;
   update credit_grants set revoked=true where payment_id=p_id;
   update payments set coverage_start=previous.coverage_start,coverage_end=previous.coverage_end where id=twin.id;
   update subscriptions set paid_until=previous.coverage_end where order_id=o.id and paid_until=twin.coverage_end;
   return p_status;
  end if;
  update credit_grants set revoked=true where payment_id=p_id;
  if p_status='charged_back' or exists(select 1 from credit_grants where payment_id=p_id and remaining<total) then
   update profiles set blocked=true where id=o.user_id;
  end if;
  -- The refunded charge no longer pays for its period. Only the latest
  -- period is rolled back: an older one is already behind the current one.
  if previous.coverage_end is not null and o.snapshot->>'kind'<>'pack' then
   update subscriptions set paid_until=previous.coverage_start
    where order_id=o.id and paid_until=previous.coverage_end;
  end if;
  return p_status;
 end if;
 if p_status='in_mediation' then update profiles set blocked=true where id=o.user_id; return p_status; end if;
 -- A partial refund still paid for the period: if it is the first status
 -- seen for this payment, it grants like an approval.
 if p_status not in ('approved','partially_refunded') then return p_status; end if;
 if previous.coverage_start is null then
  -- Checkout Pro permits multiple payment attempts: a pack order grants once.
  if o.snapshot->>'kind'='pack' and exists(select 1 from payments where order_id=o.id and id<>p_id and coverage_start is not null) then
   update payments set status='duplicate' where id=p_id;
   return 'duplicate';
  end if;
  -- A one-per-account pack paid through a second order is not granted again.
  if o.snapshot->>'kind'='pack' and (o.snapshot->>'per_account_limit') is not null and o.status<>'paid'
   and (select count(*) from orders where user_id=o.user_id and sku=o.sku and status='paid' and id<>o.id)>=(o.snapshot->>'per_account_limit')::int then
   update payments set status='duplicate' where id=p_id;
   -- Closed, so the account never offers to pay it again.
   update orders set status='cancelled' where id=o.id;
   return 'duplicate';
  end if;
  anchor:=coalesce(p_paid_at,now());
  if o.snapshot->>'kind'='pack' then
   ending:=anchor+make_interval(days=>(o.snapshot->>'valid_days')::int);
  else
   select greatest(anchor,coalesce(paid_until,anchor)) into anchor from subscriptions where id=p_subscription for update;
   if anchor is null then anchor:=coalesce(p_paid_at,now()); end if;
   ending:=anchor+case when o.snapshot->>'kind'='year' then interval '1 year' else interval '1 month' end;
   insert into subscriptions(id,order_id,user_id,status,paid_until) values(p_subscription,o.id,o.user_id,'authorized',ending)
   on conflict(id) do update set paid_until=excluded.paid_until;
  end if;
  update payments set coverage_start=anchor,coverage_end=ending where id=p_id;
  update orders set status='paid' where id=o.id;
  if o.snapshot->>'kind'='year' then perform amobla_refresh_annual(o.user_id);
  else
   insert into credit_grants(user_id,source_key,payment_id,total,remaining,starts_at,expires_at)
   values(o.user_id,p_id||':0',p_id,(o.snapshot->>'photos')::int,(o.snapshot->>'photos')::int,anchor,ending)
   on conflict(source_key) do nothing returning id into g;
   if g is not null then insert into credit_ledger(user_id,grant_id,delta,reason) values(o.user_id,g,(o.snapshot->>'photos')::int,'payment'); end if;
  end if;
 end if;
 -- 'approved' after a mediation: resolved in the seller's favour.
 if previous.status='in_mediation' and p_status='approved' then
  update profiles set blocked=(
   exists(select 1 from payments where user_id=o.user_id and status in ('charged_back','in_mediation')) or
   exists(select 1 from credit_grants where user_id=o.user_id and revoked and remaining<total)
  ) where id=o.user_id;
 end if;
 return (select status from payments where id=p_id);
end $$;
revoke all on function public.amobla_apply_payment(text,uuid,text,bigint,timestamptz,text) from public,anon,authenticated;
grant execute on function public.amobla_apply_payment(text,uuid,text,bigint,timestamptz,text) to service_role;

-- As in 202610200001, plus: a partially refunded annual payment still paid
-- for its year, so its monthly photos keep coming.
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
end $$;

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
