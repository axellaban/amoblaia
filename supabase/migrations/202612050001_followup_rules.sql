-- Follow-up, Fase 3: reglas configurables y auditoría (docs/FOLLOWUP.md).
--
-- 1. followup_rules: la next best action como datos. Una regla dice: en esta
--    etapa, con estas situaciones (vacía: cualquiera), después de este paso,
--    mandá esta acción a las N horas de nuestro último mensaje, dentro de esta
--    ventana. Se siembran iguales a las reglas fijas de la Fase 2 (salvo «crear
--    demo» y «enviar demo», que pasan a salir enseguida: una demo prometida no
--    espera). Cambiar un tiempo ya no necesita un deploy.
-- 2. followup_audit: quién cambió qué y cuándo (etapa, situación, score,
--    prioridad, reprogramación, nombre corto, reglas y versiones).
--
-- Aditiva e idempotente. Solo la usan las rutas del servidor (service role).
begin;

create table if not exists public.followup_rules (
  key text primary key check (length(key) between 3 and 80),
  stage text not null check (stage in ('no-contactado', 'no-responde', 'sin-demo', 'sin-enviar', 'no-abrio', 'sin-interaccion', 'sin-cuenta', 'sin-uso', 'sin-suscripcion')),
  situations text[] not null default '{}' check (situations <@ array['sin_respuesta', 'confirmo_numero', 'interesado', 'neutro', 'pregunta_precios', 'mas_adelante', 'derivo']::text[]),
  action text not null check (action in ('principal', 'seguimiento_2', 'presentacion', 'presentacion_seguimiento', 'precios')),
  after_hours numeric(6, 1) not null default 0 check (after_hours between 0 and 720),
  after_action text check (after_action in ('principal', 'seguimiento_2', 'presentacion', 'presentacion_seguimiento', 'precios')),
  position integer not null default 100 check (position between 0 and 1000),
  enabled boolean not null default true,
  hours_from integer not null default 9 check (hours_from between 0 and 23),
  hours_to integer not null default 19 check (hours_to between 1 and 24),
  days integer[] not null default '{1,2,3,4,5,6}' check (days <@ array[0, 1, 2, 3, 4, 5, 6]),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (hours_from < hours_to),
  check (after_action is distinct from action)
);

insert into public.followup_rules (key, stage, situations, action, after_hours, after_action, position, enabled, hours_from, hours_to, days) values
  ('no-contactado:presentacion', 'no-contactado', '{confirmo_numero,derivo}', 'presentacion', 0, null, 10, true, 9, 19, '{1,2,3,4,5,6}'),
  ('no-contactado:presentacion_seguimiento', 'no-contactado', '{confirmo_numero,derivo}', 'presentacion_seguimiento', 48, 'presentacion', 20, true, 9, 19, '{1,2,3,4,5,6}'),
  ('no-contactado:precios', 'no-contactado', '{pregunta_precios}', 'precios', 0, null, 30, true, 9, 19, '{1,2,3,4,5,6}'),
  ('no-responde:presentacion', 'no-responde', '{confirmo_numero,derivo}', 'presentacion', 0, null, 10, true, 9, 19, '{1,2,3,4,5,6}'),
  ('no-responde:presentacion_seguimiento', 'no-responde', '{confirmo_numero,derivo}', 'presentacion_seguimiento', 48, 'presentacion', 20, true, 9, 19, '{1,2,3,4,5,6}'),
  ('no-responde:precios', 'no-responde', '{pregunta_precios}', 'precios', 0, null, 30, true, 9, 19, '{1,2,3,4,5,6}'),
  ('no-contactado:principal', 'no-contactado', '{sin_respuesta,neutro,mas_adelante}', 'principal', 0, null, 40, true, 9, 18, '{1,2,3,4,5,6}'),
  ('no-responde:principal', 'no-responde', '{sin_respuesta,neutro,mas_adelante}', 'principal', 48, null, 40, true, 9, 19, '{1,2,3,4,5,6}'),
  ('no-responde:seguimiento_2', 'no-responde', '{sin_respuesta,neutro,mas_adelante}', 'seguimiento_2', 72, 'principal', 50, true, 9, 19, '{1,2,3,4,5,6}'),
  ('no-abrio:principal', 'no-abrio', '{}', 'principal', 24, null, 40, true, 9, 19, '{1,2,3,4,5,6}'),
  ('no-abrio:seguimiento_2', 'no-abrio', '{}', 'seguimiento_2', 72, 'principal', 50, true, 9, 19, '{1,2,3,4,5,6}'),
  ('sin-demo:principal', 'sin-demo', '{}', 'principal', 0, null, 40, true, 9, 19, '{1,2,3,4,5,6}'),
  ('sin-enviar:principal', 'sin-enviar', '{}', 'principal', 0, null, 40, true, 9, 19, '{1,2,3,4,5,6}'),
  ('sin-interaccion:principal', 'sin-interaccion', '{}', 'principal', 48, null, 40, true, 9, 19, '{1,2,3,4,5,6}'),
  ('sin-cuenta:principal', 'sin-cuenta', '{}', 'principal', 48, null, 40, true, 9, 19, '{1,2,3,4,5,6}'),
  ('sin-uso:principal', 'sin-uso', '{}', 'principal', 48, null, 40, true, 9, 19, '{1,2,3,4,5,6}'),
  ('sin-suscripcion:principal', 'sin-suscripcion', '{}', 'principal', 48, null, 40, true, 9, 19, '{1,2,3,4,5,6}')
on conflict (key) do nothing;

create table if not exists public.followup_audit (
  id bigint generated always as identity primary key,
  agency_id uuid references public.agencies(id) on delete cascade,
  -- Qué se cambió: stage, situation, score, priority, snooze, short_name, rule, version.
  subject text not null check (length(subject) between 1 and 40),
  ref text check (ref is null or length(ref) <= 120),
  old_value text check (old_value is null or length(old_value) <= 2000),
  new_value text check (new_value is null or length(new_value) <= 2000),
  actor_id uuid references public.profiles(id) on delete set null,
  actor_name text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists followup_audit_agency on public.followup_audit (agency_id, created_at desc);

alter table public.followup_rules enable row level security;
alter table public.followup_audit enable row level security;
revoke all on public.followup_rules from anon, authenticated;
revoke all on public.followup_audit from anon, authenticated;

commit;
