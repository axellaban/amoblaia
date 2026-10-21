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
begin;
alter table public.orders add column if not exists replaces_subscription_id text;

create or replace function public.amobla_apply_payment(p_id text,p_order uuid,p_status text,p_amount bigint,p_paid_at timestamptz,p_subscription text default null)
 returns void language plpgsql security definer set search_path=public as $$
declare o orders; previous payments; anchor timestamptz; ending timestamptz; g uuid;
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
 -- 'approved' after a mediation: resolved in the seller's favour.
 if previous.status='in_mediation' and p_status='approved' then
  update profiles set blocked=(
   exists(select 1 from payments where user_id=o.user_id and status in ('charged_back','in_mediation')) or
   exists(select 1 from credit_grants where user_id=o.user_id and revoked and remaining<total)
  ) where id=o.user_id;
 end if;
end $$;

create or replace function public.amobla_inbox_failed(p_key text,p_error text) returns void language sql security definer set search_path=public as $$
 update webhook_events set attempts=attempts+1,last_error=left(p_error,80) where event_key=p_key;
$$;
revoke all on function public.amobla_inbox_failed(text,text) from public,anon,authenticated;
grant execute on function public.amobla_inbox_failed(text,text) to service_role;
revoke all on function public.amobla_apply_payment(text,uuid,text,bigint,timestamptz,text) from public,anon,authenticated;
grant execute on function public.amobla_apply_payment(text,uuid,text,bigint,timestamptz,text) to service_role;
commit;
