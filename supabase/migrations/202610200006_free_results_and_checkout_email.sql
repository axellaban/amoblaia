begin;
alter table public.orders add column if not exists payer_email text;
alter table public.generations add column if not exists is_free boolean not null default false;
-- Preserve usage already delivered by the previous three-result trial.
update public.generations j set is_free=true
 from public.projects p join public.credit_grants g on g.id=p.grant_id
 where j.project_id=p.id and g.source_key like 'trial:%';
create index if not exists generations_free_usage on public.generations(user_id,status) where is_free;

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
 select * into p from projects where id=p_project and user_id=p_user and deleted_at is null for update;
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
  if (select count(*) from generations where user_id=p_user and is_free and status in ('queued','running','succeeded','needs_review'))>=25 then raise exception 'FREE_LIMIT'; end if;
 elsif (select count(*) from generations where project_id=p.id and not is_free and status in ('queued','running','succeeded','needs_review'))>=3 then
  raise exception 'VERSION_LIMIT';
 end if;
 insert into generations(user_id,project_id,request_key,room,style,mode,notes,prompt,reserved_credit,is_free)
 values(p_user,p.id,p_key,p_room,p_style,p_mode,left(p_notes,500),p_prompt,first_photo,free_result) returning id into j;
 if first_photo then insert into credit_ledger(user_id,grant_id,generation_id,delta,reason) values(p_user,g.id,j,-1,'photo_reserved'); end if;
 return j;
end $$;
commit;
