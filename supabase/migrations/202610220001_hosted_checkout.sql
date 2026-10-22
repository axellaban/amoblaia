-- A hosted plan change stays an order until its first invoice is paid.
-- Serialize checkout creation on the profile and bind the replaced plan in
-- the same transaction, rather than a later best-effort write.
begin;
create or replace function public.amobla_create_order(p_user uuid,p_id uuid,p_sku text,p_replace boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare o orders; product products; previous subscriptions;
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
 if product.kind<>'pack' then
  select * into previous from subscriptions where user_id=p_user and status in ('authorized','paused') limit 1;
  if previous.id is not null and (not p_replace or exists(select 1 from orders where id=previous.order_id and sku=p_sku)) then raise exception 'SUBSCRIPTION_EXISTS'; end if;
  if exists(select 1 from subscriptions where user_id=p_user and status='pending') or
   exists(select 1 from orders existing_order where existing_order.user_id=p_user and existing_order.snapshot->>'kind'<>'pack'
    and (existing_order.status in ('creating','checkout_needs_review') or
     (existing_order.status='checkout_ready' and existing_order.id is distinct from previous.order_id))) then raise exception 'SUBSCRIPTION_EXISTS'; end if;
 end if;
 insert into orders(id,user_id,sku,snapshot,status,replaces_subscription_id)
 values(p_id,p_user,p_sku,to_jsonb(product),'creating',case when product.kind<>'pack' then previous.id else null end) returning * into o;
 return jsonb_build_object('order',to_jsonb(o),'dispatch',true);
end $$;
revoke all on function public.amobla_create_order(uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.amobla_create_order(uuid,uuid,text,boolean) to service_role;
commit;
