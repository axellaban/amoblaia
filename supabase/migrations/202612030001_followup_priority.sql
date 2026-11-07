-- Follow-up, ajuste de la Fase 1 a la especificación de Astra (docs/FOLLOWUP.md):
--
-- 1. Prioridad manual (Alta, Media, Baja): se calcula sola por el grupo de la
--    cola; el equipo puede cambiarla y la manual manda hasta que la saquen.
-- 2. «Omitir o reprogramar»: la inmobiliaria sale de la cola hasta una fecha,
--    con el motivo.
--
-- Aditiva e idempotente. Solo la usan las rutas del servidor (service role).
begin;

alter table public.followup_agencies add column if not exists priority text check (priority in ('alta', 'media', 'baja'));
alter table public.followup_agencies add column if not exists snooze_until timestamptz;
alter table public.followup_agencies add column if not exists snooze_reason text check (snooze_reason is null or length(snooze_reason) <= 300);

commit;
