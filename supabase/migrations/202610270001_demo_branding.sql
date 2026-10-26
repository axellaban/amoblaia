-- Commercial demos as the agency's own listing: its branding and contact,
-- and per-demo settings (opening mode, presentation strip, listing data).
--
-- * agencies.branding: logo (small, base64), colors, title font and the
--   contact channel the agency uses on its own site (WhatsApp, form link,
--   phone or e-mail), plus an optional link to book a visit.
-- * demos.settings: opening mode (original photo or a staged style),
--   whether the presentation link shows the "Demo preparada para…" strip,
--   and listing data the admin enters (operation, price, features,
--   reference). Nothing is invented: empty fields are not shown.
-- Only the server (service_role) reads these tables, as before.
-- Idempotent: safe to run again.
begin;
alter table public.agencies add column if not exists branding jsonb not null default '{}'::jsonb;
alter table public.demos add column if not exists settings jsonb not null default '{}'::jsonb;
do $$ begin
 if not exists (select 1 from pg_constraint where conname='agencies_branding_size') then
  alter table public.agencies add constraint agencies_branding_size check (octet_length(branding::text) <= 400000);
 end if;
 if not exists (select 1 from pg_constraint where conname='demos_settings_size') then
  alter table public.demos add constraint demos_settings_size check (octet_length(settings::text) <= 20000);
 end if;
end $$;
commit;
