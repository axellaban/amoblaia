begin;
create table public.folders (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id),
 name text not null check(length(name) between 1 and 80), created_at timestamptz not null default now(), archived_at timestamptz
);
alter table public.folders enable row level security;
create policy folders_owner_read on public.folders for select to authenticated using(user_id=auth.uid());
revoke all on public.folders from anon,authenticated;
grant select on public.folders to authenticated;
grant all on public.folders to service_role;
alter table public.projects add column folder_id uuid references public.folders(id);
alter table public.projects add column trashed_at timestamptz;
create index projects_folder on public.projects(user_id,folder_id) where deleted_at is null;
create function public.amobla_manage_project(p_user uuid,p_project uuid,p_action text,p_name text default null,p_folder uuid default null)
 returns void language plpgsql security definer set search_path=public as $$
declare p projects;
begin
 perform 1 from profiles where id=p_user for update;
 select * into p from projects where id=p_project and user_id=p_user and deleted_at is null for update;
 if not found then raise exception 'PROJECT_NOT_FOUND'; end if;
 if p_action in ('trash','restore') and exists(select 1 from generations where project_id=p.id and status in ('queued','running','needs_review')) then raise exception 'BUSY'; end if;
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
revoke all on function public.amobla_manage_project(uuid,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.amobla_manage_project(uuid,uuid,text,text,uuid) to service_role;
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
