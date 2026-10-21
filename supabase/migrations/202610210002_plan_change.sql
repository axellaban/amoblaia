-- Plan changes: an order may replace the user's current subscription. The
-- app cancels the old subscription only after Mercado Pago authorizes the
-- new one. Orders still being created or under review keep blocking, so two
-- changes cannot run at once.
begin;
drop function if exists public.amobla_create_order(uuid,uuid,text);
create function public.amobla_create_order(p_user uuid,p_id uuid,p_sku text,p_replace boolean default false) returns jsonb language plpgsql security definer set search_path=public as $$
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
  ))
 ) then raise exception 'SUBSCRIPTION_EXISTS'; end if;
 insert into orders(id,user_id,sku,snapshot,status) values(p_id,p_user,p_sku,to_jsonb(product),'creating') returning * into o;
 return jsonb_build_object('order',to_jsonb(o),'dispatch',true);
end $$;
revoke all on function public.amobla_create_order(uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.amobla_create_order(uuid,uuid,text,boolean) to service_role;
commit;
