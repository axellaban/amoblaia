-- The team edits an agency from administration; agencies are created on their own.
--
-- * agencies.contact_email: the team's private contact e-mail of the agency
--   (like contact_name and notes). Members never read it: the column is not
--   in the column grant of 202610280001, so RLS reads keep it out.
-- * agencies.request_key: one agency per "Crear inmobiliaria" request. A
--   double click, a retry after a timeout or two tabs create it once.
-- * demo_properties.request_key: one property per "Guardar borrador" of a
--   manual property, per agency, for the same reason.
-- * admin_audit_subject: the activity of one agency (support views, edit
--   contexts, edits, invitations) read newest first.
-- Additive and idempotent: no column, function or policy is redefined.
begin;

alter table public.agencies add column if not exists contact_email text;
do $$ begin
 if not exists (select 1 from pg_constraint where conname='agencies_contact_email_length') then
  alter table public.agencies add constraint agencies_contact_email_length check (contact_email is null or length(contact_email) <= 200);
 end if;
end $$;

alter table public.agencies add column if not exists request_key uuid;
create unique index if not exists agencies_request_key on public.agencies(request_key) where request_key is not null;

alter table public.demo_properties add column if not exists request_key uuid;
create unique index if not exists demo_properties_request_key on public.demo_properties(agency_id, request_key) where request_key is not null;

create index if not exists admin_audit_subject on public.admin_audit(subject_id, created_at desc);

commit;
