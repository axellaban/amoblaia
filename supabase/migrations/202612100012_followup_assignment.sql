-- Assignment controls who is responsible for the next commercial action.
-- NULL means Todos; claims remain separate ten-minute locks.
alter table public.followup_agencies
  add column if not exists assigned_to text null;
alter table public.followup_agencies
  drop constraint if exists followup_agencies_assigned_to_check;
alter table public.followup_agencies
  add constraint followup_agencies_assigned_to_check
  check (assigned_to is null or assigned_to in ('Facu', 'Axel', 'Extensión'));
