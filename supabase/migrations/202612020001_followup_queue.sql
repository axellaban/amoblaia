-- Follow-up, Fase 1: cola de ejecución confiable (docs/FOLLOWUP.md).
--
-- 1. Acciones dentro de una etapa (`action`): la principal de la etapa y, en
--    «Contactado, no responde», la presentación y los precios, cada una con sus
--    versiones A/B. Las versiones existentes quedan como «principal».
-- 2. Situación de la conversación y nombre corto en followup_agencies. La
--    situación corregida a mano vale mientras el embudo siga en el mismo paso.
-- 3. followup_claims: una sesión toma una inmobiliaria por 10 minutos; otra no
--    puede tomarla mientras tanto. Al vencer, vuelve a la cola.
-- 4. followup_executions guarda la acción y el texto que salió.
--
-- Solo las usan las rutas del servidor (service role): RLS sin políticas.
-- Aditiva e idempotente. Para volver atrás: las columnas nuevas se pueden
-- borrar sin perder nada anterior (las versiones viejas siguen «principal»).
begin;

-- 1. Acciones -----------------------------------------------------------------
alter table public.followup_versions add column if not exists action text not null default 'principal'
  check (action in ('principal', 'presentacion', 'precios'));
alter table public.followup_versions drop constraint if exists followup_versions_stage_version_key;
create unique index if not exists followup_versions_stage_action_version on public.followup_versions (stage, action, version);
drop index if exists public.followup_versions_one_active;
drop index if exists public.followup_versions_one_test;
create unique index if not exists followup_versions_one_active_action on public.followup_versions (stage, action) where status = 'active';
create unique index if not exists followup_versions_one_test_action on public.followup_versions (stage, action) where status = 'test';

create or replace function public.habita_followup_version_frozen() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'FOLLOWUP_VERSION_FROZEN';
  end if;
  if new.stage is distinct from old.stage or new.action is distinct from old.action or new.version is distinct from old.version
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'FOLLOWUP_VERSION_FROZEN';
  end if;
  return new;
end $$;

drop function if exists public.habita_followup_create(uuid, text, text, text, text, text[], text);
create or replace function public.habita_followup_create(
  p_actor uuid, p_stage text, p_channel text, p_trigger text, p_body text, p_ctas text[], p_status text, p_action text default 'principal'
) returns public.followup_versions
language plpgsql as $$
declare
  v_next integer;
  v_row public.followup_versions;
begin
  if p_status not in ('active', 'test') then
    raise exception 'FOLLOWUP_INVALID_STATUS';
  end if;
  perform pg_advisory_xact_lock(hashtext('followup:' || p_stage || ':' || p_action));
  select coalesce(max(version), 0) + 1 into v_next from public.followup_versions where stage = p_stage and action = p_action;
  update public.followup_versions set status = 'archived', status_at = now() where stage = p_stage and action = p_action and status = p_status;
  insert into public.followup_versions (stage, action, version, channel, trigger_label, body, ctas, status, created_by)
  values (p_stage, p_action, v_next, p_channel, coalesce(btrim(p_trigger), ''), btrim(p_body), coalesce(p_ctas, '{}'), p_status, p_actor)
  returning * into v_row;
  return v_row;
end $$;

create or replace function public.habita_followup_set_status(p_version uuid, p_status text) returns public.followup_versions
language plpgsql as $$
declare
  v_row public.followup_versions;
begin
  if p_status not in ('active', 'test', 'archived') then
    raise exception 'FOLLOWUP_INVALID_STATUS';
  end if;
  select * into v_row from public.followup_versions where id = p_version;
  if not found then
    raise exception 'FOLLOWUP_VERSION_NOT_FOUND';
  end if;
  perform pg_advisory_xact_lock(hashtext('followup:' || v_row.stage || ':' || v_row.action));
  if v_row.status = p_status then
    return v_row;
  end if;
  if v_row.status = 'active' and p_status <> 'active' then
    raise exception 'FOLLOWUP_ACTIVE_REQUIRED';
  end if;
  if p_status <> 'archived' then
    update public.followup_versions set status = 'archived', status_at = now() where stage = v_row.stage and action = v_row.action and status = p_status;
  end if;
  update public.followup_versions set status = p_status, status_at = now() where id = p_version returning * into v_row;
  return v_row;
end $$;

-- 2. Situación y nombre corto ---------------------------------------------------
alter table public.followup_agencies add column if not exists situation text check (situation in (
  'sin_respuesta', 'confirmo_numero', 'interesado', 'neutro', 'pregunta_precios', 'mas_adelante', 'derivo',
  'rechazo', 'proveedor_ia', 'no_contactar', 'sin_whatsapp', 'numero_incorrecto'));
alter table public.followup_agencies add column if not exists situation_step integer check (situation_step between -1 and 8);
alter table public.followup_agencies add column if not exists situation_note text check (situation_note is null or length(situation_note) <= 2000);
alter table public.followup_agencies add column if not exists situation_at timestamptz;
alter table public.followup_agencies add column if not exists short_name text check (short_name is null or length(btrim(short_name)) between 1 and 80);

-- 3. Tomar una inmobiliaria -----------------------------------------------------
create table if not exists public.followup_claims (
  agency_id uuid primary key references public.agencies(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  actor_name text not null default '',
  stage text not null,
  action text not null,
  locked_until timestamptz not null,
  claimed_at timestamptz not null default now()
);
alter table public.followup_claims enable row level security;
revoke all on public.followup_claims from anon, authenticated;

-- La toma (o la renueva quien ya la tiene). Otra sesión no puede mientras no venza.
create or replace function public.habita_followup_claim(
  p_actor uuid, p_actor_name text, p_agency uuid, p_stage text, p_action text, p_seconds integer default 600
) returns public.followup_claims
language plpgsql as $$
declare
  v_row public.followup_claims;
begin
  insert into public.followup_claims (agency_id, actor_id, actor_name, stage, action, locked_until)
  values (p_agency, p_actor, coalesce(p_actor_name, ''), p_stage, p_action, now() + make_interval(secs => greatest(60, least(p_seconds, 3600))))
  on conflict (agency_id) do update
    set actor_id = excluded.actor_id, actor_name = excluded.actor_name, stage = excluded.stage, action = excluded.action,
        locked_until = excluded.locked_until,
        claimed_at = case when public.followup_claims.actor_id = excluded.actor_id then public.followup_claims.claimed_at else now() end
    where public.followup_claims.actor_id = excluded.actor_id or public.followup_claims.locked_until <= now()
  returning * into v_row;
  if v_row.agency_id is null then
    raise exception 'FOLLOWUP_LOCKED';
  end if;
  return v_row;
end $$;

-- La suelta (al confirmar, al marcar que no salió o al cerrar). Solo quien la tiene.
create or replace function public.habita_followup_release(p_actor uuid, p_agency uuid) returns void
language sql as $$
  delete from public.followup_claims where agency_id = p_agency and actor_id = p_actor;
$$;

-- 4. Acción y texto de cada ejecución --------------------------------------------
alter table public.followup_executions add column if not exists action text not null default 'principal';
alter table public.followup_executions add column if not exists body text check (body is null or length(body) <= 8000);

drop function if exists public.habita_followup_mark(uuid, uuid, uuid, integer, text, text);
create or replace function public.habita_followup_mark(
  p_actor uuid, p_version uuid, p_agency uuid, p_from_step integer, p_status text, p_reason text, p_body text default null
) returns public.followup_executions
language plpgsql as $$
declare
  v_stage text;
  v_action text;
  v_row public.followup_executions;
begin
  if p_status not in ('opened', 'sent', 'failed') then
    raise exception 'FOLLOWUP_INVALID_STATUS';
  end if;
  select stage, action into v_stage, v_action from public.followup_versions where id = p_version;
  if v_stage is null then
    raise exception 'FOLLOWUP_VERSION_NOT_FOUND';
  end if;
  insert into public.followup_executions (version_id, stage, action, agency_id, from_step, status, reason, actor_id, sent_at, body)
  values (p_version, v_stage, v_action, p_agency, p_from_step, p_status, nullif(btrim(coalesce(p_reason, '')), ''), p_actor,
          case when p_status = 'sent' then now() end, nullif(btrim(coalesce(p_body, '')), ''))
  on conflict (version_id, agency_id) do update
    set status = excluded.status,
        reason = excluded.reason,
        actor_id = excluded.actor_id,
        from_step = case when public.followup_executions.status = 'sent' then public.followup_executions.from_step else excluded.from_step end,
        sent_at = case when excluded.status = 'sent' then now() else public.followup_executions.sent_at end,
        body = coalesce(excluded.body, public.followup_executions.body),
        updated_at = now()
    where public.followup_executions.status <> 'sent'
  returning * into v_row;
  if v_row.id is null then
    select * into v_row from public.followup_executions where version_id = p_version and agency_id = p_agency;
  end if;
  return v_row;
end $$;

revoke all on function public.habita_followup_create(uuid, text, text, text, text, text[], text, text) from public, anon, authenticated;
revoke all on function public.habita_followup_set_status(uuid, text) from public, anon, authenticated;
revoke all on function public.habita_followup_mark(uuid, uuid, uuid, integer, text, text, text) from public, anon, authenticated;
revoke all on function public.habita_followup_claim(uuid, text, uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.habita_followup_release(uuid, uuid) from public, anon, authenticated;
grant execute on function public.habita_followup_create(uuid, text, text, text, text, text[], text, text) to service_role;
grant execute on function public.habita_followup_set_status(uuid, text) to service_role;
grant execute on function public.habita_followup_mark(uuid, uuid, uuid, integer, text, text, text) to service_role;
grant execute on function public.habita_followup_claim(uuid, text, uuid, text, text, integer) to service_role;
grant execute on function public.habita_followup_release(uuid, uuid) to service_role;

commit;
