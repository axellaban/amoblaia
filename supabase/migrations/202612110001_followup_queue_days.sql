-- Resultados · ejecución de la cola (se puede re-ejecutar).
--
-- 1. La foto diaria de la cola: qué acciones estuvieron pendientes cada día
--    (hora de Buenos Aires). El servidor la completa al calcular la cola (el
--    panel y el cron diario); una fila por inmobiliaria, etapa, acción y día.
-- 2. Quién ejecutó cada envío: una persona del equipo o un bot. Hasta que haya
--    envíos automáticos todo queda como «humano».

create table if not exists public.followup_queue_days (
  day date not null,
  agency_id uuid not null references public.agencies(id) on delete cascade,
  stage text not null,
  action text not null default 'principal',
  state text not null check (state in ('lista', 'bloqueada', 'programada')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (day, agency_id, stage, action)
);
create index if not exists followup_queue_days_day_idx on public.followup_queue_days (day);
alter table public.followup_queue_days enable row level security;
-- Sin políticas: solo el servidor (service role) la lee y la escribe.

alter table public.followup_executions add column if not exists executed_by text not null default 'humano';
alter table public.followup_executions drop constraint if exists followup_executions_executed_by_check;
alter table public.followup_executions add constraint followup_executions_executed_by_check check (executed_by in ('humano', 'bot'));
