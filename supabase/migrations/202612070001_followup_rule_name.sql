-- Follow-up: nombre editable de cada regla (docs/FOLLOWUP.md).
--
-- Opcional: sin nombre, el panel muestra la acción de la regla, como hasta ahora.
-- El motor no lo usa. Aditiva e idempotente.
begin;

alter table public.followup_rules add column if not exists name text check (name is null or char_length(name) between 1 and 80);

commit;
