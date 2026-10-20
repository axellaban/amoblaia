-- Apply to a NEW, dedicated Supabase Free project for amoblaIA.
-- All financial mutations run through server-only RPCs. Clients can only read their own rows.
begin;
create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(), blocked boolean not null default false,
 trial_claimed boolean not null default false
);
create table public.products (
 sku text primary key, name text not null, kind text not null check(kind in ('pack','month','year')),
 photos integer not null check(photos>0), versions integer not null default 3 check(versions between 1 and 3),
 price_cents bigint check(price_cents>=100), active boolean not null default false
);
insert into public.products(sku,name,kind,photos) values
 ('pack-10','Pack 10','pack',10),('pack-25','Pack 25','pack',25),
 ('basic-month','Inicial','month',6),('basic-year','Inicial anual','year',6),
 ('standard-month','Agente','month',20),('standard-year','Agente anual','year',20),
 ('professional-month','Profesional','month',60),('professional-year','Profesional anual','year',60),
 ('enterprise-month','Inmobiliaria','month',150),('enterprise-year','Inmobiliaria anual','year',150);
create table public.orders (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id),
 sku text not null references public.products(sku), snapshot jsonb not null,
 created_at timestamptz not null default now(), status text not null default 'created',
 checkout_id text, checkout_url text, provider_subscription_id text unique
);
create table public.subscriptions (
 id text primary key, order_id uuid not null unique references public.orders(id),
 user_id uuid not null references public.profiles(id), status text not null default 'pending',
 paid_until timestamptz, created_at timestamptz not null default now()
);
create unique index subscriptions_one_open on public.subscriptions(user_id) where status in ('authorized','pending','paused');
create table public.payments (
 id text primary key, order_id uuid not null references public.orders(id), user_id uuid not null references public.profiles(id),
 status text not null, amount_cents bigint not null, paid_at timestamptz,
 coverage_start timestamptz, coverage_end timestamptz,
 created_at timestamptz not null default now()
);
create table public.credit_grants (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id),
 source_key text not null unique, payment_id text references public.payments(id),
 total integer not null check(total>0), remaining integer not null check(remaining>=0 and remaining<=total),
 starts_at timestamptz not null default now(), expires_at timestamptz, revoked boolean not null default false,
 created_at timestamptz not null default now()
);
create table public.projects (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id),
 original_hash text not null, original_path text not null, name text not null,
 original_bytes integer not null check(original_bytes>0), grant_id uuid references public.credit_grants(id),
 created_at timestamptz not null default now(), deleted_at timestamptz
);
create unique index projects_active_hash on public.projects(user_id,original_hash) where deleted_at is null;
create table public.generations (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id),
 project_id uuid not null references public.projects(id), request_key uuid not null,
 room text not null, style text not null, mode text not null, notes text not null default '', prompt text not null,
 status text not null default 'queued' check(status in ('queued','running','succeeded','failed','needs_review')),
 result_path text, result_bytes integer, model text, provider_request_id text, usage jsonb,
 estimated_usd numeric(12,6), error_code text, reserved_credit boolean not null default false,
 created_at timestamptz not null default now(), started_at timestamptz, finished_at timestamptz,
 unique(user_id,request_key)
);
create index generations_queue on public.generations(status,created_at);
create index generations_project on public.generations(project_id,created_at desc);
create index grants_balance on public.credit_grants(user_id,expires_at);
create index payments_user on public.payments(user_id,created_at desc);
create table public.credit_ledger (
 id bigint generated always as identity primary key, user_id uuid not null references public.profiles(id),
 grant_id uuid references public.credit_grants(id), generation_id uuid references public.generations(id),
 delta integer not null, reason text not null, created_at timestamptz not null default now()
);
create table public.webhook_events (
 event_key text primary key, topic text not null, resource_id text not null,
 received_at timestamptz not null default now(), processed_at timestamptz, attempts integer not null default 0,
 last_error text
);
create table public.admin_audit (
 id bigint generated always as identity primary key, actor_id uuid not null references public.profiles(id),
 action text not null, subject_id text, details jsonb not null default '{}', created_at timestamptz not null default now()
);

create function public.amobla_refresh_annual(p_user uuid) returns void language plpgsql security definer set search_path=public as $$
declare r record; i integer; a timestamptz; b timestamptz; g uuid;
begin
 for r in select p.*,o.snapshot from payments p join orders o on o.id=p.order_id
   where p.user_id=p_user and p.status='approved' and o.snapshot->>'kind'='year'
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
create function public.amobla_account(p_user uuid,p_trial boolean default false) returns jsonb language plpgsql security definer set search_path=public as $$
declare g uuid; n integer;
begin
 insert into profiles(id) values(p_user) on conflict do nothing;
 perform 1 from profiles where id=p_user for update;
 if p_trial and not (select trial_claimed from profiles where id=p_user) then
  update profiles set trial_claimed=true where id=p_user;
  insert into credit_grants(user_id,source_key,total,remaining,expires_at) values(p_user,'trial:'||p_user,1,1,now()+interval '30 days') returning id into g;
  insert into credit_ledger(user_id,grant_id,delta,reason) values(p_user,g,1,'trial');
 end if;
 perform amobla_refresh_annual(p_user);
 select coalesce(sum(remaining),0) into n from credit_grants where user_id=p_user and not revoked and starts_at<=now() and (expires_at is null or expires_at>now());
 return jsonb_build_object('credits',n,'blocked',(select blocked from profiles where id=p_user));
end $$;

create function public.amobla_create_order(p_user uuid,p_id uuid,p_sku text) returns jsonb language plpgsql security definer set search_path=public as $$
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
  exists(select 1 from subscriptions where user_id=p_user and status in ('pending','authorized','paused')) or
  exists(select 1 from orders where user_id=p_user and snapshot->>'kind'<>'pack' and status in ('creating','checkout_ready','checkout_needs_review'))
 ) then raise exception 'SUBSCRIPTION_EXISTS'; end if;
 insert into orders(id,user_id,sku,snapshot,status) values(p_id,p_user,p_sku,to_jsonb(product),'creating') returning * into o;
 return jsonb_build_object('order',to_jsonb(o),'dispatch',true);
end $$;

create function public.amobla_reserve_generation(p_user uuid,p_project uuid,p_key uuid,p_room text,p_style text,p_mode text,p_notes text,p_prompt text,p_daily_limit integer default 100)
 returns uuid language plpgsql security definer set search_path=public as $$
declare p projects; g credit_grants; j uuid; first_photo boolean:=false;
begin
 -- One account lock serializes balance decisions and first-photo reservations.
 perform 1 from profiles where id=p_user for update;
 if not found or (select blocked from profiles where id=p_user) then raise exception 'ACCOUNT_BLOCKED'; end if;
 select id into j from generations where user_id=p_user and request_key=p_key;
 if j is not null then return j; end if;
 if exists(select 1 from generations where user_id=p_user and status in ('queued','running')) then raise exception 'BUSY'; end if;
 perform pg_advisory_xact_lock(20261020);
 if (select count(*) from generations where created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')>=p_daily_limit then raise exception 'DAILY_LIMIT'; end if;
 if (select coalesce(sum(original_bytes),0) from projects where deleted_at is null)
  + (select coalesce(sum(case when budget_job.status='succeeded' then coalesce(budget_job.result_bytes,0) else 4194304 end),0) from generations budget_job join projects budget_project on budget_project.id=budget_job.project_id where budget_project.deleted_at is null and budget_job.status in ('queued','running','needs_review','succeeded'))
  + 4194304 > 800*1024*1024 then raise exception 'STORAGE_LIMIT'; end if;
 select * into p from projects where id=p_project and user_id=p_user and deleted_at is null for update;
 if not found then raise exception 'PROJECT_NOT_FOUND'; end if;
 if (select count(*) from generations where project_id=p.id and status in ('queued','running','succeeded','needs_review'))>=3 then raise exception 'VERSION_LIMIT'; end if;
 if p.grant_id is null then
  perform amobla_refresh_annual(p_user);
  select * into g from credit_grants where user_id=p_user and not revoked and remaining>0 and starts_at<=now() and (expires_at is null or expires_at>now()) order by expires_at nulls last,created_at limit 1 for update;
  if not found then raise exception 'NO_CREDITS'; end if;
  update credit_grants set remaining=remaining-1 where id=g.id;
  update projects set grant_id=g.id where id=p.id;
  first_photo:=true;
 elsif exists(select 1 from credit_grants where id=p.grant_id and revoked) then raise exception 'ACCOUNT_BLOCKED';
 end if;
 insert into generations(user_id,project_id,request_key,room,style,mode,notes,prompt,reserved_credit)
 values(p_user,p.id,p_key,p_room,p_style,p_mode,left(p_notes,500),p_prompt,first_photo) returning id into j;
 if first_photo then insert into credit_ledger(user_id,grant_id,generation_id,delta,reason) values(p_user,g.id,j,-1,'photo_reserved'); end if;
 return j;
end $$;
create function public.amobla_claim_generation(p_job uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare j generations;
begin
 update generations set status='running',started_at=now() where id=p_job and status='queued' returning * into j;
 if not found then return null; end if;
 return to_jsonb(j);
end $$;
create function public.amobla_finish_generation(p_job uuid,p_status text,p_result text default null,p_bytes integer default null,p_model text default null,p_usage jsonb default null,p_cost numeric default null,p_request text default null,p_error text default null)
 returns void language plpgsql security definer set search_path=public as $$
declare j generations; p projects;
begin
 if p_status not in ('succeeded','failed','needs_review') then raise exception 'BAD_STATUS'; end if;
 select * into j from generations where id=p_job for update;
 if not found or j.status not in ('running','queued','needs_review') then return; end if;
 if p_status='succeeded' and (p_result is null or p_bytes is null) then raise exception 'MISSING_RESULT'; end if;
 update generations set status=p_status,result_path=p_result,result_bytes=p_bytes,model=coalesce(p_model,model),usage=coalesce(p_usage,usage),estimated_usd=coalesce(p_cost,estimated_usd),provider_request_id=coalesce(p_request,provider_request_id),error_code=p_error,finished_at=now() where id=p_job;
 if p_status='failed' and j.reserved_credit then
  select * into p from projects where id=j.project_id for update;
  if p.grant_id is not null then
   update credit_grants set remaining=least(total,remaining+1) where id=p.grant_id;
   insert into credit_ledger(user_id,grant_id,generation_id,delta,reason) values(j.user_id,p.grant_id,j.id,1,'technical_failure');
   update projects set grant_id=null where id=p.id;
  end if;
 end if;
end $$;

create function public.amobla_apply_payment(p_id text,p_order uuid,p_status text,p_amount bigint,p_paid_at timestamptz,p_subscription text default null)
 returns void language plpgsql security definer set search_path=public as $$
declare o orders; previous payments; anchor timestamptz; ending timestamptz; g uuid; r record;
begin
 select * into o from orders where id=p_order for update;
 if not found then raise exception 'ORDER_NOT_FOUND'; end if;
 if p_amount<>(o.snapshot->>'price_cents')::bigint then raise exception 'AMOUNT_MISMATCH'; end if;
 if o.snapshot->>'kind'<>'pack' and (p_subscription is null or p_subscription is distinct from o.provider_subscription_id) then raise exception 'SUBSCRIPTION_MISMATCH'; end if;
 select * into previous from payments where id=p_id for update;
 if previous.id is not null and previous.order_id<>o.id then raise exception 'ORDER_MISMATCH'; end if;
 -- A terminal reversal cannot be undone by an older approved notification.
 if previous.status in ('refunded','charged_back','in_mediation','partially_refunded') and p_status='approved' then return; end if;
 if previous.coverage_start is not null and p_status not in ('refunded','charged_back','in_mediation','partially_refunded') then return; end if;
 insert into payments(id,order_id,user_id,status,amount_cents,paid_at) values(p_id,p_order,o.user_id,p_status,p_amount,p_paid_at)
 on conflict(id) do update set status=excluded.status;
 if p_status in ('refunded','charged_back','in_mediation','partially_refunded') then
  update credit_grants set revoked=true where payment_id=p_id;
  if exists(select 1 from credit_grants where payment_id=p_id and remaining<total) or p_status in ('charged_back','in_mediation','partially_refunded') then update profiles set blocked=true where id=o.user_id; end if;
  return;
 end if;
 if p_status<>'approved' or previous.coverage_start is not null then return; end if;
 -- Checkout Pro permits multiple payment attempts: a pack order grants once.
 if o.snapshot->>'kind'='pack' and exists(select 1 from payments where order_id=o.id and id<>p_id and coverage_start is not null) then raise exception 'DUPLICATE_ORDER_PAYMENT'; end if;
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
end $$;
create function public.amobla_admin_credit(p_actor uuid,p_user uuid,p_photos integer,p_reason text) returns void language plpgsql security definer set search_path=public as $$
declare g uuid;
begin
 if p_photos<1 or p_photos>1000 or length(trim(p_reason))<5 then raise exception 'INVALID_ADJUSTMENT'; end if;
 insert into credit_grants(user_id,source_key,total,remaining) values(p_user,'admin:'||gen_random_uuid(),p_photos,p_photos) returning id into g;
 insert into credit_ledger(user_id,grant_id,delta,reason) values(p_user,g,p_photos,'admin_adjustment');
 insert into admin_audit(actor_id,action,subject_id,details) values(p_actor,'grant',p_user,jsonb_build_object('photos',p_photos,'reason',p_reason));
end $$;

-- Supabase API defaults must not allow browser writes to billing tables.
do $$ declare t text; f record; begin
 foreach t in array array['profiles','orders','subscriptions','payments','credit_grants','projects','generations','credit_ledger'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy own_read on public.%I for select to authenticated using (%s)',t,case when t='profiles' then 'id=auth.uid()' else 'user_id=auth.uid()' end);
 end loop;
 foreach t in array array['products','webhook_events','admin_audit'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
 end loop;
 for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname like 'amobla_%' loop
  execute 'revoke all on function '||f.signature||' from public,anon,authenticated';
  execute 'grant execute on function '||f.signature||' to service_role';
 end loop;
end $$;
grant all on all tables in schema public to service_role;
grant usage,select on all sequences in schema public to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('property-images','property-images',false,4194304,array['image/jpeg']) on conflict(id) do nothing;
create policy private_images_read on storage.objects for select to authenticated
 using(bucket_id='property-images' and (storage.foldername(name))[1]=auth.uid()::text);
commit;
