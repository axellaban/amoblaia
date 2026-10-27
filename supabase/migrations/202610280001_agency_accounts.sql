-- Real-estate agencies as accounts of habita: the agencies the team prepared
-- demos for, and the ones that sign up on their own, share one model.
--
-- * agencies gets an owner (the account whose credits pay its generations),
--   a public slug for its site (/inmobiliaria/<slug>) and whether that site
--   is published. demo_properties (properties), demos (their public page:
--   token, draft/published, settings), demo_photos (originals, backed by
--   projects) and generations (AI versions) are reused as they are.
-- * agency_members: who works for an agency (owner or collaborator). One
--   agency per account for now.
-- * property_imports: every import from a listing URL, its result and its
--   error, so failed ones can be retried and duplicates are detected.
-- * agency_claims: one-time codes the team gives an agency to take over the
--   demos prepared for it, with their stagings. Without a valid code, a
--   visitor of a demo can never take its property.
-- * Writes still go only through the server (service_role). Members may
--   read their own agency's rows (RLS); the team's internal notes and
--   contact person never are readable from a browser.
-- Additive and idempotent: no demo, photo or generation is removed.
begin;

alter table public.agencies add column if not exists slug text;
alter table public.agencies add column if not exists owner_id uuid references public.profiles(id) on delete set null;
alter table public.agencies add column if not exists claimed_at timestamptz;
alter table public.agencies add column if not exists site_published boolean not null default false;
do $$ begin
 if not exists (select 1 from pg_constraint where conname='agencies_slug_format') then
  alter table public.agencies add constraint agencies_slug_format check (slug is null or slug ~ '^[a-z0-9]([a-z0-9-]{1,46}[a-z0-9])$');
 end if;
end $$;
create unique index if not exists agencies_slug on public.agencies(slug) where slug is not null;
create unique index if not exists agencies_one_per_owner on public.agencies(owner_id) where owner_id is not null;

create table if not exists public.agency_members (
 agency_id uuid not null references public.agencies(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 role text not null check(role in ('owner','collaborator')),
 created_at timestamptz not null default now(),
 primary key(agency_id,user_id)
);
create unique index if not exists agency_members_one_agency on public.agency_members(user_id);

alter table public.demo_properties add column if not exists origin text not null default 'admin';
do $$ begin
 if not exists (select 1 from pg_constraint where conname='demo_properties_origin') then
  alter table public.demo_properties add constraint demo_properties_origin check (origin in ('admin','agency'));
 end if;
end $$;
create index if not exists demo_properties_listing on public.demo_properties(agency_id,listing_url) where listing_url is not null;

create table if not exists public.property_imports (
 id uuid primary key default gen_random_uuid(),
 agency_id uuid not null references public.agencies(id) on delete cascade,
 user_id uuid references public.profiles(id) on delete set null,
 url text not null check(length(url) between 1 and 500),
 source text check(source is null or length(source)<=120),
 status text not null default 'started' check(status in ('started','completed','failed','duplicate')),
 property_id uuid references public.demo_properties(id) on delete set null,
 error text check(error is null or length(error)<=300),
 created_at timestamptz not null default now(),
 finished_at timestamptz
);
create index if not exists property_imports_agency on public.property_imports(agency_id,created_at desc);

create table if not exists public.agency_claims (
 id uuid primary key default gen_random_uuid(),
 agency_id uuid not null references public.agencies(id) on delete cascade,
 code_hash text not null unique check(code_hash ~ '^[0-9a-f]{64}$'),
 created_by uuid references public.profiles(id) on delete set null,
 expires_at timestamptz not null,
 used_by uuid references public.profiles(id) on delete set null,
 used_at timestamptz,
 created_at timestamptz not null default now()
);
create index if not exists agency_claims_agency on public.agency_claims(agency_id);

-- A slug free for this agency: the wanted one, or with -2, -3…
create or replace function public.habita_free_slug(p_slug text,p_agency uuid default null) returns text language plpgsql security definer set search_path=public as $$
declare candidate text; i integer:=1;
begin
 if p_slug is null or p_slug !~ '^[a-z0-9]([a-z0-9-]{1,40}[a-z0-9])$' then raise exception 'INVALID_SLUG'; end if;
 candidate:=p_slug;
 while exists(select 1 from agencies where slug=candidate and id is distinct from p_agency) loop
  i:=i+1;
  candidate:=p_slug||'-'||i;
 end loop;
 return candidate;
end $$;

-- A new agency with its owner, atomically. An account works for one agency.
create or replace function public.habita_create_agency(p_user uuid,p_name text,p_slug text) returns uuid language plpgsql security definer set search_path=public as $$
declare a uuid;
begin
 insert into profiles(id) values(p_user) on conflict do nothing;
 perform 1 from profiles where id=p_user for update;
 if (select blocked from profiles where id=p_user) then raise exception 'ACCOUNT_BLOCKED'; end if;
 if exists(select 1 from agency_members where user_id=p_user) then raise exception 'AGENCY_EXISTS'; end if;
 if p_name is null or length(btrim(p_name)) not between 1 and 120 then raise exception 'INVALID_AGENCY_NAME'; end if;
 insert into agencies(name,slug,owner_id,claimed_at,created_by)
 values(btrim(p_name),habita_free_slug(p_slug),p_user,now(),p_user) returning id into a;
 insert into agency_members(agency_id,user_id,role) values(a,p_user,'owner');
 return a;
end $$;

-- Takes over an agency the team prepared demos for, with a one-time code.
-- Its demo photos become the owner's (their stagings included), and their
-- link to the team's zero-balance demo grant is cleared: from now on a new
-- staging of those photos uses the owner's own credits. A photo shared with
-- another agency's demo stays with the team.
create or replace function public.habita_claim_agency(p_user uuid,p_code_hash text,p_slug text) returns uuid language plpgsql security definer set search_path=public as $$
declare c agency_claims; a agencies; moved uuid[];
begin
 insert into profiles(id) values(p_user) on conflict do nothing;
 perform 1 from profiles where id=p_user for update;
 if (select blocked from profiles where id=p_user) then raise exception 'ACCOUNT_BLOCKED'; end if;
 if exists(select 1 from agency_members where user_id=p_user) then raise exception 'AGENCY_EXISTS'; end if;
 select * into c from agency_claims where code_hash=p_code_hash for update;
 if not found or c.used_at is not null or c.expires_at<=now() then raise exception 'CLAIM_INVALID'; end if;
 select * into a from agencies where id=c.agency_id for update;
 if a.owner_id is not null then raise exception 'CLAIM_INVALID'; end if;
 select coalesce(array_agg(distinct p.id),'{}') into moved
  from demo_photos ph join demo_properties pr on pr.id=ph.property_id join projects p on p.id=ph.project_id
  where pr.agency_id=a.id and p.deleted_at is null and p.original_hash like 'demo:%'
   and not exists(select 1 from demo_photos other join demo_properties op on op.id=other.property_id
                  where other.project_id=p.id and op.agency_id<>a.id);
 if exists(select 1 from generations where project_id=any(moved) and status in ('queued','running')) then raise exception 'BUSY'; end if;
 update agencies set owner_id=p_user,claimed_at=now(),slug=coalesce(slug,habita_free_slug(p_slug,a.id)) where id=a.id;
 insert into agency_members(agency_id,user_id,role) values(a.id,p_user,'owner');
 update projects set user_id=p_user,grant_id=null where id=any(moved);
 update generations set user_id=p_user where project_id=any(moved);
 update agency_claims set used_by=p_user,used_at=now() where id=c.id;
 insert into admin_audit(actor_id,action,subject_id,details) values(p_user,'agency_claim',a.id::text,jsonb_build_object('photos',coalesce(array_length(moved,1),0)));
 return a.id;
end $$;

-- The team's free demo staging stops once the agency has an owner: its
-- photos are then staged with the owner's credits.
create or replace function public.amobla_reserve_demo_generation(p_actor uuid,p_photo uuid,p_key uuid,p_room text,p_style text,p_mode text,p_notes text,p_prompt text,p_daily_limit integer default 100)
 returns uuid[] language plpgsql security definer set search_path=public as $$
declare ph demo_photos; p projects; g uuid; jobs uuid[];
begin
 if p_mode not in ('furnish','redesign') then raise exception 'INVALID_DEMO_MODE'; end if;
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

-- Membership check for the read policies (security definer: it reads
-- agency_members without recursing into its own policy).
create or replace function public.habita_is_member(p_agency uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from agency_members where agency_id=p_agency and user_id=auth.uid())
$$;

do $$ declare t text; begin
 foreach t in array array['agency_members','property_imports','agency_claims'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;

-- Read-only access of members to their own agency. The team's notes and
-- contact person are left out of the columns a browser may read.
revoke all on public.agencies from public,anon,authenticated;
grant select(id,name,website,slug,branding,owner_id,claimed_at,site_published,created_at,updated_at) on public.agencies to authenticated;
grant select on public.demo_properties,public.demos,public.demo_photos,public.agency_members,public.property_imports to authenticated;
drop policy if exists member_read on public.agencies;
create policy member_read on public.agencies for select to authenticated using (public.habita_is_member(id));
drop policy if exists member_read on public.demo_properties;
create policy member_read on public.demo_properties for select to authenticated using (public.habita_is_member(agency_id));
drop policy if exists member_read on public.demos;
create policy member_read on public.demos for select to authenticated using (public.habita_is_member(agency_id));
drop policy if exists member_read on public.demo_photos;
create policy member_read on public.demo_photos for select to authenticated
 using (exists(select 1 from public.demo_properties pr where pr.id=property_id and public.habita_is_member(pr.agency_id)));
drop policy if exists member_read on public.agency_members;
create policy member_read on public.agency_members for select to authenticated using (user_id=auth.uid() or public.habita_is_member(agency_id));
drop policy if exists member_read on public.property_imports;
create policy member_read on public.property_imports for select to authenticated using (public.habita_is_member(agency_id));

revoke all on function public.habita_free_slug(text,uuid) from public,anon,authenticated;
revoke all on function public.habita_create_agency(uuid,text,text) from public,anon,authenticated;
revoke all on function public.habita_claim_agency(uuid,text,text) from public,anon,authenticated;
revoke all on function public.amobla_reserve_demo_generation(uuid,uuid,uuid,text,text,text,text,text,integer) from public,anon,authenticated;
revoke all on function public.habita_is_member(uuid) from public,anon;
grant execute on function public.habita_is_member(uuid) to authenticated,service_role;
grant execute on function public.habita_free_slug(text,uuid) to service_role;
grant execute on function public.habita_create_agency(uuid,text,text) to service_role;
grant execute on function public.habita_claim_agency(uuid,text,text) to service_role;
grant execute on function public.amobla_reserve_demo_generation(uuid,uuid,uuid,text,text,text,text,text,integer) to service_role;
commit;
