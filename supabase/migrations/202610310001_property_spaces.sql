-- Spaces of a property, idempotent free credits and balances for the team.
--
-- * property_spaces: the real rooms of a property ("Dormitorio principal",
--   "Dormitorio 2"…). Two bedrooms are two spaces even if both photos say
--   room=bedroom. demo_photos.space_id is optional: existing photos keep
--   their ids, order, room, label, visibility, projects and versions, and
--   show as "Sin organizar" until assigned. A photo can only point to a
--   space of its own property (composite foreign key). Deleting a space
--   leaves its photos unassigned; it never deletes photos or generations.
-- * agency_credit_requests: a request key per free-credit grant, so a double
--   click, a retry after a timeout or two tabs never credit twice.
-- * habita_admin_agency_balances: available (owner's) and reserved credits of
--   a page of agencies for the team's list, without one call per agency.
-- Additive and idempotent. Does not redefine any earlier function.
begin;

create table if not exists public.property_spaces (
 id uuid primary key default gen_random_uuid(),
 property_id uuid not null references public.demo_properties(id) on delete cascade,
 name text not null check (length(btrim(name)) between 1 and 60),
 room_type text not null default 'living' check (length(room_type) between 1 and 40),
 position integer not null default 0,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (id, property_id)
);
create index if not exists property_spaces_property on public.property_spaces(property_id, position);
drop trigger if exists touch_updated_at on public.property_spaces;
create trigger touch_updated_at before update on public.property_spaces for each row execute function public.amobla_touch_updated_at();

alter table public.demo_photos add column if not exists space_id uuid;
do $$ begin
 if not exists (select 1 from pg_constraint where conname='demo_photos_space') then
  alter table public.demo_photos add constraint demo_photos_space
   foreign key (space_id, property_id) references public.property_spaces(id, property_id) on delete set null (space_id);
 end if;
end $$;
create index if not exists demo_photos_space on public.demo_photos(space_id) where space_id is not null;

alter table public.property_spaces enable row level security;
revoke all on public.property_spaces from public, anon, authenticated;
grant all on public.property_spaces to service_role;
grant select on public.property_spaces to authenticated;
drop policy if exists member_read on public.property_spaces;
create policy member_read on public.property_spaces for select to authenticated
 using (exists (select 1 from public.demo_properties pr where pr.id = property_id and public.habita_is_member(pr.agency_id)));

-- One grant per request key. The same key again returns what it did.
create table if not exists public.agency_credit_requests (
 request_key uuid primary key,
 agency_id uuid not null references public.agencies(id) on delete cascade,
 actor_id uuid,
 photos integer not null,
 reason text not null,
 result jsonb not null,
 created_at timestamptz not null default now()
);
alter table public.agency_credit_requests enable row level security;
revoke all on public.agency_credit_requests from public, anon, authenticated;
grant all on public.agency_credit_requests to service_role;

create or replace function public.habita_agency_credit_once(p_key uuid, p_actor uuid, p_agency uuid, p_photos integer, p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r agency_credit_requests; res jsonb;
begin
 if p_key is null then raise exception 'INVALID_ADJUSTMENT'; end if;
 -- Serializes the same key: a second call waits for the first and reads its result.
 perform pg_advisory_xact_lock(hashtextextended(p_key::text, 0));
 select * into r from agency_credit_requests where request_key = p_key;
 if found then
  if r.agency_id <> p_agency or r.photos <> p_photos then raise exception 'KEY_REUSED'; end if;
  return r.result || jsonb_build_object('replay', true);
 end if;
 res := habita_agency_credit(p_actor, p_agency, p_photos, p_reason);
 insert into agency_credit_requests(request_key, agency_id, actor_id, photos, reason, result)
  values (p_key, p_agency, p_actor, p_photos, p_reason, res);
 return res || jsonb_build_object('replay', false);
end $$;

-- Available (the owner's balance, as amobla_account counts it) and reserved credits of some agencies.
create or replace function public.habita_admin_agency_balances(p_agencies uuid[])
returns table(agency_id uuid, available integer, reserved integer)
language plpgsql security definer set search_path=public as $$
declare a record;
begin
 for a in select ag.id, ag.owner_id, ag.free_credits_pending from agencies ag where ag.id = any(p_agencies) loop
  agency_id := a.id;
  reserved := coalesce(a.free_credits_pending, 0);
  available := null;
  if a.owner_id is not null then
   perform amobla_refresh_annual(a.owner_id);
   select coalesce(sum(remaining), 0)::integer into available from credit_grants
    where user_id = a.owner_id and not revoked and source_key not like 'trial:%'
     and starts_at <= now() and (expires_at is null or expires_at > now());
  end if;
  return next;
 end loop;
end $$;

revoke all on function public.habita_agency_credit_once(uuid,uuid,uuid,integer,text) from public, anon, authenticated;
grant execute on function public.habita_agency_credit_once(uuid,uuid,uuid,integer,text) to service_role;
revoke all on function public.habita_admin_agency_balances(uuid[]) from public, anon, authenticated;
grant execute on function public.habita_admin_agency_balances(uuid[]) to service_role;
commit;
