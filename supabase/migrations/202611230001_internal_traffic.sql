-- Exclusión integral del tráfico interno. See docs/TRAFICO_INTERNO.md.
--
-- * internal_people / internal_identities: el registro central del equipo.
--   Una persona interna (admin, colaborador o cuenta de prueba) puede tener
--   varios Gmail y su id estable de usuario. Solo lo lee y escribe el
--   servidor (service_role): la lista de correos nunca llega al navegador.
-- * internal_devices: navegadores clasificados. Un dispositivo se marca al
--   iniciar sesión con una cuenta interna, con un enlace de un solo uso
--   (celulares, incógnito, otro perfil) o por la reclasificación histórica.
--   Guarda sus alias (habita_visitante y $device_id de PostHog) para que
--   todo lo que hizo ese navegador quede fuera de las métricas.
--   status: 'internal' excluye; 'unknown' no se pudo atribuir con
--   confianza (se muestra para revisar, no se excluye); 'external' lo
--   confirmó el equipo; 'revoked' dejó de ser interno (otra cuenta inició
--   sesión, o el equipo lo revocó): sus eventos ya marcados siguen siéndolo,
--   lo que haga después cuenta.
-- * internal_device_links: enlaces de un solo uso para marcar otro dispositivo.
-- * internal_fingerprints: huella hasheada (IP + navegador + pantalla + zona
--   horaria) de las sesiones del equipo, para reconocer una ventana incógnita
--   del mismo dispositivo en la misma red. Nunca la IP sola.
-- * internal_visitor_ids / habita_internal_user_ids(): la definición única de
--   "interno" que usan los reportes (actividad de demos, pagos, cuentas).
-- * demo_activity gana is_internal: el equipo se registra (para QA) pero el
--   resumen de cada demo (activity_*) solo cuenta lo externo, y se puede
--   recalcular entero sin tocar las filas originales.
--
-- Aditiva e idempotente: no borra ni modifica eventos; se puede re-ejecutar.
begin;

create table if not exists public.internal_people (
 id uuid primary key default gen_random_uuid(),
 label text not null check (length(btrim(label)) between 1 and 80),
 role text not null default 'collaborator' check (role in ('admin','collaborator','test')),
 active boolean not null default true,
 note text check (note is null or length(note) <= 200),
 created_by uuid,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

create table if not exists public.internal_identities (
 id uuid primary key default gen_random_uuid(),
 person_id uuid not null references public.internal_people(id) on delete cascade,
 kind text not null check (kind in ('email','user_id')),
 value text not null check (length(value) between 3 and 200),
 created_by uuid,
 created_at timestamptz not null default now(),
 unique (kind, value)
);
create index if not exists internal_identities_person on public.internal_identities(person_id);

create table if not exists public.internal_devices (
 id uuid primary key default gen_random_uuid(),
 person_id uuid references public.internal_people(id) on delete set null,
 status text not null default 'internal' check (status in ('internal','unknown','external','revoked')),
 source text not null check (source in ('login','link','manual','backfill','fingerprint')),
 visitor_ids text[] not null default '{}',
 ph_device_ids text[] not null default '{}',
 label text check (label is null or length(label) <= 120),
 evidence text check (evidence is null or length(evidence) <= 300),
 first_seen_at timestamptz not null default now(),
 last_seen_at timestamptz not null default now(),
 status_at timestamptz not null default now(),
 status_by uuid,
 status_reason text check (status_reason is null or length(status_reason) <= 60)
);
create index if not exists internal_devices_visitors on public.internal_devices using gin(visitor_ids);
create index if not exists internal_devices_ph on public.internal_devices using gin(ph_device_ids);

create table if not exists public.internal_device_links (
 token_hash text primary key check (length(token_hash) = 64),
 person_id uuid not null references public.internal_people(id) on delete cascade,
 created_by uuid,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 used_at timestamptz,
 device_id uuid references public.internal_devices(id) on delete set null
);

-- The team's network + device fingerprints (hashed with a server secret: no IP
-- is stored in clear). A private window (no cookies) on the same computer or
-- phone, on the same network, is recognized by its exact match while it lasts.
create table if not exists public.internal_fingerprints (
 hash text primary key check (length(hash) = 64),
 person_id uuid references public.internal_people(id) on delete cascade,
 device_id uuid references public.internal_devices(id) on delete set null,
 label text check (label is null or length(label) <= 120),
 first_seen_at timestamptz not null default now(),
 last_seen_at timestamptz not null default now(),
 expires_at timestamptz not null,
 matches integer not null default 0
);
create index if not exists internal_fingerprints_expiry on public.internal_fingerprints(expires_at);
alter table public.internal_fingerprints enable row level security;
revoke all on public.internal_fingerprints from anon, authenticated;

alter table public.demo_activity add column if not exists is_internal boolean not null default false;
alter table public.demo_activity add column if not exists internal_reason text;
do $$ begin
 if not exists (select 1 from pg_constraint where conname='demo_activity_internal_reason_len') then
  alter table public.demo_activity add constraint demo_activity_internal_reason_len check (internal_reason is null or length(internal_reason) <= 40);
 end if;
end $$;

alter table public.internal_people enable row level security;
alter table public.internal_identities enable row level security;
alter table public.internal_devices enable row level security;
alter table public.internal_device_links enable row level security;
revoke all on public.internal_people from anon, authenticated;
revoke all on public.internal_identities from anon, authenticated;
revoke all on public.internal_devices from anon, authenticated;
revoke all on public.internal_device_links from anon, authenticated;

-- Every browser id that belongs to the team: marked by hand in the lead panel,
-- or the aliases of a device classified internal ("ph:<device>" for PostHog's).
create or replace view public.internal_visitor_ids as
 select visitor_id from public.lead_internal_visitors
 union
 select unnest(visitor_ids) from public.internal_devices where status = 'internal'
 union
 select 'ph:' || unnest(ph_device_ids) from public.internal_devices where status = 'internal'
 union
 -- The same browser seen by the lead events (habita_visitante next to its PostHog device).
 select e.visitor_id from public.lead_events e
  join public.internal_devices d on d.status = 'internal' and e.ph_device_id = any(d.ph_device_ids);
revoke all on public.internal_visitor_ids from anon, authenticated;

-- The accounts of the team: the ids in the registry and the accounts whose
-- e-mail is registered (active people only). plpgsql so it is only resolved
-- when called (auth.users is Supabase's).
create or replace function public.habita_internal_user_ids() returns setof uuid language plpgsql stable security definer set search_path=public as $$
begin
 return query
  select i.value::uuid from internal_identities i join internal_people p on p.id = i.person_id
   where p.active and i.kind = 'user_id' and i.value ~ '^[0-9a-f-]{36}$'
  union
  select u.id from auth.users u join internal_identities i on i.kind = 'email' and lower(u.email) = i.value
   join internal_people p on p.id = i.person_id where p.active;
end $$;
revoke all on function public.habita_internal_user_ids() from public, anon, authenticated;
grant execute on function public.habita_internal_user_ids() to service_role;

-- The demos' activity that counts commercially: not flagged at the time, not
-- from a team browser, and not the account step of an agency the team owns.
create or replace view public.demo_activity_commercial as
 select a.* from public.demo_activity a
 where not a.is_internal
  and a.visitor not in (select visitor_id from public.internal_visitor_ids)
  and not (a.visitor = 'cuenta' and exists (
   select 1 from public.demos d join public.agencies g on g.id = d.agency_id
   where d.id = a.demo_id and g.owner_id in (select public.habita_internal_user_ids())));
revoke all on public.demo_activity_commercial from anon, authenticated;

-- Payments that count as revenue: never the team's test purchases.
create or replace view public.payments_commercial as
 select p.* from public.payments p where p.user_id not in (select public.habita_internal_user_ids());
revoke all on public.payments_commercial from anon, authenticated;

-- Records one step. Internal steps are stored (QA) and never move the summary
-- (a visit of the team does not mark the demo as sent either).
drop function if exists public.habita_record_demo_activity(uuid, text, text);
create or replace function public.habita_record_demo_activity(p_demo uuid, p_visitor text, p_kind text, p_internal boolean default false, p_reason text default null) returns void language plpgsql security definer set search_path=public as $$
declare lvl smallint;
begin
 lvl := case p_kind when 'visita' then 1 when 'interaccion' then 2 when 'descarga' then 2 when 'generacion' then 3 when 'panel' then 4 when 'compra' then 5 end;
 if lvl is null or p_visitor is null or length(btrim(p_visitor)) not between 1 and 80 then raise exception 'INVALID_ACTIVITY'; end if;
 insert into demo_activity(demo_id, visitor, kind, level, is_internal, internal_reason)
  values(p_demo, p_visitor, p_kind, lvl, coalesce(p_internal,false), case when p_internal then left(coalesce(p_reason,'internal'),40) end)
  on conflict (demo_id, visitor, kind) do nothing;
 if not found or coalesce(p_internal,false) then return; end if;
 if p_visitor in (select visitor_id from internal_visitor_ids) then return; end if;
 update demos set
  activity_level = greatest(activity_level, lvl),
  activity_at = now(),
  activity_visitors = activity_visitors + (case when p_kind = 'visita' then 1 else 0 end),
  -- As in 202611130001_demo_sent_stage: an external visit proves the demo was sent.
  sent_at = case when p_kind = 'visita' then coalesce(sent_at, now()) else sent_at end
 where id = p_demo;
end $$;

drop function if exists public.habita_record_agency_activity(uuid);
create or replace function public.habita_record_agency_activity(p_agency uuid, p_internal boolean default false) returns void language plpgsql security definer set search_path=public as $$
declare d uuid;
begin
 for d in select id from demos where agency_id = p_agency loop
  perform habita_record_demo_activity(d, 'cuenta', 'panel', p_internal, case when p_internal then 'internal_account' end);
 end loop;
end $$;

drop function if exists public.habita_record_agency_purchase(uuid);
create or replace function public.habita_record_agency_purchase(p_agency uuid, p_internal boolean default false) returns void language plpgsql security definer set search_path=public as $$
declare d uuid;
begin
 for d in select id from demos where agency_id = p_agency loop
  perform habita_record_demo_activity(d, 'cuenta', 'compra', p_internal, case when p_internal then 'internal_account' end);
 end loop;
end $$;

-- Rebuilds the summary of one demo (or all) from its commercial activity.
-- The rows of demo_activity are never changed: only the derived columns.
create or replace function public.habita_recompute_demo_activity(p_demo uuid default null) returns integer language plpgsql security definer set search_path=public as $$
declare changed integer;
begin
 update demos d set
  activity_level = coalesce(s.lvl, 0),
  activity_visitors = coalesce(s.visitors, 0),
  activity_at = s.at
 from (
  select x.id, max(c.level) as lvl, count(*) filter (where c.kind = 'visita') as visitors, max(c.created_at) as at
  from demos x left join demo_activity_commercial c on c.demo_id = x.id
  where p_demo is null or x.id = p_demo
  group by x.id
 ) s
 where d.id = s.id and (d.activity_level is distinct from coalesce(s.lvl,0) or d.activity_visitors is distinct from coalesce(s.visitors,0) or d.activity_at is distinct from s.at);
 get diagnostics changed = row_count;
 return changed;
end $$;

revoke all on function public.habita_record_demo_activity(uuid, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.habita_record_demo_activity(uuid, text, text, boolean, text) to service_role;
revoke all on function public.habita_record_agency_activity(uuid, boolean) from public, anon, authenticated;
grant execute on function public.habita_record_agency_activity(uuid, boolean) to service_role;
revoke all on function public.habita_record_agency_purchase(uuid, boolean) from public, anon, authenticated;
grant execute on function public.habita_record_agency_purchase(uuid, boolean) to service_role;
revoke all on function public.habita_recompute_demo_activity(uuid) from public, anon, authenticated;
grant execute on function public.habita_recompute_demo_activity(uuid) to service_role;

-- The three team accounts known today (editable afterwards from /admin/internos).
insert into internal_people(id, label, role, note)
values ('00000000-0000-4000-a000-000000000001', 'Equipo Habita', 'admin', 'Alta inicial: las tres cuentas del equipo. Separarlas por persona desde /admin/internos si hace falta.')
on conflict (id) do nothing;
insert into internal_identities(person_id, kind, value) values
 ('00000000-0000-4000-a000-000000000001', 'email', 'facundogregorini@gmail.com'),
 ('00000000-0000-4000-a000-000000000001', 'email', 'descstartups@gmail.com'),
 ('00000000-0000-4000-a000-000000000001', 'email', 'growthlabs86@gmail.com')
on conflict (kind, value) do nothing;

commit;
