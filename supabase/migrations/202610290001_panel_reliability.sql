-- Imports that tell what really happened, and invitations that can be revoked.
--
-- * property_imports: a "partial" state (property created, but its data or
--   some photos are missing), the photos still to download (to retry only
--   those), the property page it created, a request key (the same confirm
--   sent twice creates one property) and the preview's snapshot.
-- * One import at a time per listing URL and agency: a second concurrent
--   attempt is refused while the first is "started". Rows left "started" by
--   a crash are closed by the server after 10 minutes.
-- * agency_claims.revoked_at: the team can revoke a link before it is used;
--   habita_claim_agency refuses revoked codes.
-- * habita_agency_counts / habita_admin_agencies: real totals for the panel
--   and the team's list of agencies (server only).
-- Additive and idempotent: existing rows keep their values, duplicates that
-- already exist are not removed.
begin;

alter table public.property_imports drop constraint if exists property_imports_status_check;
alter table public.property_imports drop constraint if exists property_imports_status;
alter table public.property_imports add constraint property_imports_status
 check (status in ('started','completed','partial','failed','duplicate'));
alter table public.property_imports add column if not exists demo_id uuid references public.demos(id) on delete set null;
alter table public.property_imports add column if not exists photos_total integer check (photos_total is null or photos_total >= 0);
alter table public.property_imports add column if not exists photos_done integer check (photos_done is null or photos_done >= 0);
alter table public.property_imports add column if not exists pending_images jsonb not null default '[]'::jsonb;
alter table public.property_imports add column if not exists settings_saved boolean;
alter table public.property_imports add column if not exists request_key uuid;
alter table public.property_imports add column if not exists snapshot text check (snapshot is null or snapshot ~ '^[0-9a-f]{64}$');
alter table public.property_imports add column if not exists updated_at timestamptz not null default now();
do $$ begin
 if not exists (select 1 from pg_constraint where conname='property_imports_pending_size') then
  alter table public.property_imports add constraint property_imports_pending_size check (octet_length(pending_images::text) <= 40000);
 end if;
end $$;
create unique index if not exists property_imports_request on public.property_imports(agency_id,request_key) where request_key is not null;
create unique index if not exists property_imports_running on public.property_imports(agency_id,url) where status='started';
drop trigger if exists touch_updated_at on public.property_imports;
create trigger touch_updated_at before update on public.property_imports for each row execute function public.amobla_touch_updated_at();

alter table public.agency_claims add column if not exists revoked_at timestamptz;

create or replace function public.habita_claim_agency(p_user uuid,p_code_hash text,p_slug text) returns uuid language plpgsql security definer set search_path=public as $$
declare c agency_claims; a agencies; moved uuid[];
begin
 insert into profiles(id) values(p_user) on conflict do nothing;
 perform 1 from profiles where id=p_user for update;
 if (select blocked from profiles where id=p_user) then raise exception 'ACCOUNT_BLOCKED'; end if;
 if exists(select 1 from agency_members where user_id=p_user) then raise exception 'AGENCY_EXISTS'; end if;
 select * into c from agency_claims where code_hash=p_code_hash for update;
 if not found or c.used_at is not null or c.revoked_at is not null or c.expires_at<=now() then raise exception 'CLAIM_INVALID'; end if;
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
-- Real totals of an agency's properties for its panel (no list limit involved).
create or replace function public.habita_agency_counts(p_agency uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object(
  'total',(select count(*) from demos where agency_id=p_agency),
  'published',(select count(*) from demos where agency_id=p_agency and status='published'),
  'staged',(select count(distinct d.id) from demos d join demo_photos ph on ph.property_id=d.property_id
            join generations g on g.project_id=ph.project_id
            where d.agency_id=p_agency and g.status='succeeded' and not g.is_free),
  'review',(select count(distinct d.id) from demos d join demo_photos ph on ph.property_id=d.property_id
            join generations g on g.project_id=ph.project_id
            where d.agency_id=p_agency and g.status='needs_review'),
  'operations',(select coalesce(jsonb_agg(distinct d.settings->>'operation') filter (where d.settings->>'operation' is not null),'[]'::jsonb)
                from demos d where d.agency_id=p_agency)
 )
$$;
revoke all on function public.habita_agency_counts(uuid) from public,anon,authenticated;
grant execute on function public.habita_agency_counts(uuid) to service_role;

-- The team's list of agencies, with the facts their stage is derived from.
create or replace function public.habita_admin_agencies(p_q text default null,p_limit integer default 50,p_offset integer default 0)
returns table(id uuid,name text,slug text,owner_id uuid,claimed_at timestamptz,site_published boolean,created_at timestamptz,
 properties bigint,published bigint,partial_imports bigint,failed_imports bigint,review bigint,
 live_claim_expires timestamptz,last_claim_at timestamptz,total bigint)
language sql stable security definer set search_path=public as $$
 select a.id,a.name,a.slug,a.owner_id,a.claimed_at,a.site_published,a.created_at,
  (select count(*) from demos d where d.agency_id=a.id),
  (select count(*) from demos d where d.agency_id=a.id and d.status='published'),
  (select count(*) from property_imports i where i.agency_id=a.id and i.status='partial'),
  (select count(*) from property_imports i where i.agency_id=a.id and i.status='failed'),
  (select count(distinct g.id) from demos d join demo_photos ph on ph.property_id=d.property_id
    join generations g on g.project_id=ph.project_id where d.agency_id=a.id and g.status='needs_review'),
  (select max(c.expires_at) from agency_claims c where c.agency_id=a.id and c.used_at is null and c.revoked_at is null and c.expires_at>now()),
  (select max(c.created_at) from agency_claims c where c.agency_id=a.id),
  count(*) over()
 from agencies a
 where p_q is null or a.name ilike '%'||replace(replace(replace(p_q,'\','\\'),'%','\%'),'_','\_')||'%' or a.slug ilike '%'||replace(replace(replace(p_q,'\','\\'),'%','\%'),'_','\_')||'%'
 order by a.created_at desc
 limit least(greatest(coalesce(p_limit,50),1),100) offset greatest(coalesce(p_offset,0),0)
$$;
revoke all on function public.habita_admin_agencies(text,integer,integer) from public,anon,authenticated;
grant execute on function public.habita_admin_agencies(text,integer,integer) to service_role;

revoke all on function public.habita_claim_agency(uuid,text,text) from public,anon,authenticated;
grant execute on function public.habita_claim_agency(uuid,text,text) to service_role;
commit;
