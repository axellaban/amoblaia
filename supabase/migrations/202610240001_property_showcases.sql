-- Fichas de propiedad compartibles: estado actual + propuestas de ambientación revisadas.
-- Se puede re-ejecutar. Todas las mutaciones pasan por RPC reservadas al servidor;
-- el público nunca lee estas tablas: el servidor consulta amobla_public_showcase().
begin;

-- Revisión del agente antes de compartir. Descartar oculta la propuesta, no devuelve fotos
-- ni cambia los límites de variantes (las reglas de créditos quedan como estaban).
alter table public.generations add column if not exists reviewed_at timestamptz;
alter table public.generations add column if not exists discarded_at timestamptz;

create table if not exists public.showcases (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id),
 token text not null unique check (token ~ '^[A-Za-z0-9_-]{24,64}$'),
 title text not null check (length(trim(title)) between 1 and 120),
 agency_name text check (agency_name is null or length(trim(agency_name)) between 1 and 80),
 agency_logo_path text,
 whatsapp text check (whatsapp is null or whatsapp ~ '^[0-9]{10,15}$'),
 active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 deleted_at timestamptz
);
create index if not exists showcases_user on public.showcases(user_id, created_at desc) where deleted_at is null;

create table if not exists public.showcase_rooms (
 id uuid primary key default gen_random_uuid(),
 showcase_id uuid not null references public.showcases(id) on delete cascade,
 user_id uuid not null references public.profiles(id),
 project_id uuid not null references public.projects(id) on delete cascade,
 label text not null check (length(trim(label)) between 1 and 60),
 position integer not null default 0,
 unique (showcase_id, project_id)
);
create index if not exists showcase_rooms_project on public.showcase_rooms(project_id);

alter table public.showcases enable row level security;
alter table public.showcase_rooms enable row level security;
revoke all on public.showcases from anon, authenticated;
revoke all on public.showcase_rooms from anon, authenticated;
grant select on public.showcases to authenticated;
grant select on public.showcase_rooms to authenticated;
grant all on public.showcases to service_role;
grant all on public.showcase_rooms to service_role;
drop policy if exists showcases_owner_read on public.showcases;
create policy showcases_owner_read on public.showcases for select to authenticated using (user_id = auth.uid());
drop policy if exists showcase_rooms_owner_read on public.showcase_rooms;
create policy showcase_rooms_owner_read on public.showcase_rooms for select to authenticated using (user_id = auth.uid());

-- review | unreview | discard, only on the owner's finished proposals.
create or replace function public.amobla_review_generation(p_user uuid, p_generation uuid, p_action text)
 returns void language plpgsql security definer set search_path = public as $$
declare g generations;
begin
 select * into g from generations where id = p_generation and user_id = p_user for update;
 if not found or not exists (select 1 from projects where id = g.project_id and user_id = p_user and deleted_at is null)
  then raise exception 'GENERATION_NOT_FOUND'; end if;
 if g.status <> 'succeeded' or g.result_path is null or g.discarded_at is not null then raise exception 'NOT_REVIEWABLE'; end if;
 if p_action = 'review' then
  -- Only furniture staging goes to a showcase; retouching, dusk and removal never do.
  if g.mode not in ('furnish', 'redesign') then raise exception 'NOT_REVIEWABLE'; end if;
  update generations set reviewed_at = now() where id = g.id;
 elsif p_action = 'unreview' then
  update generations set reviewed_at = null where id = g.id;
 elsif p_action = 'discard' then
  update generations set discarded_at = now(), reviewed_at = null where id = g.id;
 else raise exception 'BAD_ACTION'; end if;
end $$;

-- Replaces the rooms of a showcase atomically. p_rooms: [{"project_id": uuid, "label": text}]
create or replace function public.amobla_set_showcase_rooms(p_user uuid, p_showcase uuid, p_rooms jsonb)
 returns void language plpgsql security definer set search_path = public as $$
declare item jsonb; i integer := 0; pid uuid; lbl text;
begin
 perform 1 from showcases where id = p_showcase and user_id = p_user and deleted_at is null for update;
 if not found then raise exception 'SHOWCASE_NOT_FOUND'; end if;
 if jsonb_typeof(p_rooms) <> 'array' or jsonb_array_length(p_rooms) > 20 then raise exception 'TOO_MANY_ROOMS'; end if;
 delete from showcase_rooms where showcase_id = p_showcase;
 for item in select value from jsonb_array_elements(p_rooms) loop
  i := i + 1;
  begin
   pid := (item->>'project_id')::uuid;
  exception when others then raise exception 'PROJECT_NOT_FOUND';
  end;
  lbl := trim(coalesce(item->>'label', ''));
  if length(lbl) not between 1 and 60 then raise exception 'INVALID_ROOM_LABEL'; end if;
  if not exists (select 1 from projects where id = pid and user_id = p_user and deleted_at is null) then raise exception 'PROJECT_NOT_FOUND'; end if;
  if exists (select 1 from showcase_rooms where showcase_id = p_showcase and project_id = pid) then raise exception 'DUPLICATE_ROOM'; end if;
  insert into showcase_rooms(showcase_id, user_id, project_id, label, position) values (p_showcase, p_user, pid, lbl, i);
 end loop;
 update showcases set updated_at = now() where id = p_showcase;
end $$;

-- What a buyer may see: only an active showcase, its rooms whose photo is still in the
-- library, and proposals the agent reviewed. No owner id, emails, file names or paths.
create or replace function public.amobla_public_showcase(p_token text)
 returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s showcases;
begin
 select * into s from showcases where token = p_token and active and deleted_at is null;
 if not found then return null; end if;
 return jsonb_build_object(
  'id', s.id,
  'title', s.title,
  'agencyName', s.agency_name,
  'hasLogo', s.agency_logo_path is not null,
  'whatsapp', s.whatsapp,
  'rooms', coalesce((
   select jsonb_agg(jsonb_build_object(
     'id', r.id,
     'label', r.label,
     'proposals', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'style', g.style, 'mode', g.mode) order by g.created_at)
      from generations g
      where g.project_id = p.id and g.user_id = s.user_id and g.status = 'succeeded' and g.result_path is not null
       and g.reviewed_at is not null and g.discarded_at is null and g.mode in ('furnish', 'redesign')
     ), '[]'::jsonb)
    ) order by r.position)
   from showcase_rooms r
   join projects p on p.id = r.project_id and p.user_id = s.user_id and p.deleted_at is null and p.trashed_at is null
   where r.showcase_id = s.id
  ), '[]'::jsonb)
 );
end $$;

-- Storage path of one public image, or null. p_kind: logo | original (room id) | proposal (generation id).
create or replace function public.amobla_public_showcase_asset(p_token text, p_kind text, p_id uuid)
 returns text language plpgsql stable security definer set search_path = public as $$
declare s showcases; result text;
begin
 select * into s from showcases where token = p_token and active and deleted_at is null;
 if not found then return null; end if;
 if p_kind = 'logo' then return s.agency_logo_path; end if;
 if p_kind = 'original' then
  select p.original_path into result from showcase_rooms r
   join projects p on p.id = r.project_id and p.user_id = s.user_id and p.deleted_at is null and p.trashed_at is null
   where r.showcase_id = s.id and r.id = p_id;
  return result;
 end if;
 if p_kind = 'proposal' then
  select g.result_path into result from generations g
   join projects p on p.id = g.project_id and p.user_id = s.user_id and p.deleted_at is null and p.trashed_at is null
   join showcase_rooms r on r.project_id = p.id and r.showcase_id = s.id
   where g.id = p_id and g.user_id = s.user_id and g.status = 'succeeded' and g.reviewed_at is not null
    and g.discarded_at is null and g.mode in ('furnish', 'redesign');
  return result;
 end if;
 return null;
end $$;

revoke all on function public.amobla_review_generation(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.amobla_set_showcase_rooms(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.amobla_public_showcase(text) from public, anon, authenticated;
revoke all on function public.amobla_public_showcase_asset(text, text, uuid) from public, anon, authenticated;
grant execute on function public.amobla_review_generation(uuid, uuid, text) to service_role;
grant execute on function public.amobla_set_showcase_rooms(uuid, uuid, jsonb) to service_role;
grant execute on function public.amobla_public_showcase(text) to service_role;
grant execute on function public.amobla_public_showcase_asset(text, text, uuid) to service_role;
commit;
