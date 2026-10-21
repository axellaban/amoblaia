-- Merging a guest photo into an identical one of the account soft-deletes the
-- guest project; its original file was left in storage. The claim now returns
-- those originals so the app removes them. Results keep their own paths.
begin;
drop function if exists public.amobla_claim_guest(uuid,uuid);
create function public.amobla_claim_guest(p_guest uuid,p_user uuid) returns text[] language plpgsql security definer set search_path=public as $$
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
revoke all on function public.amobla_claim_guest(uuid,uuid) from public,anon,authenticated;
grant execute on function public.amobla_claim_guest(uuid,uuid) to service_role;
commit;
