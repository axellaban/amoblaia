-- Commercial demos: personalised galleries of a real-estate agency's own
-- listing, staged with the existing generation engine and shared through an
-- unguessable public link.
--
-- * Only the server (service_role) reads or writes these tables. Browsers get
--   no grants and no policies: the admin panel and the public page both go
--   through server routes that check the admin list or the published state.
-- * Photos reuse `projects` (original in the private bucket) and
--   `generations` (same reservation, daily capacity, storage budget, worker,
--   cost tracking). Demo projects use the hash prefix 'demo:' so they never
--   merge with, or show up in, the admin's personal library.
-- * A demo photo is covered by a zero-balance 'demo:<owner>' grant: no
--   customer credit, and no credit of the admin's own account, is reserved.
--   Idempotent: safe to run again.
begin;

create table if not exists public.agencies (
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(btrim(name)) between 1 and 120),
 website text check(website is null or length(website)<=300),
 contact_name text check(contact_name is null or length(contact_name)<=120),
 notes text check(notes is null or length(notes)<=4000),
 created_by uuid references public.profiles(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

create table if not exists public.demo_properties (
 id uuid primary key default gen_random_uuid(),
 agency_id uuid not null references public.agencies(id) on delete restrict,
 title text not null check(length(btrim(title)) between 1 and 160),
 location text check(location is null or length(location)<=160),
 listing_url text check(listing_url is null or length(listing_url)<=500),
 description text check(description is null or length(description)<=1000),
 created_by uuid references public.profiles(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(id,agency_id)
);
create index if not exists demo_properties_agency on public.demo_properties(agency_id);

create table if not exists public.demo_photos (
 id uuid primary key default gen_random_uuid(),
 property_id uuid not null references public.demo_properties(id) on delete cascade,
 project_id uuid not null references public.projects(id),
 position integer not null default 0,
 visible boolean not null default true,
 room text not null default 'living' check(length(room) between 1 and 40),
 label text check(label is null or length(label)<=80),
 style text not null default 'modern' check(length(style) between 1 and 40),
 mode text not null default 'furnish' check(mode in ('furnish','redesign')),
 approved_generation_id uuid references public.generations(id) on delete set null,
 discarded uuid[] not null default '{}',
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(property_id,project_id)
);
create index if not exists demo_photos_property on public.demo_photos(property_id,position);
create index if not exists demo_photos_project on public.demo_photos(project_id);

create table if not exists public.demos (
 id uuid primary key default gen_random_uuid(),
 agency_id uuid not null,
 property_id uuid not null unique,
 title text check(title is null or length(title)<=160),
 token text not null unique check(token ~ '^[A-Za-z0-9_-]{20,64}$'),
 status text not null default 'draft' check(status in ('draft','published')),
 cover_photo_id uuid references public.demo_photos(id) on delete set null,
 published_at timestamptz,
 created_by uuid references public.profiles(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 -- The demo's agency is always the property's agency.
 foreign key(property_id,agency_id) references public.demo_properties(id,agency_id) on delete cascade
);
create index if not exists demos_agency on public.demos(agency_id);

create or replace function public.amobla_touch_updated_at() returns trigger language plpgsql set search_path=public as $$
begin
 new.updated_at:=now();
 return new;
end $$;
do $$ declare t text; begin
 foreach t in array array['agencies','demo_properties','demo_photos','demos'] loop
  execute format('drop trigger if exists touch_updated_at on public.%I',t);
  execute format('create trigger touch_updated_at before update on public.%I for each row execute function public.amobla_touch_updated_at()',t);
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;

-- Reserves a staging of a demo photo through the regular batch reservation.
-- The project is attached to the owner's zero-balance demo grant first, so
-- amobla_reserve_generation treats the photo as covered: no credit moves,
-- results are full quality without watermark, and every other control
-- (account lock, one live batch, daily capacity, per-account share, storage
-- budget, idempotency by key) still applies. Authorization (admin list) is
-- checked by the server before calling; only service_role can execute.
create or replace function public.amobla_reserve_demo_generation(p_actor uuid,p_photo uuid,p_key uuid,p_room text,p_style text,p_mode text,p_notes text,p_prompt text,p_daily_limit integer default 100)
 returns uuid[] language plpgsql security definer set search_path=public as $$
declare ph demo_photos; p projects; g uuid; jobs uuid[];
begin
 if p_mode not in ('furnish','redesign') then raise exception 'INVALID_DEMO_MODE'; end if;
 select * into ph from demo_photos where id=p_photo;
 if not found then raise exception 'DEMO_PHOTO_NOT_FOUND'; end if;
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

revoke all on function public.amobla_touch_updated_at() from public,anon,authenticated;
revoke all on function public.amobla_reserve_demo_generation(uuid,uuid,uuid,text,text,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.amobla_reserve_demo_generation(uuid,uuid,uuid,text,text,text,text,text,integer) to service_role;
commit;
