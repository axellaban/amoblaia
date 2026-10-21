-- Billing hardening after the October 21 audit.
-- 1. A plan change records the subscription it replaces, so whichever path
--    first sees the new subscription authorized (checkout or webhook) can
--    cancel the old one: a buyer is never billed for two plans.
-- 2. Reversals: a mediation only blocks the account and can still end in the
--    seller's favour; a partial refund keeps the payment's photos; only a full
--    refund or a chargeback revokes them.
-- 3. A second payment on the same pack is recorded as 'duplicate' (to refund)
--    instead of being lost with the rolled-back transaction.
-- 4. Failed notifications count their attempts.
-- 5. Annual plans keep their monthly photos after a partial refund.
-- 6. A plan change names the subscription it replaces, re-checked under the
--    account lock: two tabs cannot both replace the same plan.
begin;
alter table public.orders add column if not exists replaces_subscription_id text;

drop function if exists public.amobla_create_order(uuid,uuid,text,boolean);
create or replace function public.amobla_create_order(p_user uuid,p_id uuid,p_sku text,p_replace boolean default false,p_replaces text default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare o orders; product products;
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
 if product.kind<>'pack' and (
  exists(select 1 from orders where user_id=p_user and snapshot->>'kind'<>'pack' and status in ('creating','checkout_needs_review')) or
  (not p_replace and (
   exists(select 1 from subscriptions where user_id=p_user and status in ('pending','authorized','paused')) or
   exists(select 1 from orders where user_id=p_user and snapshot->>'kind'<>'pack' and status='checkout_ready')
  )) or
  -- The plan being replaced must still be the only open one: another tab
  -- may have replaced it a moment ago.
  (p_replace and p_replaces is not null and (
   not exists(select 1 from subscriptions where id=p_replaces and user_id=p_user and status in ('pending','authorized','paused')) or
   exists(select 1 from subscriptions where user_id=p_user and id<>p_replaces and status in ('pending','authorized','paused')) or
   exists(select 1 from orders x where x.user_id=p_user and x.snapshot->>'kind'<>'pack' and x.status='checkout_ready'
    and x.id is distinct from (select order_id from subscriptions where id=p_replaces)
    and not exists(select 1 from subscriptions s where s.order_id=x.id and s.status not in ('pending','authorized','paused')))
  ))
 ) then raise exception 'SUBSCRIPTION_EXISTS'; end if;
 insert into orders(id,user_id,sku,snapshot,status) values(p_id,p_user,p_sku,to_jsonb(product),'creating') returning * into o;
 return jsonb_build_object('order',to_jsonb(o),'dispatch',true);
end $$;
revoke all on function public.amobla_create_order(uuid,uuid,text,boolean,text) from public,anon,authenticated;
grant execute on function public.amobla_create_order(uuid,uuid,text,boolean,text) to service_role;

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

create or replace function public.amobla_apply_payment(p_id text,p_order uuid,p_status text,p_amount bigint,p_paid_at timestamptz,p_subscription text default null)
 returns void language plpgsql security definer set search_path=public as $$
declare o orders; previous payments; anchor timestamptz; ending timestamptz; g uuid; is_duplicate boolean:=false;
begin
 select * into o from orders where id=p_order for update;
 if not found then raise exception 'ORDER_NOT_FOUND'; end if;
 if p_amount<>(o.snapshot->>'price_cents')::bigint then raise exception 'AMOUNT_MISMATCH'; end if;
 if o.snapshot->>'kind'<>'pack' and (p_subscription is null or p_subscription is distinct from o.provider_subscription_id) then raise exception 'SUBSCRIPTION_MISMATCH'; end if;
 select * into previous from payments where id=p_id for update;
 if previous.id is not null and previous.order_id<>o.id then raise exception 'ORDER_MISMATCH'; end if;
 -- Final reversals are never undone by an older notification; a partial
 -- refund is not undone by the 'approved' that preceded it.
 if previous.status in ('refunded','charged_back') and p_status not in ('refunded','charged_back') then return; end if;
 if previous.status='partially_refunded' and p_status='approved' and previous.coverage_start is not null then return; end if;
 if previous.status='duplicate' then return; end if;
 -- A payment that already granted only moves to another final state; a
 -- stale 'pending' or 'in_process' fetched before the approval is ignored.
 if previous.coverage_start is not null and p_status not in ('approved','partially_refunded','refunded','charged_back','in_mediation') then return; end if;
 insert into payments(id,order_id,user_id,status,amount_cents,paid_at) values(p_id,p_order,o.user_id,p_status,p_amount,p_paid_at)
 on conflict(id) do update set status=case when payments.status='partially_refunded' and excluded.status='approved' then payments.status else excluded.status end;
 if p_status in ('refunded','charged_back') then
  update credit_grants set revoked=true where payment_id=p_id;
  if p_status='charged_back' or exists(select 1 from credit_grants where payment_id=p_id and remaining<total) then
   update profiles set blocked=true where id=o.user_id;
  elsif previous.status='in_mediation' then
   -- An unused purchase refunded after a dispute no longer blocks.
   update profiles set blocked=(
    exists(select 1 from payments where user_id=o.user_id and status in ('charged_back','in_mediation')) or
    exists(select 1 from credit_grants where user_id=o.user_id and revoked and remaining<total)
   ) where id=o.user_id;
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
   is_duplicate:=true;
  end if;
 end if;
 if previous.coverage_start is null and not is_duplicate then
  anchor:=coalesce(p_paid_at,now());
  if o.snapshot->>'kind'='pack' then ending:=null;
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
 -- A mediation that ended without a full refund: the dispute is closed.
 if previous.status='in_mediation' then
  update profiles set blocked=(
   exists(select 1 from payments where user_id=o.user_id and status in ('charged_back','in_mediation')) or
   exists(select 1 from credit_grants where user_id=o.user_id and revoked and remaining<total)
  ) where id=o.user_id;
 end if;
end $$;

-- Under the previous rules a mediation or a partial refund revoked the
-- payment's photos; under these it keeps them.
update public.credit_grants set revoked=false where revoked
 and payment_id in (select id from public.payments where status in ('in_mediation','partially_refunded'));
-- The old rules also blocked a partial refund's account; these don't.
update public.profiles pr set blocked=(
 exists(select 1 from public.payments where user_id=pr.id and status in ('charged_back','in_mediation')) or
 exists(select 1 from public.credit_grants where user_id=pr.id and revoked and remaining<total)
) where pr.blocked and pr.id in (select user_id from public.payments where status='partially_refunded');

create or replace function public.amobla_inbox_failed(p_key text,p_error text) returns void language sql security definer set search_path=public as $$
 update webhook_events set attempts=attempts+1,last_error=left(p_error,80) where event_key=p_key;
$$;
revoke all on function public.amobla_inbox_failed(text,text) from public,anon,authenticated;
grant execute on function public.amobla_inbox_failed(text,text) to service_role;
revoke all on function public.amobla_refresh_annual(uuid) from public,anon,authenticated;
grant execute on function public.amobla_refresh_annual(uuid) to service_role;
revoke all on function public.amobla_apply_payment(text,uuid,text,bigint,timestamptz,text) from public,anon,authenticated;
grant execute on function public.amobla_apply_payment(text,uuid,text,bigint,timestamptz,text) to service_role;
commit;
