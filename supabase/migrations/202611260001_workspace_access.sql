-- Equipo y accesos: administración principal, solicitudes de acceso y
-- transferencias de la administración (docs/EQUIPO_Y_ACCESOS.md).
--
-- * agencies.principal_id: el administrador principal del espacio. Hasta hoy
--   era siempre la cuenta dueña (owner_id); se completa con ella y, desde
--   ahora, un trigger lo completa cuando una inmobiliaria recibe su dueño.
--   owner_id NO cambia con una transferencia: sigue siendo la cuenta cuyos
--   créditos pagan las ambientaciones (las fotos, los créditos y las
--   suscripciones están a su nombre), así que transferir la administración
--   nunca mueve el saldo ni rompe la generación.
-- * agency_access_requests: alguien con sesión pide entrar a un espacio que
--   ya existe (Journey C). Una pendiente por persona y espacio; un
--   administrador la aprueba (entra como Miembro, rol 'editor') o la rechaza.
-- * agency_admin_transfers: un integrante pide la administración principal
--   (Journey D). La aprueba el administrador principal actual o, si no
--   responde, el equipo de habita tras verificar la titularidad. Aprobar es
--   atómico y bloquea la fila de la inmobiliaria: dos aprobaciones
--   simultáneas no pueden dejar dos principales.
-- * Todas las escrituras pasan por el servidor (service_role) y quedan en
--   admin_audit.
-- Aditiva e idempotente: no borra ni reasigna nada; ningún rol existente cambia.
begin;

alter table public.agencies add column if not exists principal_id uuid references public.profiles(id) on delete set null;
update public.agencies set principal_id = owner_id where principal_id is null and owner_id is not null;

-- When an agency gets its owner (claim, creation), that account is also its principal administrator.
create or replace function public.habita_default_principal() returns trigger language plpgsql set search_path=public as $$
begin
 if new.owner_id is not null and new.principal_id is null then new.principal_id := new.owner_id; end if;
 return new;
end $$;
drop trigger if exists habita_default_principal on public.agencies;
create trigger habita_default_principal before insert or update of owner_id, principal_id on public.agencies
 for each row execute function public.habita_default_principal();

create table if not exists public.agency_access_requests (
 id uuid primary key default gen_random_uuid(),
 agency_id uuid not null references public.agencies(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 email text check (email is null or (email = lower(email) and length(email) between 3 and 200)),
 source text not null default 'panel' check (source in ('demo','link','invitation','panel')),
 demo_id uuid references public.demos(id) on delete set null,
 status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
 created_at timestamptz not null default now(),
 resolved_at timestamptz,
 resolved_by uuid references public.profiles(id) on delete set null
);
create unique index if not exists agency_access_requests_open on public.agency_access_requests(agency_id,user_id) where status='pending';
create index if not exists agency_access_requests_agency on public.agency_access_requests(agency_id,created_at desc);

create table if not exists public.agency_admin_transfers (
 id uuid primary key default gen_random_uuid(),
 agency_id uuid not null references public.agencies(id) on delete cascade,
 requester_id uuid not null references public.profiles(id) on delete cascade,
 current_principal_id uuid references public.profiles(id) on delete set null,
 status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled','superseded')),
 created_at timestamptz not null default now(),
 resolved_at timestamptz,
 resolved_by uuid references public.profiles(id) on delete set null,
 resolution text check (resolution is null or resolution in ('principal','support','direct'))
);
create unique index if not exists agency_admin_transfers_open on public.agency_admin_transfers(agency_id,requester_id) where status='pending';
create index if not exists agency_admin_transfers_agency on public.agency_admin_transfers(agency_id,created_at desc);

-- The principal administrator of an agency: its principal, else its owner (agencies claimed before this migration ran twice, or whose principal's account was deleted).
create or replace function public.habita_principal(p_agency uuid) returns uuid language sql stable security definer set search_path=public as $$
 select coalesce(
  (select a.principal_id from agencies a join agency_members m on m.agency_id=a.id and m.user_id=a.principal_id where a.id=p_agency),
  (select owner_id from agencies where id=p_agency))
$$;

-- Asks to join an agency that already has its space. The same pending request
-- is answered again (never a duplicate); at most 5 open requests per account.
create or replace function public.habita_request_access(p_user uuid,p_agency uuid,p_email text,p_source text,p_demo uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare r agency_access_requests; existing uuid;
begin
 insert into profiles(id) values(p_user) on conflict do nothing;
 perform 1 from profiles where id=p_user for update;
 if (select blocked from profiles where id=p_user) then raise exception 'ACCOUNT_BLOCKED'; end if;
 if not exists(select 1 from agencies where id=p_agency) then raise exception 'AGENCY_NOT_FOUND'; end if;
 if exists(select 1 from agency_members where agency_id=p_agency and user_id=p_user) then raise exception 'ALREADY_MEMBER'; end if;
 if exists(select 1 from agency_members where user_id=p_user) then raise exception 'AGENCY_EXISTS'; end if;
 select * into r from agency_access_requests where agency_id=p_agency and user_id=p_user and status='pending';
 if found then return jsonb_build_object('id',r.id,'created',false,'createdAt',r.created_at); end if;
 if (select count(*) from agency_access_requests where user_id=p_user and status='pending')>=5 then raise exception 'TOO_MANY_REQUESTS'; end if;
 insert into agency_access_requests(agency_id,user_id,email,source,demo_id)
  values(p_agency,p_user,nullif(lower(btrim(coalesce(p_email,''))),''),coalesce(p_source,'panel'),p_demo)
  returning * into r;
 insert into admin_audit(actor_id,action,subject_id,details)
  values(p_user,'agency_access_requested',p_agency::text,jsonb_build_object('request',r.id,'source',r.source));
 return jsonb_build_object('id',r.id,'created',true,'createdAt',r.created_at);
end $$;

-- An administrator (owner or admin) approves or rejects a request. Approved,
-- the account joins as a member (role 'editor'), atomically.
create or replace function public.habita_resolve_access_request(p_actor uuid,p_agency uuid,p_request uuid,p_approve boolean) returns text language plpgsql security definer set search_path=public as $$
declare r agency_access_requests;
begin
 if not exists(select 1 from agency_members where agency_id=p_agency and user_id=p_actor and role in ('owner','admin')) then raise exception 'NOT_ADMIN'; end if;
 select * into r from agency_access_requests where id=p_request and agency_id=p_agency for update;
 if not found then raise exception 'REQUEST_NOT_FOUND'; end if;
 if r.status<>'pending' then raise exception 'REQUEST_CLOSED'; end if;
 if p_approve then
  perform 1 from profiles where id=r.user_id for update;
  if (select blocked from profiles where id=r.user_id) then raise exception 'ACCOUNT_BLOCKED'; end if;
  if exists(select 1 from agency_members where user_id=r.user_id) then raise exception 'AGENCY_EXISTS'; end if;
  insert into agency_members(agency_id,user_id,role,invited_by) values(p_agency,r.user_id,'editor',p_actor);
  -- Any invitation still open for the same e-mail is no longer needed.
  if r.email is not null then
   update agency_invites set revoked_at=now() where agency_id=p_agency and email=r.email and used_at is null and revoked_at is null;
  end if;
 end if;
 update agency_access_requests set status=case when p_approve then 'approved' else 'rejected' end,resolved_at=now(),resolved_by=p_actor where id=r.id;
 insert into admin_audit(actor_id,action,subject_id,details)
  values(p_actor,case when p_approve then 'agency_access_approved' else 'agency_access_rejected' end,p_agency::text,jsonb_build_object('request',r.id,'user',r.user_id));
 return case when p_approve then 'approved' else 'rejected' end;
end $$;

-- A member asks to become the principal administrator. The same pending
-- request is answered again; the principal itself cannot ask.
create or replace function public.habita_request_admin_transfer(p_user uuid,p_agency uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare t agency_admin_transfers; principal uuid;
begin
 if not exists(select 1 from agency_members where agency_id=p_agency and user_id=p_user) then raise exception 'NOT_MEMBER'; end if;
 principal:=habita_principal(p_agency);
 if principal=p_user then raise exception 'ALREADY_PRINCIPAL'; end if;
 select * into t from agency_admin_transfers where agency_id=p_agency and requester_id=p_user and status='pending';
 if found then return jsonb_build_object('id',t.id,'created',false,'createdAt',t.created_at); end if;
 insert into agency_admin_transfers(agency_id,requester_id,current_principal_id) values(p_agency,p_user,principal) returning * into t;
 insert into admin_audit(actor_id,action,subject_id,details)
  values(p_user,'agency_admin_transfer_requested',p_agency::text,jsonb_build_object('transfer',t.id,'principal',principal));
 return jsonb_build_object('id',t.id,'created',true,'createdAt',t.created_at);
end $$;

-- Makes p_target the principal administrator, atomically (the agency's row
-- is locked). The new principal becomes an administrator if it was not; the
-- previous one keeps its role (it stays administrator). Nothing else moves:
-- the owner account, the credits, the properties and the demos stay.
create or replace function public.habita_set_principal(p_actor uuid,p_agency uuid,p_target uuid,p_transfer uuid,p_resolution text) returns uuid language plpgsql security definer set search_path=public as $$
declare a agencies; previous uuid;
begin
 select * into a from agencies where id=p_agency for update;
 if not found then raise exception 'AGENCY_NOT_FOUND'; end if;
 previous:=habita_principal(p_agency);
 if not exists(select 1 from agency_members where agency_id=p_agency and user_id=p_target) then raise exception 'NOT_MEMBER'; end if;
 if previous=p_target then raise exception 'ALREADY_PRINCIPAL'; end if;
 update agency_members set role='admin',property_ids=null where agency_id=p_agency and user_id=p_target and role in ('editor','viewer','collaborator');
 update agencies set principal_id=p_target where id=p_agency;
 if p_transfer is not null then
  update agency_admin_transfers set status='approved',resolved_at=now(),resolved_by=p_actor,resolution=p_resolution where id=p_transfer;
 end if;
 -- The other open requests were addressed to the previous principal.
 update agency_admin_transfers set status='superseded',resolved_at=now(),resolved_by=p_actor
  where agency_id=p_agency and status='pending' and id is distinct from p_transfer;
 insert into admin_audit(actor_id,action,subject_id,details)
  values(p_actor,'agency_admin_transfer_completed',p_agency::text,jsonb_build_object('transfer',p_transfer,'from',previous,'to',p_target,'resolution',p_resolution));
 return p_target;
end $$;

-- The principal administrator (or, with p_support, the team after verifying
-- the ownership) approves or rejects a transfer request.
create or replace function public.habita_resolve_admin_transfer(p_actor uuid,p_agency uuid,p_transfer uuid,p_approve boolean,p_support boolean default false) returns text language plpgsql security definer set search_path=public as $$
declare t agency_admin_transfers;
begin
 -- The agency first, then the request: the same order as habita_set_principal, so concurrent approvals queue up.
 perform 1 from agencies where id=p_agency for update;
 if not found then raise exception 'AGENCY_NOT_FOUND'; end if;
 select * into t from agency_admin_transfers where id=p_transfer and agency_id=p_agency for update;
 if not found then raise exception 'TRANSFER_NOT_FOUND'; end if;
 if t.status<>'pending' then raise exception 'TRANSFER_CLOSED'; end if;
 if not p_support and habita_principal(p_agency) is distinct from p_actor then raise exception 'NOT_PRINCIPAL'; end if;
 if not p_approve then
  update agency_admin_transfers set status='rejected',resolved_at=now(),resolved_by=p_actor,resolution=case when p_support then 'support' else 'principal' end where id=t.id;
  insert into admin_audit(actor_id,action,subject_id,details)
   values(p_actor,'agency_admin_transfer_rejected',p_agency::text,jsonb_build_object('transfer',t.id,'support',p_support));
  return 'rejected';
 end if;
 perform habita_set_principal(p_actor,p_agency,t.requester_id,t.id,case when p_support then 'support' else 'principal' end);
 return 'approved';
end $$;

-- The principal hands the role to another member directly ("Transferir").
create or replace function public.habita_transfer_principal(p_actor uuid,p_agency uuid,p_target uuid) returns uuid language plpgsql security definer set search_path=public as $$
begin
 perform 1 from agencies where id=p_agency for update;
 if habita_principal(p_agency) is distinct from p_actor then raise exception 'NOT_PRINCIPAL'; end if;
 return habita_set_principal(p_actor,p_agency,p_target,null,'direct');
end $$;

do $$ declare t text; begin
 foreach t in array array['agency_access_requests','agency_admin_transfers'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;

-- Browsers may read who is the principal of their own agency (member_read policy of 202610280001).
grant select(principal_id) on public.agencies to authenticated;

revoke all on function public.habita_default_principal() from public,anon,authenticated;
revoke all on function public.habita_principal(uuid) from public,anon,authenticated;
revoke all on function public.habita_request_access(uuid,uuid,text,text,uuid) from public,anon,authenticated;
revoke all on function public.habita_resolve_access_request(uuid,uuid,uuid,boolean) from public,anon,authenticated;
revoke all on function public.habita_request_admin_transfer(uuid,uuid) from public,anon,authenticated;
revoke all on function public.habita_set_principal(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.habita_resolve_admin_transfer(uuid,uuid,uuid,boolean,boolean) from public,anon,authenticated;
revoke all on function public.habita_transfer_principal(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.habita_principal(uuid) to service_role;
grant execute on function public.habita_request_access(uuid,uuid,text,text,uuid) to service_role;
grant execute on function public.habita_resolve_access_request(uuid,uuid,uuid,boolean) to service_role;
grant execute on function public.habita_request_admin_transfer(uuid,uuid) to service_role;
grant execute on function public.habita_set_principal(uuid,uuid,uuid,uuid,text) to service_role;
grant execute on function public.habita_resolve_admin_transfer(uuid,uuid,uuid,boolean,boolean) to service_role;
grant execute on function public.habita_transfer_principal(uuid,uuid,uuid) to service_role;
commit;
