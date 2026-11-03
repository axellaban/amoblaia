-- AI tools on a photo: sky, dusk and removing objects (with a mask).
-- A tool job is a generation with mode 'tool'; its source is the original
-- photo or a version of it, and its result is saved as a version of the photo
-- (like a retouch). Tools do not count toward the photo's AI versions.
alter table public.generations
  add column if not exists tool text,
  add column if not exists source_ref text,
  add column if not exists source_path text,
  add column if not exists mask_path text;
alter table public.photo_retouches
  add column if not exists tool text;

create or replace function public.amobla_reserve_demo_generation(p_actor uuid,p_photo uuid,p_key uuid,p_room text,p_style text,p_mode text,p_notes text,p_prompt text,p_daily_limit integer default 100)
returns uuid[] language plpgsql security definer set search_path = public as $$
declare ph demo_photos; p projects; g uuid; jobs uuid[];
begin
 if p_mode not in ('furnish','redesign','tool') then raise exception 'INVALID_DEMO_MODE'; end if;
 select * into ph from demo_photos where id=p_photo;
 if not found then raise exception 'DEMO_PHOTO_NOT_FOUND'; end if;
 if exists(select 1 from demo_properties pr join agencies a on a.id=pr.agency_id where pr.id=ph.property_id and a.owner_id is not null) then
  raise exception 'AGENCY_HAS_ACCOUNT';
 end if;
 select * into p from projects where id=ph.project_id and deleted_at is null and trashed_at is null and original_hash like 'demo:%';
 if not found then raise exception 'DEMO_PHOTO_NOT_FOUND'; end if;
 insert into profiles(id) values(p.user_id) on conflict do nothing;
 perform 1 from profiles where id=p.user_id for update;
 insert into credit_grants(user_id,source_key,total,remaining) values(p.user_id,'demo:'||p.user_id,1,0)
  on conflict(source_key) do nothing;
 select id into g from credit_grants where source_key='demo:'||p.user_id;
 if p.grant_id is distinct from g then update projects set grant_id=g where id=p.id; end if;
 jobs:=amobla_reserve_batch(p.user_id,p.id,p_key,p_room,p_style,p_mode,p_notes,array[p_prompt],p_daily_limit);
 insert into admin_audit(actor_id,action,subject_id,details)
  values(p_actor,'demo_generation',p_photo::text,jsonb_build_object('jobs',to_jsonb(jobs),'style',p_style,'mode',p_mode,'room',p_room));
 return jobs;
end $$;
