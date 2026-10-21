-- No-registration trial. Anonymous identities have the same isolated data access,
-- but purchases, account actions and library management still require verified sign-in.
begin;
alter table public.profiles add column if not exists onboarding_completed_at timestamptz;
create table public.guest_sessions (
 user_id uuid primary key references public.profiles(id), ip_hash text not null,
 created_at timestamptz not null default now(), claimed_by uuid references public.profiles(id)
);
create index guest_sessions_origin on public.guest_sessions(ip_hash,created_at);
alter table public.guest_sessions enable row level security;
revoke all on public.guest_sessions from anon,authenticated;
grant all on public.guest_sessions to service_role;
create function public.amobla_guest_capacity(p_ip text) returns void language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtext(p_ip));
 if (select count(*) from guest_sessions where ip_hash=p_ip and created_at>now()-interval '24 hours')>=5 then raise exception 'GUEST_LIMIT'; end if;
end $$;
create function public.amobla_register_guest(p_user uuid,p_ip text) returns void language plpgsql security definer set search_path=public as $$
begin
 perform amobla_account(p_user,true);
 perform pg_advisory_xact_lock(hashtext(p_ip));
 if exists(select 1 from guest_sessions where user_id=p_user) then return; end if;
 perform amobla_guest_capacity(p_ip);
 insert into guest_sessions(user_id,ip_hash) values(p_user,p_ip);
end $$;
create or replace function public.amobla_account(p_user uuid,p_trial boolean default false) returns jsonb
 language plpgsql security definer set search_path=public as $$
declare g uuid; n integer; used integer; eligible boolean;
begin
 insert into profiles(id) values(p_user) on conflict do nothing;
 perform 1 from profiles where id=p_user for update;
 if p_trial and not (select trial_claimed from profiles where id=p_user) then
  update profiles set trial_claimed=true where id=p_user;
  insert into credit_grants(user_id,source_key,total,remaining,expires_at)
   values(p_user,'trial:'||p_user,1,0,null) on conflict(source_key) do nothing returning id into g;
  if g is not null then insert into credit_ledger(user_id,grant_id,delta,reason) values(p_user,g,0,'free_results_enabled'); end if;
 end if;
 perform amobla_refresh_annual(p_user);
 select coalesce(sum(remaining),0) into n from credit_grants
  where user_id=p_user and not revoked and source_key not like 'trial:%'
   and starts_at<=now() and (expires_at is null or expires_at>now());
 select count(*) into used from generations where user_id=p_user and is_free
  and status in ('queued','running','succeeded','needs_review');
 if exists(select 1 from guest_sessions where user_id=p_user and claimed_by is null) then
  used:=greatest(used,(select count(*) from generations j join guest_sessions s on s.user_id=j.user_id
   where s.ip_hash=(select ip_hash from guest_sessions where user_id=p_user)
    and j.is_free and j.created_at>now()-interval '24 hours' and j.status in ('queued','running','succeeded','needs_review')));
 end if;
 select trial_claimed into eligible from profiles where id=p_user;
 return jsonb_build_object('credits',n,'freeUsed',used,'freeLimit',25,
  'freeRemaining',case when eligible then greatest(0,25-used) else 0 end,
  'blocked',(select blocked from profiles where id=p_user));
end $$;

create or replace function public.amobla_reserve_generation(p_user uuid,p_project uuid,p_key uuid,p_room text,p_style text,p_mode text,p_notes text,p_prompt text,p_daily_limit integer default 100)
 returns uuid language plpgsql security definer set search_path=public as $$
declare p projects; g credit_grants; j uuid; first_photo boolean:=false; free_result boolean:=false;
begin
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
 select * into p from projects where id=p_project and user_id=p_user and deleted_at is null and trashed_at is null for update;
 if not found then raise exception 'PROJECT_NOT_FOUND'; end if;
 if p.grant_id is not null then
  select * into g from credit_grants where id=p.grant_id;
  if g.revoked then raise exception 'ACCOUNT_BLOCKED'; end if;
 end if;
 if p.grant_id is null or g.source_key like 'trial:%' then
  perform amobla_refresh_annual(p_user);
  select * into g from credit_grants where user_id=p_user and not revoked and remaining>0
   and source_key not like 'trial:%' and starts_at<=now() and (expires_at is null or expires_at>now())
   order by expires_at nulls last,created_at limit 1 for update;
  if found then
   update credit_grants set remaining=remaining-1 where id=g.id;
   update projects set grant_id=g.id where id=p.id;
   first_photo:=true;
  else
   if not (select trial_claimed from profiles where id=p_user) then raise exception 'NO_CREDITS'; end if;
   select * into g from credit_grants where user_id=p_user and source_key='trial:'||p_user and not revoked;
   if not found then raise exception 'NO_CREDITS'; end if;
   free_result:=true;
   update projects set grant_id=g.id where id=p.id;
  end if;
 end if;
 if free_result then
  if p_room not in ('living','bedroom') or p_mode not in ('furnish','redesign') then raise exception 'FREE_FEATURE_LOCKED'; end if;
  if exists(select 1 from guest_sessions where user_id=p_user and claimed_by is null) and
    (select count(*) from generations j join guest_sessions s on s.user_id=j.user_id
      where s.ip_hash=(select ip_hash from guest_sessions where user_id=p_user)
       and j.is_free and j.created_at>now()-interval '24 hours' and j.status in ('queued','running','succeeded','needs_review'))>=25 then raise exception 'GUEST_LIMIT'; end if;
  if (select count(*) from generations where user_id=p_user and is_free and status in ('queued','running','succeeded','needs_review'))>=25 then raise exception 'FREE_LIMIT'; end if;
 elsif g.expires_at is not null and g.expires_at<=now() and not exists(
  select 1 from credit_grants entitlement where entitlement.user_id=p_user and not entitlement.revoked
   and entitlement.source_key not like 'trial:%' and entitlement.starts_at<=now()
   and (entitlement.expires_at is null or entitlement.expires_at>now())
 ) then
  raise exception 'ENTITLEMENT_EXPIRED';
 end if;
 insert into generations(user_id,project_id,request_key,room,style,mode,notes,prompt,reserved_credit,is_free)
 values(p_user,p.id,p_key,p_room,p_style,p_mode,left(p_notes,500),p_prompt,first_photo,free_result) returning id into j;
 if first_photo then insert into credit_ledger(user_id,grant_id,generation_id,delta,reason) values(p_user,g.id,j,-1,'photo_reserved'); end if;
 return j;
end $$;



-- Only the server can call this after proving both the guest cookie and Google session.
-- Move free usage as well as the images, so sign-in never grants a second free allowance.
create function public.amobla_claim_guest(p_guest uuid,p_user uuid) returns void language plpgsql security definer set search_path=public as $$
declare r record; destination uuid; trial uuid;
begin
 if p_guest=p_user then return; end if;
 perform amobla_account(p_user,true);
 perform 1 from profiles where id in (p_guest,p_user) order by id for update;
 if not exists(select 1 from guest_sessions where user_id=p_guest and claimed_by is null) then return; end if;
 if exists(select 1 from orders where user_id=p_guest) or exists(select 1 from credit_grants where user_id=p_guest and source_key not like 'trial:%') then raise exception 'ORDER_MISMATCH'; end if;
 select id into trial from credit_grants where user_id=p_user and source_key='trial:'||p_user;
 for r in select * from projects where user_id=p_guest loop
  destination:=null;
  if r.deleted_at is null then
   select id into destination from projects where user_id=p_user and original_hash=r.original_hash and deleted_at is null;
  end if;
  if destination is not null then
   update generations set project_id=destination where project_id=r.id;
   update projects set deleted_at=now() where id=r.id;
  end if;
  update projects set user_id=p_user,grant_id=trial,folder_id=null where id=r.id;
 end loop;
 update generations set user_id=p_user where user_id=p_guest;
 update profiles set blocked=true where id=p_guest;
 update guest_sessions set claimed_by=p_user where user_id=p_guest;
end $$;
revoke all on function public.amobla_guest_capacity(text),public.amobla_register_guest(uuid,text),public.amobla_claim_guest(uuid,uuid) from public,anon,authenticated;
grant execute on function public.amobla_guest_capacity(text),public.amobla_register_guest(uuid,text),public.amobla_claim_guest(uuid,uuid) to service_role;
commit;
