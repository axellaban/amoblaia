-- Generation hardening after the October 21 audit.
-- 1. Jobs whose worker died (running > 10 min, or queued > 15 min and never
--    started) no longer lock the account: they are swept to needs_review /
--    failed whenever the user reserves or polls, not only by the daily cron.
-- 2. A failed proposal refunds the photo only if no other proposal of that
--    photo delivered or can still deliver; otherwise the reservation moves to
--    a pending sibling.
-- 3. A photo whose only problem is a job under review can be trashed.
-- 4. Without a free trial, an empty account gets NO_CREDITS, not FREE_LIMIT.
-- 5. Paid regenerations need a live paid grant: an exhausted pack without
--    expiry no longer counts as one.
begin;
create or replace function public.amobla_sweep_stale(p_user uuid) returns void language plpgsql security definer set search_path=public as $$
declare stale uuid;
begin
 update generations set status='needs_review',error_code='WORKER_INTERRUPTED',finished_at=now()
  where user_id=p_user and status='running' and started_at<now()-interval '10 minutes';
 -- Never started: the provider was not called, so it fails and refunds.
 -- A row a worker is claiming right now is skipped, never failed under it.
 for stale in select id from generations where user_id=p_user and status='queued' and created_at<now()-interval '15 minutes' for update skip locked loop
  perform amobla_finish_generation(stale,'failed',p_error=>'NEVER_STARTED');
 end loop;
end $$;
revoke all on function public.amobla_sweep_stale(uuid) from public,anon,authenticated;
grant execute on function public.amobla_sweep_stale(uuid) to service_role;

create or replace function public.amobla_finish_generation(p_job uuid,p_status text,p_result text default null,p_bytes integer default null,p_model text default null,p_usage jsonb default null,p_cost numeric default null,p_request text default null,p_error text default null)
 returns void language plpgsql security definer set search_path=public as $$
declare j generations; p projects; sibling uuid; refund_grant uuid;
begin
 if p_status not in ('succeeded','failed','needs_review') then raise exception 'BAD_STATUS'; end if;
 select * into j from generations where id=p_job for update;
 if not found or j.status not in ('running','queued','needs_review') then return; end if;
 if p_status='succeeded' and (p_result is null or p_bytes is null) then raise exception 'MISSING_RESULT'; end if;
 update generations set status=p_status,result_path=p_result,result_bytes=p_bytes,model=coalesce(p_model,model),usage=coalesce(p_usage,usage),estimated_usd=coalesce(p_cost,estimated_usd),provider_request_id=coalesce(p_request,provider_request_id),error_code=p_error,finished_at=now() where id=p_job;
 if p_status='failed' and j.reserved_credit then
  select * into p from projects where id=j.project_id for update;
  -- Locked: a sibling failing at the same moment is waited for and then
  -- skipped, instead of being handed a reservation it will never return.
  -- Free (watermarked) results neither carry nor keep a paid reservation.
  select id into sibling from generations where project_id=j.project_id and id<>j.id and not is_free and status in ('queued','running','needs_review') order by created_at,id limit 1 for update;
  if sibling is not null then
   -- Another proposal may still deliver: it carries the reservation now.
   update generations set reserved_credit=false where id=j.id;
   update generations set reserved_credit=true where id=sibling;
  elsif exists(select 1 from generations where project_id=j.project_id and id<>j.id and not is_free and status='succeeded') then
   -- The photo already produced paid results: it stays paid.
   update generations set reserved_credit=false where id=j.id;
  elsif p.grant_id is not null then
   -- Back to the same grant while it is usable; otherwise (it expired while
   -- the job was under review) as a fresh one-photo grant. A grant revoked
   -- by a refund or chargeback gives nothing back.
   if exists(select 1 from credit_grants where id=p.grant_id and revoked) then
    null;
   elsif exists(select 1 from credit_grants where id=p.grant_id and (expires_at is null or expires_at>now())) then
    update credit_grants set remaining=least(total,remaining+1) where id=p.grant_id;
    insert into credit_ledger(user_id,grant_id,generation_id,delta,reason) values(j.user_id,p.grant_id,j.id,1,'technical_failure');
   else
    insert into credit_grants(user_id,source_key,total,remaining,starts_at,expires_at)
    values(j.user_id,'refund:'||j.id,1,1,now(),now()+interval '1 month')
    on conflict(source_key) do nothing returning id into refund_grant;
    if refund_grant is not null then
     insert into credit_ledger(user_id,grant_id,generation_id,delta,reason) values(j.user_id,refund_grant,j.id,1,'technical_failure');
    end if;
   end if;
   update projects set grant_id=null where id=p.id;
  end if;
 end if;
end $$;

create or replace function public.amobla_manage_project(p_user uuid,p_project uuid,p_action text,p_name text default null,p_folder uuid default null)
 returns void language plpgsql security definer set search_path=public as $$
declare p projects;
begin
 perform 1 from profiles where id=p_user for update;
 select * into p from projects where id=p_project and user_id=p_user and deleted_at is null for update;
 if not found then raise exception 'PROJECT_NOT_FOUND'; end if;
 -- Only live jobs block; a job under review keeps its files while trashed.
 if p_action in ('trash','restore') and exists(select 1 from generations where project_id=p.id and status in ('queued','running')) then raise exception 'BUSY'; end if;
 if p_action='trash' then update projects set trashed_at=now() where id=p.id;
 elsif p_action='restore' then update projects set trashed_at=null where id=p.id;
 elsif p_action='rename' then
  if p_name is null or length(trim(p_name)) not between 1 and 100 then raise exception 'INVALID_PROJECT_NAME'; end if;
  update projects set name=trim(p_name) where id=p.id;
 elsif p_action='move' then
  if p_folder is not null and not exists(select 1 from folders where id=p_folder and user_id=p_user and archived_at is null) then raise exception 'FOLDER_NOT_FOUND'; end if;
  update projects set folder_id=p_folder where id=p.id;
 else raise exception 'BAD_ACTION'; end if;
end $$;

create or replace function public.amobla_reserve_generation(p_user uuid,p_project uuid,p_key uuid,p_room text,p_style text,p_mode text,p_notes text,p_prompt text,p_daily_limit integer default 100)
 returns uuid language plpgsql security definer set search_path=public as $$
declare p projects; g credit_grants; j uuid; first_photo boolean:=false; free_result boolean:=false; batch uuid:=nullif(current_setting('amobla.batch',true),'')::uuid;
begin
 perform 1 from profiles where id=p_user for update;
 if not found or (select blocked from profiles where id=p_user) then raise exception 'ACCOUNT_BLOCKED'; end if;
 select id into j from generations where user_id=p_user and request_key=p_key;
 if j is not null then return j; end if;
 if exists(select 1 from generations where user_id=p_user and status in ('queued','running') and (batch is null or batch_id is distinct from batch)) then raise exception 'BUSY'; end if;
 perform pg_advisory_xact_lock(20261020);
 if (select count(*) from generations where created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')>=p_daily_limit then raise exception 'DAILY_LIMIT'; end if;
 -- Per-account shares: one account cannot use up the day or the storage
 -- budget for everyone else.
 if (select count(*) from generations where user_id=p_user and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')>=greatest(15,p_daily_limit/3) then raise exception 'USER_DAILY_LIMIT'; end if;
 if (select coalesce(sum(original_bytes),0) from projects where user_id=p_user and deleted_at is null)
  + (select coalesce(sum(case when own_job.status='succeeded' then coalesce(own_job.result_bytes,0) else 4194304 end),0) from generations own_job join projects own_project on own_project.id=own_job.project_id where own_project.user_id=p_user and own_project.deleted_at is null and own_job.status in ('queued','running','needs_review','succeeded'))
  + 4194304 > 320*1024*1024 then raise exception 'USER_STORAGE_LIMIT'; end if;
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
  -- An anonymous session that skipped guest registration would get a fresh
  -- 25 results with no per-IP accounting. (to_jsonb keeps this valid where
  -- auth.users has no is_anonymous column.)
  if coalesce((select (to_jsonb(u)->>'is_anonymous')::boolean from auth.users u where u.id=p_user),false)
   and not exists(select 1 from guest_sessions where user_id=p_user) then raise exception 'GUEST_REQUIRED'; end if;
  if p_room not in ('living','bedroom') or p_mode not in ('furnish','redesign') then raise exception 'FREE_FEATURE_LOCKED'; end if;
  if exists(select 1 from guest_sessions where user_id=p_user and claimed_by is null) and
    (select count(*) from generations j
      where j.guest_ip_hash=(select ip_hash from guest_sessions where user_id=p_user)
       and j.is_free and j.created_at>now()-interval '24 hours' and j.status in ('queued','running','succeeded','needs_review'))>=25 then raise exception 'GUEST_LIMIT'; end if;
  if (select count(*) from generations where user_id=p_user and is_free and status in ('queued','running','succeeded','needs_review'))>=25 then raise exception 'FREE_LIMIT'; end if;
 elsif g.expires_at is not null and g.expires_at<=now() and not exists(
  select 1 from credit_grants entitlement where entitlement.user_id=p_user and not entitlement.revoked
   and entitlement.source_key not like 'trial:%' and entitlement.starts_at<=now()
   and ((entitlement.expires_at is null and entitlement.remaining>0) or entitlement.expires_at>now())
 ) then
  raise exception 'ENTITLEMENT_EXPIRED';
 end if;
 insert into generations(user_id,project_id,request_key,room,style,mode,notes,prompt,reserved_credit,is_free,guest_ip_hash,batch_id)
 values(p_user,p.id,p_key,p_room,p_style,p_mode,left(p_notes,500),p_prompt,first_photo,free_result,(select ip_hash from guest_sessions where user_id=p_user and claimed_by is null),batch) returning id into j;
 if first_photo then insert into credit_ledger(user_id,grant_id,generation_id,delta,reason) values(p_user,g.id,j,-1,'photo_reserved'); end if;
 return j;
end $$;

create or replace function public.amobla_reserve_batch(p_user uuid,p_project uuid,p_key uuid,p_room text,p_style text,p_mode text,p_notes text,p_prompts text[],p_daily_limit integer default 100)
 returns uuid[] language plpgsql security definer set search_path=public as $$
declare jobs uuid[]; j uuid; i integer; n integer; available integer;
begin
 perform 1 from profiles where id=p_user for update;
 if not found or (select blocked from profiles where id=p_user) then raise exception 'ACCOUNT_BLOCKED'; end if;
 select array_agg(id order by created_at,id) into jobs from generations where user_id=p_user and (batch_id=p_key or request_key=p_key);
 if jobs is not null then return jobs; end if;
 n:=coalesce(array_length(p_prompts,1),0);
 if n<1 or n>3 then raise exception 'INVALID_BATCH'; end if;
 -- The photo is locked before the sweep touches its jobs, in the same order
 -- as finish_generation (project, then jobs): no deadlock between them.
 perform 1 from projects where id=p_project and user_id=p_user for update;
 -- A dead worker must not lock the account until the daily cron.
 perform amobla_sweep_stale(p_user);
 perform pg_advisory_xact_lock(20261020);
 if not exists(select 1 from credit_grants where user_id=p_user and not revoked and remaining>0 and source_key not like 'trial:%' and starts_at<=now() and (expires_at is null or expires_at>now()))
  and not exists(select 1 from projects p join credit_grants g on g.id=p.grant_id where p.id=p_project and p.user_id=p_user and g.source_key not like 'trial:%') then
  select (amobla_account(p_user,false)->>'freeRemaining')::integer into available;
  n:=least(n,available);
  if n<1 then
   if (select trial_claimed from profiles where id=p_user) then raise exception 'FREE_LIMIT'; end if;
   raise exception 'NO_CREDITS';
  end if;
 end if;
 perform set_config('amobla.batch',p_key::text,true);
 jobs:=array[]::uuid[];
 for i in 1..n loop
  j:=amobla_reserve_generation(p_user,p_project,case when i=1 then p_key else gen_random_uuid() end,p_room,p_style,p_mode,p_notes,p_prompts[i],p_daily_limit);
  jobs:=array_append(jobs,j);
 end loop;
 perform set_config('amobla.batch','',true);
 return jobs;
end $$;

-- A guest photo merged into an identical photo the account had trashed: the
-- photo is being worked on again, so the merged project leaves the trash
-- (emptying the trash would otherwise delete the guest's new results).
create or replace function public.amobla_claim_guest(p_guest uuid,p_user uuid) returns text[] language plpgsql security definer set search_path=public as $$
declare r record; destination uuid; trial uuid; orphans text[]:='{}';
begin
 if p_guest=p_user then return orphans; end if;
 perform amobla_account(p_user,true);
 perform 1 from profiles where id in (p_guest,p_user) order by id for update;
 if not exists(select 1 from guest_sessions where user_id=p_guest and claimed_by is null) then return orphans; end if;
 if exists(select 1 from orders where user_id=p_guest) or exists(select 1 from credit_grants where user_id=p_guest and source_key not like 'trial:%') then raise exception 'ORDER_MISMATCH'; end if;
 select id into trial from credit_grants where user_id=p_user and source_key='trial:'||p_user;
 for r in select * from projects where user_id=p_guest loop
  destination:=null;
  if r.deleted_at is null then
   select id into destination from projects where user_id=p_user and original_hash=r.original_hash and deleted_at is null;
  end if;
  if destination is not null then
   update generations set project_id=destination where project_id=r.id;
   update projects set trashed_at=null where id=destination;
   update projects set deleted_at=now() where id=r.id;
   orphans:=orphans||r.original_path;
  end if;
  update projects set user_id=p_user,grant_id=trial,folder_id=null where id=r.id;
 end loop;
 update generations set user_id=p_user where user_id=p_guest;
 update profiles set blocked=true where id=p_guest;
 update guest_sessions set claimed_by=p_user where user_id=p_guest;
 return orphans;
end $$;
commit;
