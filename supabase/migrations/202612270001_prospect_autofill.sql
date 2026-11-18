-- Prospectos: llenado automático de la cola de primeros saludos.
-- Cada mañana (cron de las 06:00 de Buenos Aires) suma a la cola las mejores
-- calificadas hasta cubrir la meta del día. Se puede re-ejecutar.
begin;
alter table public.followup_quota_settings
  add column if not exists autofill_enabled boolean not null default true,
  -- Primeros saludos que la cola debería tener listos cada mañana. Sin valor: el cupo diario (cap).
  add column if not exists autofill_target integer check (autofill_target is null or autofill_target between 1 and 100),
  -- La última corrida: cuándo, la meta, cuántos esperaban, cuántos se pidieron y cuántos entraron.
  add column if not exists autofill_last jsonb;
commit;
