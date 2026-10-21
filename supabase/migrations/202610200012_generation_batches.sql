-- All three proposals are reserved before dispatch, survive browser navigation,
-- and render independently. A new batch cannot overlap the previous one.
begin;
alter table public.generations add column if not exists batch_id uuid;
create index if not exists generations_batch on public.generations(user_id,batch_id) where batch_id is not null;
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
    (select count(*) from generations j
      where j.guest_ip_hash=(select ip_hash from guest_sessions where user_id=p_user)
       and j.is_free and j.created_at>now()-interval '24 hours' and j.status in ('queued','running','succeeded','needs_review'))>=25 then raise exception 'GUEST_LIMIT'; end if;
  if (select count(*) from generations where user_id=p_user and is_free and status in ('queued','running','succeeded','needs_review'))>=25 then raise exception 'FREE_LIMIT'; end if;
 elsif g.expires_at is not null and g.expires_at<=now() and not exists(
  select 1 from credit_grants entitlement where entitlement.user_id=p_user and not entitlement.revoked
   and entitlement.source_key not like 'trial:%' and entitlement.starts_at<=now()
   and (entitlement.expires_at is null or entitlement.expires_at>now())
 ) then
  raise exception 'ENTITLEMENT_EXPIRED';
 end if;
 insert into generations(user_id,project_id,request_key,room,style,mode,notes,prompt,reserved_credit,is_free,guest_ip_hash,batch_id)
 values(p_user,p.id,p_key,p_room,p_style,p_mode,left(p_notes,500),p_prompt,first_photo,free_result,(select ip_hash from guest_sessions where user_id=p_user and claimed_by is null),batch) returning id into j;
 if first_photo then insert into credit_ledger(user_id,grant_id,generation_id,delta,reason) values(p_user,g.id,j,-1,'photo_reserved'); end if;
 return j;
end $$;





-- One atomic reservation per batch, one active batch per account. Repeating its
-- key returns the original jobs. At the end of the allowance 3 becomes 2 or 1.
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
 perform pg_advisory_xact_lock(20261020);
 if not exists(select 1 from credit_grants where user_id=p_user and not revoked and remaining>0 and source_key not like 'trial:%' and starts_at<=now() and (expires_at is null or expires_at>now()))
  and not exists(select 1 from projects p join credit_grants g on g.id=p.grant_id where p.id=p_project and p.user_id=p_user and g.source_key not like 'trial:%') then
  select (amobla_account(p_user,false)->>'freeRemaining')::integer into available;
  n:=least(n,available);
  if n<1 then raise exception 'FREE_LIMIT'; end if;
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
revoke all on function public.amobla_reserve_batch(uuid,uuid,uuid,text,text,text,text,text[],integer) from public,anon,authenticated;
grant execute on function public.amobla_reserve_batch(uuid,uuid,uuid,text,text,text,text,text[],integer) to service_role;
commit;
