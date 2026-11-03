-- Who took over each agency, for the team to review (Habita V2, Fase 4).
-- Creating the account stays instant (Google, or e-mail and password); the
-- e-mail used and whether it matches the agency's own domain are recorded so
-- a forwarded demo link that ends in the wrong hands is seen and corrected.
--   ok        the e-mail's domain is the agency's website domain
--   personal  a personal mailbox (gmail, hotmail…): usual, worth a look
--   mismatch  another company's domain: review first
--   confirmed the team checked it
-- Additive and idempotent: safe to run again.
begin;

alter table public.agencies add column if not exists claim_email text;
alter table public.agencies add column if not exists claim_method text;
alter table public.agencies add column if not exists claim_review text;
alter table public.agencies add column if not exists claim_reviewed_at timestamptz;
do $$ begin
 if not exists (select 1 from pg_constraint where conname = 'agencies_claim_method') then
  alter table public.agencies add constraint agencies_claim_method check (claim_method is null or claim_method in ('google', 'email', 'existing'));
 end if;
 if not exists (select 1 from pg_constraint where conname = 'agencies_claim_review') then
  alter table public.agencies add constraint agencies_claim_review check (claim_review is null or claim_review in ('ok', 'personal', 'mismatch', 'confirmed'));
 end if;
end $$;
create index if not exists agencies_claim_review_open on public.agencies(claimed_at desc) where claim_review in ('personal', 'mismatch');

commit;
