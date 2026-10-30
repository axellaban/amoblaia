-- Users of an agency: the owner (or an administrator) creates accesses for
-- its employees from the panel ("Usuarios"), with a role and, if wanted,
-- only some of its properties.
--
-- * agency_members.role: owner (one per agency, the account that pays),
--   admin (everything but buying credits: site, users, deleting), editor
--   (creates, edits, stages and publishes properties) and viewer (only
--   looks). The old 'collaborator' becomes 'editor'.
-- * agency_members.property_ids: null sees every property of the agency;
--   a list limits an editor or a viewer to those properties
--   (demo_properties.id). Owners and administrators always see everything.
-- * agency_invites: the access before it is used. Its one-time link is
--   stored only as a hash; it names the e-mail that may use it, the role and
--   the properties. Regenerating the link replaces the hash; revoking or
--   using it closes it.
-- * habita_join_agency: uses an invite, atomically (one agency per account).
-- Writes still go only through the server (service_role).
-- Additive and idempotent.
begin;

alter table public.agency_members drop constraint if exists agency_members_role_check;
update public.agency_members set role='editor' where role='collaborator';
alter table public.agency_members add constraint agency_members_role_check check (role in ('owner','admin','editor','viewer'));
alter table public.agency_members add column if not exists property_ids uuid[];
alter table public.agency_members add column if not exists display_name text;
alter table public.agency_members add column if not exists invited_by uuid references public.profiles(id) on delete set null;
do $$ begin
 if not exists (select 1 from pg_constraint where conname='agency_members_scope') then
  alter table public.agency_members add constraint agency_members_scope check (property_ids is null or role in ('editor','viewer'));
 end if;
 if not exists (select 1 from pg_constraint where conname='agency_members_display_name') then
  alter table public.agency_members add constraint agency_members_display_name check (display_name is null or length(display_name) between 1 and 80);
 end if;
end $$;

create table if not exists public.agency_invites (
 id uuid primary key default gen_random_uuid(),
 agency_id uuid not null references public.agencies(id) on delete cascade,
 email text not null check(email = lower(email) and length(email) between 3 and 200),
 display_name text check(display_name is null or length(display_name) between 1 and 80),
 role text not null check(role in ('admin','editor','viewer')),
 property_ids uuid[],
 code_hash text not null unique check(code_hash ~ '^[0-9a-f]{64}$'),
 created_by uuid references public.profiles(id) on delete set null,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 used_by uuid references public.profiles(id) on delete set null,
 used_at timestamptz,
 revoked_at timestamptz,
 check (property_ids is null or role in ('editor','viewer'))
);
create index if not exists agency_invites_agency on public.agency_invites(agency_id,created_at desc);
-- One open access per e-mail and agency: a new one replaces the previous.
create unique index if not exists agency_invites_open on public.agency_invites(agency_id,email) where used_at is null and revoked_at is null;

-- Uses an invite: the account must be the invited e-mail's and not work for
-- any agency yet. Only properties still of that agency are kept.
create or replace function public.habita_join_agency(p_user uuid,p_email text,p_code_hash text) returns uuid language plpgsql security definer set search_path=public as $$
declare i agency_invites; scope uuid[];
begin
 insert into profiles(id) values(p_user) on conflict do nothing;
 perform 1 from profiles where id=p_user for update;
 if (select blocked from profiles where id=p_user) then raise exception 'ACCOUNT_BLOCKED'; end if;
 select * into i from agency_invites where code_hash=p_code_hash for update;
 if not found or i.used_at is not null or i.revoked_at is not null or i.expires_at<=now() then raise exception 'INVITE_INVALID'; end if;
 if lower(coalesce(p_email,''))<>i.email then raise exception 'INVITE_EMAIL'; end if;
 if exists(select 1 from agency_members where user_id=p_user) then raise exception 'AGENCY_EXISTS'; end if;
 if i.property_ids is not null then
  select coalesce(array_agg(id),'{}') into scope from demo_properties where agency_id=i.agency_id and id=any(i.property_ids);
 end if;
 insert into agency_members(agency_id,user_id,role,property_ids,display_name,invited_by)
  values(i.agency_id,p_user,i.role,scope,i.display_name,i.created_by);
 update agency_invites set used_by=p_user,used_at=now() where id=i.id;
 return i.agency_id;
end $$;

alter table public.agency_invites enable row level security;
revoke all on public.agency_invites from public,anon,authenticated;
grant all on public.agency_invites to service_role;
revoke all on function public.habita_join_agency(uuid,text,text) from public,anon,authenticated;
grant execute on function public.habita_join_agency(uuid,text,text) to service_role;
commit;
