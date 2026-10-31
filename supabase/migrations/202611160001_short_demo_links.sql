-- Short demo links: /p/<propiedad>-<codigo>. A claim link made from a demo
-- remembers that demo, so its short code alone (stored only as its hash,
-- like every invitation code) leads to it. Claims sent without a demo, and
-- those made before this migration, keep demo_id null and their long links.
alter table public.agency_claims
  add column if not exists demo_id uuid references public.demos(id) on delete set null;
create index if not exists agency_claims_demo on public.agency_claims(demo_id) where demo_id is not null;
