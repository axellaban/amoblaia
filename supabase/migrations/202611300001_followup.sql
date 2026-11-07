-- Follow-up (/admin/follow-up): una next best action por etapa del embudo de
-- Inmobiliarias, con versiones y su medición (docs/FOLLOWUP.md).
--
-- followup_versions: el mensaje (o la tarea) de cada etapa. Una versión no se
-- edita ni se borra: cambiar el texto crea la siguiente, así sus números
-- siguen valiendo. Solo cambia su estado: una activa y, como mucho, una a
-- prueba (A/B 50/50) por etapa.
--
-- followup_executions: cada vez que el equipo (o la extensión) la ejecutó con
-- una inmobiliaria, una fila por versión e inmobiliaria. Guarda el paso del
-- embudo en que estaba: la conversión es haber pasado de ese paso después.
--
-- Solo las leen y escriben las rutas del servidor (service role): RLS sin
-- políticas. Aditiva e idempotente.
begin;

create table if not exists public.followup_versions (
  id uuid primary key default gen_random_uuid(),
  stage text not null check (stage in ('no-contactado', 'no-responde', 'sin-demo', 'sin-enviar', 'no-abrio', 'sin-interaccion', 'sin-cuenta', 'sin-uso', 'sin-suscripcion')),
  version integer not null check (version > 0),
  channel text not null check (channel in ('whatsapp', 'task')),
  trigger_label text not null default '' check (length(trigger_label) <= 120),
  body text not null check (length(btrim(body)) between 1 and 4000),
  ctas text[] not null default '{}' check (ctas <@ array['demo', 'panel', 'whatsapp', 'copy', 'create_demo']::text[]),
  status text not null default 'archived' check (status in ('active', 'test', 'archived')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  status_at timestamptz not null default now(),
  unique (stage, version)
);
create unique index if not exists followup_versions_one_active on public.followup_versions (stage) where status = 'active';
create unique index if not exists followup_versions_one_test on public.followup_versions (stage) where status = 'test';

create or replace function public.habita_followup_version_frozen() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'FOLLOWUP_VERSION_FROZEN';
  end if;
  if new.stage is distinct from old.stage or new.version is distinct from old.version or new.channel is distinct from old.channel
     or new.trigger_label is distinct from old.trigger_label or new.body is distinct from old.body or new.ctas is distinct from old.ctas
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'FOLLOWUP_VERSION_FROZEN';
  end if;
  return new;
end $$;
drop trigger if exists followup_versions_frozen on public.followup_versions;
create trigger followup_versions_frozen before update or delete on public.followup_versions
  for each row execute function public.habita_followup_version_frozen();

create table if not exists public.followup_executions (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.followup_versions(id) on delete restrict,
  stage text not null,
  agency_id uuid not null references public.agencies(id) on delete cascade,
  -- El paso del embudo (AGENCY_STEPS) en que estaba al ejecutarla; -1: todavía sin contactar.
  from_step integer not null check (from_step between -1 and 8),
  status text not null check (status in ('opened', 'sent', 'failed')),
  reason text check (reason is null or length(reason) <= 300),
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (version_id, agency_id)
);
create index if not exists followup_executions_agency on public.followup_executions (agency_id);

alter table public.followup_versions enable row level security;
alter table public.followup_executions enable row level security;
revoke all on public.followup_versions from anon, authenticated;
revoke all on public.followup_executions from anon, authenticated;

-- Una versión nueva de la etapa, con el número siguiente. «active» archiva la
-- activa anterior; «test» reemplaza la que estaba a prueba.
create or replace function public.habita_followup_create(
  p_actor uuid, p_stage text, p_channel text, p_trigger text, p_body text, p_ctas text[], p_status text
) returns public.followup_versions
language plpgsql as $$
declare
  v_next integer;
  v_row public.followup_versions;
begin
  if p_status not in ('active', 'test') then
    raise exception 'FOLLOWUP_INVALID_STATUS';
  end if;
  perform pg_advisory_xact_lock(hashtext('followup:' || p_stage));
  select coalesce(max(version), 0) + 1 into v_next from public.followup_versions where stage = p_stage;
  update public.followup_versions set status = 'archived', status_at = now() where stage = p_stage and status = p_status;
  insert into public.followup_versions (stage, version, channel, trigger_label, body, ctas, status, created_by)
  values (p_stage, v_next, p_channel, coalesce(btrim(p_trigger), ''), btrim(p_body), coalesce(p_ctas, '{}'), p_status, p_actor)
  returning * into v_row;
  return v_row;
end $$;

-- Cambia el estado de una versión: «active» (la anterior activa se archiva),
-- «test» (la anterior a prueba se archiva) o «archived». La activa no se
-- archiva sola: la etapa quedaría sin acción.
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
  perform pg_advisory_xact_lock(hashtext('followup:' || v_row.stage));
  if v_row.status = p_status then
    return v_row;
  end if;
  if v_row.status = 'active' and p_status <> 'active' then
    raise exception 'FOLLOWUP_ACTIVE_REQUIRED';
  end if;
  if p_status <> 'archived' then
    update public.followup_versions set status = 'archived', status_at = now() where stage = v_row.stage and status = p_status;
  end if;
  update public.followup_versions set status = p_status, status_at = now() where id = p_version returning * into v_row;
  return v_row;
end $$;

-- Registra la ejecución de una versión con una inmobiliaria. «sent» no vuelve
-- atrás: abrir o marcar como no enviada una ya enviada no cambia nada.
create or replace function public.habita_followup_mark(
  p_actor uuid, p_version uuid, p_agency uuid, p_from_step integer, p_status text, p_reason text
) returns public.followup_executions
language plpgsql as $$
declare
  v_stage text;
  v_row public.followup_executions;
begin
  if p_status not in ('opened', 'sent', 'failed') then
    raise exception 'FOLLOWUP_INVALID_STATUS';
  end if;
  select stage into v_stage from public.followup_versions where id = p_version;
  if v_stage is null then
    raise exception 'FOLLOWUP_VERSION_NOT_FOUND';
  end if;
  insert into public.followup_executions (version_id, stage, agency_id, from_step, status, reason, actor_id, sent_at)
  values (p_version, v_stage, p_agency, p_from_step, p_status, nullif(btrim(coalesce(p_reason, '')), ''), p_actor, case when p_status = 'sent' then now() end)
  on conflict (version_id, agency_id) do update
    set status = excluded.status,
        reason = excluded.reason,
        actor_id = excluded.actor_id,
        from_step = case when public.followup_executions.status = 'sent' then public.followup_executions.from_step else excluded.from_step end,
        sent_at = case when excluded.status = 'sent' then now() else public.followup_executions.sent_at end,
        updated_at = now()
    where public.followup_executions.status <> 'sent'
  returning * into v_row;
  if v_row.id is null then
    select * into v_row from public.followup_executions where version_id = p_version and agency_id = p_agency;
  end if;
  return v_row;
end $$;

revoke all on function public.habita_followup_create(uuid, text, text, text, text, text[], text) from public, anon, authenticated;
revoke all on function public.habita_followup_set_status(uuid, text) from public, anon, authenticated;
revoke all on function public.habita_followup_mark(uuid, uuid, uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.habita_followup_create(uuid, text, text, text, text, text[], text) to service_role;
grant execute on function public.habita_followup_set_status(uuid, text) to service_role;
grant execute on function public.habita_followup_mark(uuid, uuid, uuid, integer, text, text) to service_role;

-- La V1 de cada etapa, activa. El equipo las cambia desde el panel.
insert into public.followup_versions (stage, version, channel, trigger_label, body, ctas, status) values
  ('no-contactado', 1, 'whatsapp', 'Al importarla', 'Hola {{decisor}}, soy {{sdr}} de habita. Vi las propiedades de {{inmobiliaria}} y armamos una herramienta que amuebla y mejora las fotos con IA en segundos. ¿Te muestro cómo se verían las tuyas?', '{whatsapp,copy}', 'active'),
  ('no-responde', 1, 'whatsapp', '3 días sin respuesta', '{{decisor}}, te dejo cómo quedaría una de sus propiedades amueblada con IA, sin compromiso: {{demo}}', '{whatsapp,demo,copy}', 'active'),
  ('sin-demo', 1, 'task', 'Al marcarla interesada', 'Crear la demo con 3 propiedades de su web (living, dormitorio y fachada) y avisar por WhatsApp cuando esté lista.', '{create_demo}', 'active'),
  ('sin-enviar', 1, 'whatsapp', '1 día después de crearla', '{{decisor}}, ya está lista la demo de {{inmobiliaria}}: {{demo}}. Probá cambiar el estilo de los muebles desde ahí mismo.', '{whatsapp,demo,copy}', 'active'),
  ('no-abrio', 1, 'whatsapp', '2 días sin visita', '{{decisor}}, ¿pudiste ver la demo de {{inmobiliaria}}? Te muestra cómo quedan sus propiedades amuebladas con IA: {{demo}}', '{whatsapp,demo,copy}', 'active'),
  ('sin-interaccion', 1, 'whatsapp', '1 día después de la visita', 'Vi que entraste a la demo. Un tip: tocá «Cambiar estilo» en cualquier foto y elegí nórdico o industrial. {{demo}}', '{whatsapp,demo,copy}', 'active'),
  ('sin-cuenta', 1, 'whatsapp', '1 día después de interactuar', '¡Qué bueno que lo probaste! Si querés, seguís desde el panel de {{inmobiliaria}} con estas fotos ya cargadas: {{panel}}', '{whatsapp,panel,copy}', 'active'),
  ('sin-uso', 1, 'whatsapp', '2 días sin actividad', '{{decisor}}, tu panel ya está listo: {{panel}}. Subí una propiedad y en un minuto tenés las fotos mejoradas.', '{whatsapp,panel,copy}', 'active'),
  ('sin-suscripcion', 1, 'whatsapp', 'Con la cuenta activa', '{{decisor}}, vi que ya mejoraste varias fotos. Desde tu panel podés elegir un plan para seguir sin límite: {{panel}}', '{whatsapp,panel,copy}', 'active')
on conflict (stage, version) do nothing;

commit;
