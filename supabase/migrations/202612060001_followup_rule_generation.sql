-- Optional rule condition, after followup_rules has been created in the
-- 202612050001 migration. Preserves all historical rule definitions.
begin;
alter table public.followup_rules
  add column if not exists min_demo_activity_level integer not null default 0
  check (min_demo_activity_level in (0, 3));
commit;
