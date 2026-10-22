-- List prices back at parity with the reference (202610200003), a 72-hour
-- launch price on the monthly plans for their first three charges, and a
-- one-per-account "Primera propiedad" pack whose photos last 30 days.
-- The launch window starts when this file is applied; to move it:
--   update public.products set promo_ends_at = '2026-10-27 23:59-03' where promo_price_cents is not null;
-- Safe to re-run: it only adds missing columns and updates catalog rows.
begin;
alter table public.products
 add column if not exists promo_price_cents bigint check(promo_price_cents>=100),
 add column if not exists promo_months integer check(promo_months between 1 and 12),
 add column if not exists promo_ends_at timestamptz,
 add column if not exists per_account_limit integer check(per_account_limit>0),
 add column if not exists valid_days integer check(valid_days>0);
alter table public.products drop constraint if exists products_promo_below_price;
alter table public.products add constraint products_promo_below_price
 check(promo_price_cents is null or (kind='month' and promo_months is not null and promo_price_cents<price_cents));

update public.products as p
set price_cents = v.price_cents, active = true
from (values
  ('basic-month',          3890000),
  ('standard-month',       5390000),
  ('professional-month',  12190000),
  ('enterprise-month',    21490000),
  ('basic-year',          29690000),
  ('standard-year',       35190000),
  ('professional-year',   72290000),
  ('enterprise-year',    146490000)
) as v(sku, price_cents)
where p.sku = v.sku;

update public.products as p
set promo_price_cents = v.promo_cents, promo_months = 3, promo_ends_at = now() + interval '72 hours'
from (values
  ('basic-month',          1990000),
  ('standard-month',       2690000),
  ('professional-month',   5990000),
  ('enterprise-month',    10490000)
) as v(sku, promo_cents)
where p.sku = v.sku;

insert into public.products(sku,name,kind,photos,price_cents,active,per_account_limit,valid_days)
values ('pack-first','Primera propiedad','pack',5,499000,true,1,30)
on conflict (sku) do update set name=excluded.name, kind=excluded.kind, photos=excluded.photos,
 price_cents=excluded.price_cents, active=excluded.active,
 per_account_limit=excluded.per_account_limit, valid_days=excluded.valid_days;

-- As in 202610220001 (hosted checkout), plus: the order keeps the launch
-- price only if the window is open when it is created, and a per-account
-- limit counts paid orders, so an abandoned checkout never blocks a retry.
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
 if product.per_account_limit is not null and (
  select count(*) from orders where user_id=p_user and sku=p_sku and status='paid'
 )>=product.per_account_limit then raise exception 'PURCHASE_LIMIT'; end if;
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

-- As in 202610210003, plus: a launch-price order accepts either its launch
-- or its list amount, and a pack with valid_days grants photos that expire.
create or replace function public.amobla_apply_payment(p_id text,p_order uuid,p_status text,p_amount bigint,p_paid_at timestamptz,p_subscription text default null)
 returns void language plpgsql security definer set search_path=public as $$
declare o orders; previous payments; anchor timestamptz; ending timestamptz; g uuid;
begin
 select * into o from orders where id=p_order for update;
 if not found then raise exception 'ORDER_NOT_FOUND'; end if;
 if p_amount<>(o.snapshot->>'price_cents')::bigint and p_amount is distinct from (o.snapshot->>'promo_price_cents')::bigint then raise exception 'AMOUNT_MISMATCH'; end if;
 if o.snapshot->>'kind'<>'pack' and (p_subscription is null or p_subscription is distinct from o.provider_subscription_id) then raise exception 'SUBSCRIPTION_MISMATCH'; end if;
 select * into previous from payments where id=p_id for update;
 if previous.id is not null and previous.order_id<>o.id then raise exception 'ORDER_MISMATCH'; end if;
 -- Final reversals are never undone by an older notification; a partial
 -- refund is not undone by the 'approved' that preceded it.
 if previous.status in ('refunded','charged_back') and p_status not in ('refunded','charged_back') then return; end if;
 if previous.status='partially_refunded' and p_status='approved' and previous.coverage_start is not null then return; end if;
 if previous.status='duplicate' then return; end if;
 insert into payments(id,order_id,user_id,status,amount_cents,paid_at) values(p_id,p_order,o.user_id,p_status,p_amount,p_paid_at)
 on conflict(id) do update set status=case when payments.status='partially_refunded' and excluded.status='approved' then payments.status else excluded.status end;
 if p_status in ('refunded','charged_back') then
  update credit_grants set revoked=true where payment_id=p_id;
  if p_status='charged_back' or exists(select 1 from credit_grants where payment_id=p_id and remaining<total) then
   update profiles set blocked=true where id=o.user_id;
  end if;
  return;
 end if;
 if p_status='in_mediation' then update profiles set blocked=true where id=o.user_id; return; end if;
 -- A partial refund still paid for the period: if it is the first status
 -- seen for this payment, it grants like an approval.
 if p_status not in ('approved','partially_refunded') then return; end if;
 if previous.coverage_start is null then
  -- Checkout Pro permits multiple payment attempts: a pack order grants once.
  if o.snapshot->>'kind'='pack' and exists(select 1 from payments where order_id=o.id and id<>p_id and coverage_start is not null) then
   update payments set status='duplicate' where id=p_id;
   return;
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
end $$;
revoke all on function public.amobla_apply_payment(text,uuid,text,bigint,timestamptz,text) from public,anon,authenticated;
grant execute on function public.amobla_apply_payment(text,uuid,text,bigint,timestamptz,text) to service_role;
commit;
