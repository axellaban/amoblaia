-- Follow-up, Fase 4: resultados con ventana de atribución (docs/FOLLOWUP.md).
--
-- El embudo no guarda cuándo se llegó a cada paso. Cada ejecución guarda
-- cuándo se vio que la inmobiliaria avanzó después de ella (`converted_at`) y
-- a qué paso (`converted_step`): la hora exacta cuando se conoce (el interés
-- registrado, la demo creada) o, si no, la primera vez que el panel lo ve. Con
-- eso se miden las ventanas de 7 y 14 días y el tiempo a la conversión.
--
-- Aditiva e idempotente.
begin;

alter table public.followup_executions add column if not exists converted_at timestamptz;
alter table public.followup_executions add column if not exists converted_step integer check (converted_step between -1 and 8);
create index if not exists followup_executions_sent on public.followup_executions (sent_at) where status = 'sent';

commit;
