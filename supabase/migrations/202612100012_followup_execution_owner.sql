-- Shared execution assignee for Habita / Chapa Labs; independent of 10-minute claims.
ALTER TABLE public.followup_agencies
  ADD COLUMN IF NOT EXISTS execution_owner text
  NOT NULL DEFAULT 'Todos';

ALTER TABLE public.followup_agencies
  DROP CONSTRAINT IF EXISTS followup_agencies_execution_owner_check;
ALTER TABLE public.followup_agencies
  ADD CONSTRAINT followup_agencies_execution_owner_check
  CHECK (execution_owner IN ('Todos', 'Facu', 'Axel', 'Extensión'));
