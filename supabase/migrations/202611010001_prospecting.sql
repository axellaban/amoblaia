-- Commercial acquisition (prospecting) for the team: one private base of
-- agencies being prospected, their commercial contacts, versioned message
-- templates, outreach attempts with explicit confirmation, an append-only
-- event history and suppressions. See docs/PROSPECCION.md.
--
-- * Reuses agencies as the account: prospect_accounts.agency_id is unique, so
--   an agency is never duplicated per property or per channel. Demos stay in
--   demos/demo_properties and are only linked through the agency.
-- * Everything here is private to the team: RLS on, no grants to anon or
--   authenticated, no policies. Only the server (service_role) reads or
--   writes, after requireAdmin. Public demos never read these tables.
-- * "Sent" means a confirmed send of an attempt (status 'sent'). Preparing an
--   attempt or opening the channel never counts. A possible send whose
--   confirmation was lost becomes 'uncertain' and blocks a retry until it is
--   reconciled by hand; nothing is re-queued automatically.
-- * prospect_events is append-only (a trigger refuses update/delete).
--   Corrections are new events that point at the corrected one.
-- * Template versions are immutable: editing creates a new version.
-- Additive and idempotent: safe to run again. Does not change earlier tables.
begin;

create table if not exists public.prospect_metric_settings (
 version integer primary key check (version > 0),
 message_window_days integer not null check (message_window_days between 1 and 90),
 account_window_days integer not null check (account_window_days between 1 and 180),
 small_sample integer not null check (small_sample between 1 and 1000),
 created_by uuid,
 created_at timestamptz not null default now()
);
-- Measurement rules, not data: 7 days for messages, 30 for accounts, n<30 is a small sample.
insert into public.prospect_metric_settings(version, message_window_days, account_window_days, small_sample)
 values (1, 7, 30, 30) on conflict (version) do nothing;

create table if not exists public.prospect_imports (
 id uuid primary key default gen_random_uuid(),
 source text not null check (length(btrim(source)) between 1 and 80),
 file_name text check (file_name is null or length(file_name) <= 200),
 file_hash text check (file_hash is null or file_hash ~ '^[0-9a-f]{64}$'),
 mapping jsonb not null default '{}',
 status text not null default 'applying' check (status in ('applying', 'applied')),
 report jsonb,
 created_by uuid,
 created_at timestamptz not null default now(),
 applied_at timestamptz
);

create table if not exists public.prospect_accounts (
 id uuid primary key default gen_random_uuid(),
 agency_id uuid not null unique references public.agencies(id) on delete restrict,
 source text check (source is null or length(source) <= 80),
 source_key text check (source_key is null or length(source_key) <= 200),
 campaign text check (campaign is null or length(campaign) <= 80),
 sdr text check (sdr is null or length(sdr) <= 80),
 priority text check (priority is null or length(priority) <= 40),
 score numeric(8,2),
 score_components jsonb not null default '{}',
 scoring_version text check (scoring_version is null or length(scoring_version) <= 80),
 zone text check (zone is null or length(zone) <= 120),
 address text check (address is null or length(address) <= 300),
 decision_maker text check (decision_maker is null or length(decision_maker) <= 160),
 decision_maker_role text check (decision_maker_role is null or length(decision_maker_role) <= 120),
 stage text not null default 'pending' check (stage in ('pending', 'sent', 'conversation', 'interested', 'activated', 'customer', 'lost', 'discarded')),
 lost_reason text check (lost_reason is null or length(lost_reason) <= 300),
 next_action text check (next_action is null or length(next_action) <= 300),
 due_at timestamptz,
 due_precision text not null default 'time' check (due_precision in ('time', 'day')),
 team_notes text check (team_notes is null or length(team_notes) <= 8000),
 source_notes text check (source_notes is null or length(source_notes) <= 8000),
 source_data jsonb not null default '{}',
 imported_at timestamptz,
 last_import_id uuid references public.prospect_imports(id) on delete set null,
 version integer not null default 1,
 created_by uuid,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create unique index if not exists prospect_accounts_source on public.prospect_accounts(source, source_key) where source is not null and source_key is not null;
create index if not exists prospect_accounts_due on public.prospect_accounts(due_at) where due_at is not null;

create table if not exists public.prospect_contacts (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.prospect_accounts(id) on delete restrict,
 person_name text check (person_name is null or length(person_name) <= 160),
 role text check (role is null or length(role) <= 120),
 is_decision_maker boolean not null default false,
 channel text not null check (channel in ('whatsapp', 'email', 'phone', 'instagram', 'web', 'other')),
 address text check (address is null or length(address) <= 300),
 address_original text check (address_original is null or length(address_original) <= 300),
 confidence text check (confidence is null or length(confidence) <= 60),
 source text check (source is null or length(source) <= 200),
 source_url text check (source_url is null or length(source_url) <= 500),
 needs_review boolean not null default false,
 review_reason text check (review_reason is null or length(review_reason) <= 300),
 verified_at timestamptz,
 verified_by uuid,
 invalid_at timestamptz,
 invalid_reason text check (invalid_reason is null or length(invalid_reason) <= 300),
 is_primary boolean not null default false,
 created_by uuid,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create unique index if not exists prospect_contacts_address on public.prospect_contacts(account_id, channel, address) where address is not null;
create index if not exists prospect_contacts_account on public.prospect_contacts(account_id);

create table if not exists public.outreach_templates (
 id uuid primary key default gen_random_uuid(),
 name text not null check (length(btrim(name)) between 1 and 80),
 purpose text check (purpose is null or length(purpose) <= 300),
 step smallint not null check (step between 0 and 3),
 channel text not null check (channel in ('whatsapp', 'email')),
 archived_at timestamptz,
 created_by uuid,
 created_at timestamptz not null default now(),
 unique (name, channel, step)
);

create table if not exists public.outreach_template_versions (
 id uuid primary key default gen_random_uuid(),
 template_id uuid not null references public.outreach_templates(id) on delete restrict,
 version integer not null check (version > 0),
 subject text check (subject is null or length(subject) <= 200),
 body text not null check (length(btrim(body)) between 1 and 4000),
 created_by uuid,
 created_at timestamptz not null default now(),
 unique (template_id, version)
);

create table if not exists public.outreach_attempts (
 id uuid primary key default gen_random_uuid(),
 idempotency_key uuid not null unique,
 legacy_key text unique check (legacy_key is null or length(legacy_key) <= 400),
 account_id uuid not null references public.prospect_accounts(id) on delete restrict,
 contact_id uuid references public.prospect_contacts(id) on delete restrict,
 campaign text not null default 'general' check (length(campaign) between 1 and 80),
 step smallint not null check (step between 0 and 3),
 ordinal integer,
 template_version_id uuid references public.outreach_template_versions(id) on delete restrict,
 based_on_version_id uuid references public.outreach_template_versions(id) on delete restrict,
 is_custom boolean not null default false,
 variant_label text check (variant_label is null or length(variant_label) <= 120),
 channel text not null check (channel in ('whatsapp', 'email', 'phone', 'instagram', 'other', 'unknown')),
 recipient text check (recipient is null or length(recipient) <= 300),
 sender text check (sender is null or length(sender) <= 160),
 subject text check (subject is null or length(subject) <= 200),
 body text check (body is null or length(body) <= 4000),
 status text not null default 'prepared' check (status in ('prepared', 'opened', 'sent', 'uncertain', 'failed', 'bounced', 'invalid_endpoint', 'cancelled')),
 status_reason text check (status_reason is null or length(status_reason) <= 300),
 prepared_by uuid,
 prepared_at timestamptz not null default now(),
 opened_by uuid,
 opened_at timestamptz,
 lock_holder uuid,
 lock_expires_at timestamptz,
 sent_at timestamptz,
 sent_precision text check (sent_precision is null or sent_precision in ('time', 'day')),
 confirmed_by uuid,
 confirmed_at timestamptz,
 verification_method text check (verification_method is null or verification_method in ('channel_observed', 'manual', 'imported')),
 external_id text check (external_id is null or length(external_id) <= 200),
 evidence text check (evidence is null or length(evidence) <= 500),
 legacy boolean not null default false,
 version integer not null default 1,
 updated_at timestamptz not null default now(),
 -- A free (custom) message never carries a template version: it is not a variant.
 check (not (is_custom and template_version_id is not null)),
 check (status not in ('sent', 'bounced') or sent_at is not null)
);
-- One live attempt per account: two operators or two tabs cannot prepare two
-- messages for the same agency, and an uncertain one blocks the next.
create unique index if not exists outreach_attempts_one_open on public.outreach_attempts(account_id) where status in ('prepared', 'opened', 'uncertain');
create index if not exists outreach_attempts_account on public.outreach_attempts(account_id, sent_at);

create table if not exists public.prospect_events (
 id uuid primary key default gen_random_uuid(),
 client_key uuid unique,
 account_id uuid not null references public.prospect_accounts(id) on delete restrict,
 attempt_id uuid references public.outreach_attempts(id) on delete restrict,
 contact_id uuid references public.prospect_contacts(id) on delete restrict,
 type text not null check (type in (
  'imported', 'sent', 'failed', 'bounced', 'invalid_endpoint', 'uncertain', 'cancelled',
  'reply', 'auto_reply', 'interest', 'not_interested', 'meeting', 'lost', 'reopened', 'note',
  'suppressed', 'suppression_lifted', 'activated', 'purchased', 'refunded',
  'account_updated', 'score_changed', 'contact_changed', 'correction')),
 occurred_at timestamptz not null,
 occurred_precision text not null default 'time' check (occurred_precision in ('time', 'day')),
 recorded_at timestamptz not null default now(),
 actor uuid,
 source text not null default 'manual' check (source in ('manual', 'import', 'server')),
 channel text check (channel is null or channel in ('whatsapp', 'email', 'phone', 'instagram', 'web', 'other', 'unknown')),
 human boolean,
 evidence text check (evidence is null or length(evidence) <= 1000),
 evidence_ref text check (evidence_ref is null or length(evidence_ref) <= 200),
 details jsonb not null default '{}',
 corrects_event_id uuid references public.prospect_events(id) on delete restrict
);
create index if not exists prospect_events_account on public.prospect_events(account_id, occurred_at);
-- A server milestone (activation, first purchase) exists once per account.
create unique index if not exists prospect_events_milestone on public.prospect_events(account_id, type) where type in ('activated', 'purchased');
create unique index if not exists prospect_events_evidence on public.prospect_events(type, evidence_ref) where evidence_ref is not null;

create table if not exists public.prospect_suppressions (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.prospect_accounts(id) on delete restrict,
 scope text not null check (scope in ('account', 'channel', 'contact')),
 channel text check (channel is null or channel in ('whatsapp', 'email', 'phone', 'instagram', 'web', 'other')),
 contact_id uuid references public.prospect_contacts(id) on delete restrict,
 reason text not null check (length(btrim(reason)) between 1 and 300),
 created_by uuid,
 created_at timestamptz not null default now(),
 lifted_at timestamptz,
 lifted_by uuid,
 lifted_reason text check (lifted_reason is null or length(lifted_reason) <= 300),
 check ((scope = 'channel') = (channel is not null)),
 check ((scope = 'contact') = (contact_id is not null))
);
create index if not exists prospect_suppressions_account on public.prospect_suppressions(account_id) where lifted_at is null;

create table if not exists public.prospect_import_rows (
 import_id uuid not null references public.prospect_imports(id) on delete cascade,
 row_number integer not null,
 source_key text not null,
 account_id uuid references public.prospect_accounts(id) on delete set null,
 outcome text not null check (outcome in ('created', 'updated', 'unchanged', 'conflict', 'error')),
 messages jsonb not null default '[]',
 raw jsonb not null default '{}',
 primary key (import_id, row_number)
);

-- History is never edited: corrections are new events.
create or replace function public.habita_prospect_append_only() returns trigger language plpgsql set search_path=public as $$
begin
 raise exception 'APPEND_ONLY';
end $$;
drop trigger if exists prospect_events_append_only on public.prospect_events;
create trigger prospect_events_append_only before update or delete on public.prospect_events
 for each row execute function public.habita_prospect_append_only();
-- A template version is frozen: a new text is a new version.
drop trigger if exists outreach_template_versions_frozen on public.outreach_template_versions;
create trigger outreach_template_versions_frozen before update or delete on public.outreach_template_versions
 for each row execute function public.habita_prospect_append_only();

do $$ declare t text; begin
 foreach t in array array['prospect_accounts', 'prospect_contacts', 'outreach_attempts'] loop
  execute format('drop trigger if exists touch_updated_at on public.%I', t);
  execute format('create trigger touch_updated_at before update on public.%I for each row execute function public.amobla_touch_updated_at()', t);
 end loop;
 foreach t in array array['prospect_metric_settings', 'prospect_imports', 'prospect_accounts', 'prospect_contacts', 'outreach_templates',
   'outreach_template_versions', 'outreach_attempts', 'prospect_events', 'prospect_suppressions', 'prospect_import_rows'] loop
  execute format('alter table public.%I enable row level security', t);
  execute format('revoke all on public.%I from public, anon, authenticated', t);
  execute format('grant all on public.%I to service_role', t);
 end loop;
end $$;

-- The widest active suppression that applies, or null: account beats channel
-- beats contact. A contact suppression also covers the same address on the
-- same channel (an alternative contact never lifts an account-wide opt-out).
create or replace function public.habita_prospect_blocked(p_account uuid, p_contact uuid, p_channel text) returns text
 language sql stable security definer set search_path=public as $$
 select case
  when exists (select 1 from prospect_suppressions where account_id=p_account and lifted_at is null and scope='account') then 'account'
  when exists (select 1 from prospect_suppressions where account_id=p_account and lifted_at is null and scope='channel' and channel=p_channel) then 'channel'
  when exists (select 1 from prospect_suppressions s join prospect_contacts sc on sc.id=s.contact_id
    left join prospect_contacts c on c.id=p_contact
    where s.lifted_at is null and s.scope='contact'
     and (s.contact_id=p_contact or (c.address is not null and sc.channel=c.channel and sc.address=c.address))) then 'contact'
 end $$;

-- Whether the account has a human reply (not corrected away).
create or replace function public.habita_prospect_replied(p_account uuid) returns boolean
 language sql stable security definer set search_path=public as $$
 select exists (select 1 from prospect_events e where e.account_id=p_account and e.type='reply' and e.human is not false
  and not exists (select 1 from prospect_events c where c.corrects_event_id=e.id))
$$;

-- The stage that follows from the history, for reopening a lost account.
create or replace function public.habita_prospect_derived_stage(p_account uuid) returns text
 language sql stable security definer set search_path=public as $$
 select case
  when exists (select 1 from prospect_events e where e.account_id=p_account and e.type='purchased' and not exists (select 1 from prospect_events c where c.corrects_event_id=e.id)) then 'customer'
  when exists (select 1 from prospect_events e where e.account_id=p_account and e.type='activated' and not exists (select 1 from prospect_events c where c.corrects_event_id=e.id)) then 'activated'
  when exists (select 1 from prospect_events e where e.account_id=p_account and e.type='interest' and not exists (select 1 from prospect_events c where c.corrects_event_id=e.id)) then 'interested'
  when habita_prospect_replied(p_account) then 'conversation'
  when exists (select 1 from outreach_attempts where account_id=p_account and status='sent') then 'sent'
  else 'pending' end
$$;

-- Moves the stage forward only (pending < sent < conversation < interested <
-- activated < customer). Lost/discarded are left as they are.
create or replace function public.habita_prospect_advance(p_account uuid, p_stage text) returns void
 language plpgsql security definer set search_path=public as $$
declare rank_of constant text[] := array['pending', 'sent', 'conversation', 'interested', 'activated', 'customer'];
 current_stage text;
begin
 select stage into current_stage from prospect_accounts where id=p_account;
 if current_stage in ('lost', 'discarded') then return; end if;
 if array_position(rank_of, p_stage) > array_position(rank_of, current_stage) then
  update prospect_accounts set stage=p_stage, version=version+1 where id=p_account;
 end if;
end $$;

-- Prepares (freezes) one message for one reviewed contact. Never sends.
-- Idempotent by p_key: the same key returns the same attempt.
create or replace function public.habita_prospect_prepare(
 p_actor uuid, p_key uuid, p_account uuid, p_contact uuid, p_step integer, p_campaign text,
 p_template_version uuid, p_custom boolean, p_subject text, p_body text, p_sender text, p_reviewed boolean)
 returns jsonb language plpgsql security definer set search_path=public as $$
declare a outreach_attempts; c prospect_contacts; v outreach_template_versions; t outreach_templates; blocked text; label text; open_id uuid;
begin
 select * into a from outreach_attempts where idempotency_key=p_key;
 if found then
  if a.account_id<>p_account then raise exception 'KEY_REUSED'; end if;
  return to_jsonb(a) || jsonb_build_object('replayed', true);
 end if;
 perform 1 from prospect_accounts where id=p_account for update;
 if not found then raise exception 'ACCOUNT_NOT_FOUND'; end if;
 select * into c from prospect_contacts where id=p_contact and account_id=p_account;
 if not found then raise exception 'CONTACT_NOT_FOUND'; end if;
 if c.channel not in ('whatsapp', 'email') then raise exception 'CHANNEL_NOT_SUPPORTED'; end if;
 if c.invalid_at is not null then raise exception 'CONTACT_INVALID'; end if;
 if c.address is null or c.needs_review then raise exception 'CONTACT_NEEDS_REVIEW'; end if;
 if p_reviewed is not true then raise exception 'RECIPIENT_NOT_REVIEWED'; end if;
 blocked := habita_prospect_blocked(p_account, p_contact, c.channel);
 if blocked is not null then raise exception 'SUPPRESSED:%', blocked; end if;
 select id into open_id from outreach_attempts where account_id=p_account and status in ('prepared', 'opened', 'uncertain');
 if open_id is not null then raise exception 'ATTEMPT_OPEN:%', open_id; end if;
 if p_step not between 0 and 3 then raise exception 'INVALID_STEP'; end if;
 -- A reply stops the sequence: only conversation messages (step 0) follow.
 if p_step between 1 and 3 and habita_prospect_replied(p_account) then raise exception 'SEQUENCE_STOPPED'; end if;
 if p_step between 1 and 3 and exists (select 1 from outreach_attempts where account_id=p_account and campaign=coalesce(nullif(btrim(p_campaign), ''), 'general')
   and step=p_step and status in ('sent', 'bounced')) then raise exception 'STEP_ALREADY_SENT'; end if;
 if p_body is null or length(btrim(p_body)) = 0 or length(p_body) > 4000 then raise exception 'INVALID_BODY'; end if;
 if c.channel='email' and (p_subject is null or length(btrim(p_subject)) = 0) then raise exception 'SUBJECT_REQUIRED'; end if;
 if p_sender is null or length(btrim(p_sender)) = 0 then raise exception 'SENDER_REQUIRED'; end if;
 if p_template_version is not null then
  select * into v from outreach_template_versions where id=p_template_version;
  if not found then raise exception 'TEMPLATE_NOT_FOUND'; end if;
  select * into t from outreach_templates where id=v.template_id;
  if t.channel<>c.channel or t.step<>p_step then raise exception 'TEMPLATE_MISMATCH'; end if;
  label := case when p_custom then 'Personalizado (basado en ' || t.name || ' v' || v.version || ')' else t.name || ' v' || v.version end;
 else
  if not p_custom then raise exception 'TEMPLATE_REQUIRED'; end if;
  label := 'Personalizado';
 end if;
 insert into outreach_attempts(idempotency_key, account_id, contact_id, campaign, step, template_version_id, based_on_version_id, is_custom,
   variant_label, channel, recipient, sender, subject, body, status, prepared_by)
  values (p_key, p_account, p_contact, coalesce(nullif(btrim(p_campaign), ''), 'general'), p_step,
   case when p_custom then null else p_template_version end, case when p_custom then p_template_version end, coalesce(p_custom, false),
   label, c.channel, c.address, btrim(p_sender), nullif(btrim(coalesce(p_subject, '')), ''), p_body, 'prepared', p_actor)
  returning * into a;
 return to_jsonb(a);
end $$;

-- Opens the channel for a prepared attempt: re-checks suppression and the
-- contact, then takes a lease for this operator. It never counts as sent.
-- An expired lease of an opened attempt may hide a real send: it becomes
-- 'uncertain' instead of being opened again.
create or replace function public.habita_prospect_open(p_actor uuid, p_attempt uuid, p_version integer, p_lease_seconds integer default 600)
 returns jsonb language plpgsql security definer set search_path=public as $$
declare a outreach_attempts; c prospect_contacts; blocked text;
begin
 select * into a from outreach_attempts where id=p_attempt for update;
 if not found then raise exception 'ATTEMPT_NOT_FOUND'; end if;
 if a.status='opened' then
  if a.lock_holder is distinct from p_actor and a.lock_expires_at > now() then raise exception 'LOCKED'; end if;
  if a.lock_expires_at <= now() then
   update outreach_attempts set status='uncertain', status_reason='lease_expired', lock_holder=null, lock_expires_at=null, version=version+1
    where id=a.id returning * into a;
   insert into prospect_events(account_id, attempt_id, contact_id, type, occurred_at, actor, source, channel, details)
    values (a.account_id, a.id, a.contact_id, 'uncertain', now(), p_actor, 'server', a.channel, jsonb_build_object('reason', 'lease_expired'));
   return to_jsonb(a);
  end if;
  -- Same operator, live lease: reopening the same chat is harmless.
  update outreach_attempts set lock_expires_at=now() + make_interval(secs => greatest(60, least(p_lease_seconds, 3600))) where id=a.id returning * into a;
  return to_jsonb(a);
 end if;
 if a.status<>'prepared' then raise exception 'INVALID_STATE:%', a.status; end if;
 if a.version<>p_version then raise exception 'STALE'; end if;
 select * into c from prospect_contacts where id=a.contact_id;
 blocked := habita_prospect_blocked(a.account_id, a.contact_id, a.channel);
 if blocked is not null or c.invalid_at is not null then
  update outreach_attempts set status='cancelled', status_reason=coalesce('suppressed:' || blocked, 'contact_invalid'), version=version+1
   where id=a.id returning * into a;
  insert into prospect_events(account_id, attempt_id, contact_id, type, occurred_at, actor, source, channel, details)
   values (a.account_id, a.id, a.contact_id, 'cancelled', now(), p_actor, 'server', a.channel, jsonb_build_object('reason', a.status_reason));
  return to_jsonb(a);
 end if;
 if c.address is distinct from a.recipient then raise exception 'RECIPIENT_CHANGED'; end if;
 update outreach_attempts set status='opened', opened_by=p_actor, opened_at=now(), lock_holder=p_actor,
   lock_expires_at=now() + make_interval(secs => greatest(60, least(p_lease_seconds, 3600))), version=version+1
  where id=a.id returning * into a;
 return to_jsonb(a);
end $$;

-- Records that the message went out, as observed by the operator. Confirming
-- the same attempt again returns it unchanged: one send, one event.
create or replace function public.habita_prospect_confirm(p_actor uuid, p_attempt uuid, p_method text, p_sent_at timestamptz, p_external_id text, p_evidence text)
 returns jsonb language plpgsql security definer set search_path=public as $$
declare a outreach_attempts; at timestamptz := coalesce(p_sent_at, now()); n integer; prev text;
begin
 select * into a from outreach_attempts where id=p_attempt for update;
 if not found then raise exception 'ATTEMPT_NOT_FOUND'; end if;
 if a.status='sent' then return to_jsonb(a) || jsonb_build_object('replayed', true); end if;
 if a.status not in ('opened', 'uncertain') then raise exception 'INVALID_STATE:%', a.status; end if;
 if a.status='opened' and a.lock_holder is distinct from p_actor and a.lock_expires_at > now() then raise exception 'LOCKED'; end if;
 if p_method not in ('channel_observed', 'manual') then raise exception 'INVALID_METHOD'; end if;
 prev := a.status;
 if at > now() + interval '2 minutes' or at < a.prepared_at - interval '2 minutes' then raise exception 'INVALID_TIME'; end if;
 select count(*) into n from outreach_attempts where account_id=a.account_id and status in ('sent', 'bounced');
 update outreach_attempts set status='sent', status_reason=null, sent_at=at, sent_precision='time', confirmed_by=p_actor, confirmed_at=now(),
   verification_method=p_method, external_id=nullif(btrim(coalesce(p_external_id, '')), ''), evidence=nullif(btrim(coalesce(p_evidence, '')), ''),
   ordinal=n + 1, lock_holder=null, lock_expires_at=null, version=version+1
  where id=a.id returning * into a;
 insert into prospect_events(account_id, attempt_id, contact_id, type, occurred_at, actor, source, channel, evidence, details)
  values (a.account_id, a.id, a.contact_id, 'sent', at, p_actor, 'manual', a.channel, a.evidence,
   jsonb_build_object('method', p_method, 'step', a.step, 'ordinal', a.ordinal, 'variant', a.variant_label, 'reconciled', prev='uncertain'));
 perform habita_prospect_advance(a.account_id, 'sent');
 return to_jsonb(a);
end $$;

-- Every other outcome of an attempt. None of them counts as sent.
create or replace function public.habita_prospect_resolve(p_actor uuid, p_attempt uuid, p_outcome text, p_reason text)
 returns jsonb language plpgsql security definer set search_path=public as $$
declare a outreach_attempts; ok boolean;
begin
 select * into a from outreach_attempts where id=p_attempt for update;
 if not found then raise exception 'ATTEMPT_NOT_FOUND'; end if;
 if a.status=p_outcome then return to_jsonb(a) || jsonb_build_object('replayed', true); end if;
 ok := case p_outcome
  when 'cancelled' then a.status in ('prepared', 'opened')
  when 'invalid_endpoint' then a.status in ('prepared', 'opened', 'uncertain')
  when 'failed' then a.status in ('opened', 'uncertain')
  when 'uncertain' then a.status='opened'
  when 'bounced' then a.status='sent'
  else null end;
 if ok is null then raise exception 'INVALID_OUTCOME'; end if;
 if not ok then raise exception 'INVALID_STATE:%', a.status; end if;
 if a.status='opened' and a.lock_holder is distinct from p_actor and a.lock_expires_at > now() then raise exception 'LOCKED'; end if;
 if p_outcome in ('failed', 'invalid_endpoint', 'bounced') and (p_reason is null or length(btrim(p_reason)) = 0) then raise exception 'REASON_REQUIRED'; end if;
 update outreach_attempts set status=p_outcome, status_reason=nullif(btrim(coalesce(p_reason, '')), ''), lock_holder=null, lock_expires_at=null,
   ordinal=case when p_outcome='bounced' then null else ordinal end, version=version+1
  where id=a.id returning * into a;
 if p_outcome='invalid_endpoint' and a.contact_id is not null then
  update prospect_contacts set invalid_at=coalesce(invalid_at, now()), invalid_reason=coalesce(invalid_reason, p_reason), is_primary=false where id=a.contact_id;
 end if;
 insert into prospect_events(account_id, attempt_id, contact_id, type, occurred_at, actor, source, channel, details)
  values (a.account_id, a.id, a.contact_id, p_outcome, now(), p_actor, 'manual', a.channel, jsonb_build_object('reason', a.status_reason));
 return to_jsonb(a);
end $$;

-- A fact the team observed (reply, interest, loss…). Idempotent by p_key.
-- A human reply stops the sequence: prepared follow-ups are cancelled.
create or replace function public.habita_prospect_record(
 p_actor uuid, p_key uuid, p_account uuid, p_type text, p_occurred_at timestamptz, p_precision text,
 p_channel text, p_contact uuid, p_attempt uuid, p_evidence text, p_details jsonb, p_corrects uuid)
 returns jsonb language plpgsql security definer set search_path=public as $$
declare e prospect_events; acc prospect_accounts; target prospect_events; stopped integer := 0; prec text := coalesce(p_precision, 'time');
begin
 select * into e from prospect_events where client_key=p_key;
 if found then
  if e.account_id<>p_account then raise exception 'KEY_REUSED'; end if;
  return to_jsonb(e) || jsonb_build_object('replayed', true);
 end if;
 select * into acc from prospect_accounts where id=p_account for update;
 if not found then raise exception 'ACCOUNT_NOT_FOUND'; end if;
 if p_type not in ('reply', 'auto_reply', 'interest', 'not_interested', 'meeting', 'lost', 'reopened', 'note', 'correction') then raise exception 'INVALID_EVENT'; end if;
 if p_occurred_at is null or p_occurred_at > now() + interval '2 minutes' then raise exception 'INVALID_TIME'; end if;
 if prec not in ('time', 'day') then raise exception 'INVALID_TIME'; end if;
 if p_contact is not null and not exists (select 1 from prospect_contacts where id=p_contact and account_id=p_account) then raise exception 'CONTACT_NOT_FOUND'; end if;
 if p_attempt is not null and not exists (select 1 from outreach_attempts where id=p_attempt and account_id=p_account) then raise exception 'ATTEMPT_NOT_FOUND'; end if;
 if p_type in ('interest', 'reply') and (p_evidence is null or length(btrim(p_evidence)) = 0) then raise exception 'EVIDENCE_REQUIRED'; end if;
 if p_type='lost' and coalesce(btrim(p_details->>'reason'), '') = '' then raise exception 'REASON_REQUIRED'; end if;
 if p_type='correction' then
  select * into target from prospect_events where id=p_corrects and account_id=p_account;
  if not found then raise exception 'EVENT_NOT_FOUND'; end if;
  if target.type not in ('reply', 'auto_reply', 'interest', 'not_interested', 'meeting', 'lost', 'note') then raise exception 'NOT_CORRECTABLE'; end if;
  if exists (select 1 from prospect_events where corrects_event_id=p_corrects) then raise exception 'ALREADY_CORRECTED'; end if;
  if coalesce(btrim(p_details->>'reason'), '') = '' then raise exception 'REASON_REQUIRED'; end if;
 elsif p_corrects is not null then raise exception 'INVALID_EVENT';
 end if;
 insert into prospect_events(client_key, account_id, attempt_id, contact_id, type, occurred_at, occurred_precision, actor, source, channel, human, evidence, details, corrects_event_id)
  values (p_key, p_account, p_attempt, p_contact, p_type, p_occurred_at, prec, p_actor, 'manual', p_channel,
   case when p_type='reply' then true when p_type='auto_reply' then false end,
   nullif(btrim(coalesce(p_evidence, '')), ''), coalesce(p_details, '{}'), p_corrects)
  returning * into e;
 if p_type in ('reply', 'interest', 'not_interested', 'meeting') then
  -- Any human answer stops the automatic sequence (not conversation messages).
  with c as (
   update outreach_attempts set status='cancelled', status_reason='sequence_stopped_by_reply', version=version+1
    where account_id=p_account and status='prepared' and step between 1 and 3 returning id, contact_id, channel)
  select count(*) into stopped from c;
  if stopped > 0 then
   insert into prospect_events(account_id, type, occurred_at, actor, source, details)
    values (p_account, 'cancelled', now(), p_actor, 'server', jsonb_build_object('reason', 'sequence_stopped_by_reply', 'attempts', stopped));
  end if;
 end if;
 if p_type in ('reply', 'not_interested', 'meeting') then perform habita_prospect_advance(p_account, 'conversation');
 elsif p_type='interest' then perform habita_prospect_advance(p_account, 'conversation'); perform habita_prospect_advance(p_account, 'interested');
 elsif p_type='lost' then
  update prospect_accounts set stage='lost', lost_reason=left(p_details->>'reason', 300), version=version+1 where id=p_account;
 elsif p_type='reopened' then
  update prospect_accounts set stage='pending', lost_reason=null, version=version+1 where id=p_account;
  update prospect_accounts set stage=habita_prospect_derived_stage(p_account) where id=p_account;
 elsif p_type='correction' then
  if acc.stage not in ('lost', 'discarded') then
   update prospect_accounts set stage=habita_prospect_derived_stage(p_account), version=version+1 where id=p_account;
  end if;
 end if;
 return to_jsonb(e) || jsonb_build_object('stopped', stopped);
end $$;

-- Opt-out. Cancels prepared attempts it covers; an opened one stays so that a
-- message already sent can still be recorded truthfully.
create or replace function public.habita_prospect_suppress(p_actor uuid, p_account uuid, p_scope text, p_channel text, p_contact uuid, p_reason text)
 returns jsonb language plpgsql security definer set search_path=public as $$
declare s prospect_suppressions; n integer := 0;
begin
 perform 1 from prospect_accounts where id=p_account for update;
 if not found then raise exception 'ACCOUNT_NOT_FOUND'; end if;
 if p_scope not in ('account', 'channel', 'contact') then raise exception 'INVALID_SCOPE'; end if;
 if p_scope='contact' and not exists (select 1 from prospect_contacts where id=p_contact and account_id=p_account) then raise exception 'CONTACT_NOT_FOUND'; end if;
 if p_reason is null or length(btrim(p_reason)) = 0 then raise exception 'REASON_REQUIRED'; end if;
 insert into prospect_suppressions(account_id, scope, channel, contact_id, reason, created_by)
  values (p_account, p_scope, case when p_scope='channel' then p_channel end, case when p_scope='contact' then p_contact end, btrim(p_reason), p_actor)
  returning * into s;
 with c as (
  update outreach_attempts a set status='cancelled', status_reason='suppressed:' || p_scope, version=version+1
   where a.account_id=p_account and a.status='prepared' and habita_prospect_blocked(p_account, a.contact_id, a.channel) is not null returning a.id)
 select count(*) into n from c;
 insert into prospect_events(account_id, contact_id, type, occurred_at, actor, source, channel, details)
  values (p_account, s.contact_id, 'suppressed', now(), p_actor, 'manual', s.channel,
   jsonb_build_object('scope', p_scope, 'reason', s.reason, 'suppression', s.id, 'cancelled', n));
 return to_jsonb(s) || jsonb_build_object('cancelled', n);
end $$;

create or replace function public.habita_prospect_lift(p_actor uuid, p_suppression uuid, p_reason text)
 returns jsonb language plpgsql security definer set search_path=public as $$
declare s prospect_suppressions;
begin
 if p_reason is null or length(btrim(p_reason)) = 0 then raise exception 'REASON_REQUIRED'; end if;
 update prospect_suppressions set lifted_at=now(), lifted_by=p_actor, lifted_reason=btrim(p_reason)
  where id=p_suppression and lifted_at is null returning * into s;
 if not found then raise exception 'SUPPRESSION_NOT_FOUND'; end if;
 insert into prospect_events(account_id, contact_id, type, occurred_at, actor, source, channel, details)
  values (s.account_id, s.contact_id, 'suppression_lifted', now(), p_actor, 'manual', s.channel, jsonb_build_object('suppression', s.id, 'reason', s.lifted_reason));
 return to_jsonb(s);
end $$;

-- Edits the operational fields of an account with optimistic concurrency
-- (p_version). A score change is its own event with old and new values.
create or replace function public.habita_prospect_update(p_actor uuid, p_account uuid, p_version integer, p_patch jsonb)
 returns jsonb language plpgsql security definer set search_path=public as $$
declare a prospect_accounts; b prospect_accounts; k text; diff jsonb := '{}';
 allowed constant text[] := array['sdr', 'campaign', 'zone', 'priority', 'next_action', 'due_at', 'due_precision', 'decision_maker', 'decision_maker_role', 'team_notes', 'stage', 'score', 'score_components', 'scoring_version'];
begin
 select * into a from prospect_accounts where id=p_account for update;
 if not found then raise exception 'ACCOUNT_NOT_FOUND'; end if;
 if a.version<>p_version then raise exception 'STALE'; end if;
 for k in select jsonb_object_keys(p_patch) loop
  if not k = any(allowed) then raise exception 'INVALID_FIELD:%', k; end if;
 end loop;
 if p_patch ? 'stage' and p_patch->>'stage' not in ('discarded', 'pending') then raise exception 'INVALID_STAGE'; end if;
 if p_patch ? 'score_components' and jsonb_typeof(p_patch->'score_components') <> 'object' then raise exception 'INVALID_FIELD:score_components'; end if;
 update prospect_accounts set
  sdr=case when p_patch ? 'sdr' then nullif(btrim(p_patch->>'sdr'), '') else sdr end,
  campaign=case when p_patch ? 'campaign' then nullif(btrim(p_patch->>'campaign'), '') else campaign end,
  zone=case when p_patch ? 'zone' then nullif(btrim(p_patch->>'zone'), '') else zone end,
  priority=case when p_patch ? 'priority' then nullif(btrim(p_patch->>'priority'), '') else priority end,
  next_action=case when p_patch ? 'next_action' then nullif(btrim(p_patch->>'next_action'), '') else next_action end,
  due_at=case when p_patch ? 'due_at' then (p_patch->>'due_at')::timestamptz else due_at end,
  due_precision=case when p_patch ? 'due_precision' then p_patch->>'due_precision' else due_precision end,
  decision_maker=case when p_patch ? 'decision_maker' then nullif(btrim(p_patch->>'decision_maker'), '') else decision_maker end,
  decision_maker_role=case when p_patch ? 'decision_maker_role' then nullif(btrim(p_patch->>'decision_maker_role'), '') else decision_maker_role end,
  team_notes=case when p_patch ? 'team_notes' then nullif(p_patch->>'team_notes', '') else team_notes end,
  stage=case when p_patch->>'stage'='discarded' then 'discarded'
   when p_patch->>'stage'='pending' and stage='discarded' then habita_prospect_derived_stage(p_account) else stage end,
  score=case when p_patch ? 'score' then (p_patch->>'score')::numeric else score end,
  score_components=case when p_patch ? 'score_components' then p_patch->'score_components' else score_components end,
  scoring_version=case when p_patch ? 'scoring_version' then nullif(btrim(p_patch->>'scoring_version'), '') else scoring_version end,
  version=version+1
 where id=p_account returning * into b;
 for k in select jsonb_object_keys(p_patch) loop
  if to_jsonb(a)->k is distinct from to_jsonb(b)->k then
   diff := diff || jsonb_build_object(k, jsonb_build_object('from', to_jsonb(a)->k, 'to', to_jsonb(b)->k));
  end if;
 end loop;
 if diff ?| array['score', 'score_components', 'scoring_version'] then
  insert into prospect_events(account_id, type, occurred_at, actor, source, details)
   values (p_account, 'score_changed', now(), p_actor, 'manual', jsonb_build_object('changes', diff));
 elsif diff <> '{}' then
  insert into prospect_events(account_id, type, occurred_at, actor, source, details)
   values (p_account, 'account_updated', now(), p_actor, 'manual', jsonb_build_object('changes', diff));
 end if;
 return to_jsonb(b);
end $$;

-- Adds or edits a commercial contact. Changing the address of a contact that
-- has attempts creates a new contact instead, so history keeps the original.
create or replace function public.habita_prospect_contact(p_actor uuid, p_account uuid, p_contact uuid, p_fields jsonb)
 returns jsonb language plpgsql security definer set search_path=public as $$
declare c prospect_contacts; old prospect_contacts; ch text := p_fields->>'channel'; addr text := nullif(btrim(coalesce(p_fields->>'address', '')), '');
begin
 perform 1 from prospect_accounts where id=p_account for update;
 if not found then raise exception 'ACCOUNT_NOT_FOUND'; end if;
 if p_contact is not null then
  select * into old from prospect_contacts where id=p_contact and account_id=p_account for update;
  if not found then raise exception 'CONTACT_NOT_FOUND'; end if;
  ch := coalesce(ch, old.channel);
  if not (p_fields ? 'address') then addr := old.address; end if;
 end if;
 if ch is null or ch not in ('whatsapp', 'email', 'phone', 'instagram', 'web', 'other') then raise exception 'INVALID_CHANNEL'; end if;
 if old.id is not null and (addr is distinct from old.address or ch<>old.channel)
   and exists (select 1 from outreach_attempts where contact_id=old.id) then
  p_contact := null;
 end if;
 if (p_fields->>'is_primary')::boolean is true then
  update prospect_contacts set is_primary=false where account_id=p_account and is_primary and id is distinct from p_contact;
 end if;
 if p_contact is null then
  insert into prospect_contacts(account_id, person_name, role, is_decision_maker, channel, address, address_original, confidence, source, source_url,
    needs_review, review_reason, verified_at, verified_by, is_primary, created_by)
   values (p_account, nullif(btrim(coalesce(p_fields->>'person_name', '')), ''), nullif(btrim(coalesce(p_fields->>'role', '')), ''),
    coalesce((p_fields->>'is_decision_maker')::boolean, false), ch, addr,
    coalesce(nullif(p_fields->>'address_original', ''), addr), nullif(p_fields->>'confidence', ''), nullif(p_fields->>'source', ''), nullif(p_fields->>'source_url', ''),
    coalesce((p_fields->>'needs_review')::boolean, false), nullif(p_fields->>'review_reason', ''),
    case when (p_fields->>'verified')::boolean then now() end, case when (p_fields->>'verified')::boolean then p_actor end,
    coalesce((p_fields->>'is_primary')::boolean, false), p_actor)
   returning * into c;
 else
  update prospect_contacts set
   person_name=case when p_fields ? 'person_name' then nullif(btrim(p_fields->>'person_name'), '') else person_name end,
   role=case when p_fields ? 'role' then nullif(btrim(p_fields->>'role'), '') else role end,
   is_decision_maker=coalesce((p_fields->>'is_decision_maker')::boolean, is_decision_maker),
   channel=ch, address=addr,
   confidence=case when p_fields ? 'confidence' then nullif(p_fields->>'confidence', '') else confidence end,
   source=case when p_fields ? 'source' then nullif(p_fields->>'source', '') else source end,
   source_url=case when p_fields ? 'source_url' then nullif(p_fields->>'source_url', '') else source_url end,
   needs_review=case when (p_fields->>'verified')::boolean then false else coalesce((p_fields->>'needs_review')::boolean, needs_review) end,
   review_reason=case when (p_fields->>'verified')::boolean then null else review_reason end,
   verified_at=case when (p_fields->>'verified')::boolean then now() else verified_at end,
   verified_by=case when (p_fields->>'verified')::boolean then p_actor else verified_by end,
   invalid_at=case when p_fields ? 'invalid' then case when (p_fields->>'invalid')::boolean then coalesce(invalid_at, now()) end else invalid_at end,
   invalid_reason=case when p_fields ? 'invalid' then case when (p_fields->>'invalid')::boolean then coalesce(nullif(p_fields->>'invalid_reason', ''), invalid_reason, 'Marcado inválido') end else invalid_reason end,
   is_primary=coalesce((p_fields->>'is_primary')::boolean, is_primary)
  where id=p_contact returning * into c;
 end if;
 insert into prospect_events(account_id, contact_id, type, occurred_at, actor, source, channel, details)
  values (p_account, c.id, 'contact_changed', now(), p_actor, 'manual', c.channel,
   jsonb_build_object('replaces', case when old.id is not null and old.id<>c.id then old.id end,
    'verified', c.verified_at is not null, 'invalid', c.invalid_at is not null));
 return to_jsonb(c);
exception when unique_violation then raise exception 'CONTACT_EXISTS';
end $$;

-- New template, or a new immutable version of an existing one.
create or replace function public.habita_prospect_template(p_actor uuid, p_template uuid, p_name text, p_purpose text, p_step integer, p_channel text, p_subject text, p_body text)
 returns jsonb language plpgsql security definer set search_path=public as $$
declare t outreach_templates; v outreach_template_versions; n integer;
begin
 if p_body is null or length(btrim(p_body)) = 0 then raise exception 'INVALID_BODY'; end if;
 if p_template is null then
  if p_channel not in ('whatsapp', 'email') then raise exception 'INVALID_CHANNEL'; end if;
  if p_step not between 0 and 3 then raise exception 'INVALID_STEP'; end if;
  insert into outreach_templates(name, purpose, step, channel, created_by)
   values (btrim(p_name), nullif(btrim(coalesce(p_purpose, '')), ''), p_step, p_channel, p_actor) returning * into t;
 else
  select * into t from outreach_templates where id=p_template for update;
  if not found then raise exception 'TEMPLATE_NOT_FOUND'; end if;
 end if;
 if t.channel='email' and (p_subject is null or length(btrim(p_subject)) = 0) then raise exception 'SUBJECT_REQUIRED'; end if;
 select coalesce(max(version), 0) + 1 into n from outreach_template_versions where template_id=t.id;
 insert into outreach_template_versions(template_id, version, subject, body, created_by)
  values (t.id, n, nullif(btrim(coalesce(p_subject, '')), ''), p_body, p_actor) returning * into v;
 return to_jsonb(v) || jsonb_build_object('template', to_jsonb(t));
exception when unique_violation then raise exception 'TEMPLATE_EXISTS';
end $$;

-- Activation and first purchase, read from the server's own tables and only
-- for agencies with a verified link to accounts (agency_members, created by
-- the agency itself or by a one-time claim code). Cookies, UTMs and demo
-- views are never evidence. Idempotent: run before every read.
--  * activated: first succeeded generation by a member, made after joining,
--    that is the preferred version of a photo of that agency.
--  * purchased: first payment of a member after joining that the provider
--    approved (refunds keep the purchase and add a 'refunded' event).
create or replace function public.habita_prospect_sync_conversions() returns integer
 language plpgsql security definer set search_path=public as $$
declare n integer := 0; k integer;
begin
 insert into prospect_events(account_id, type, occurred_at, source, evidence_ref, details)
 select distinct on (pa.id) pa.id, 'activated', coalesce(g.finished_at, g.created_at), 'server', 'generation:' || g.id,
   jsonb_build_object('generation', g.id, 'photo', dp.id)
  from prospect_accounts pa
  join agency_members m on m.agency_id=pa.agency_id
  join generations g on g.user_id=m.user_id and g.status='succeeded' and g.created_at >= m.created_at
  join demo_photos dp on dp.approved_generation_id=g.id
  join demo_properties p on p.id=dp.property_id and p.agency_id=pa.agency_id
  where not exists (select 1 from prospect_events e where e.account_id=pa.id and e.type='activated')
  order by pa.id, coalesce(g.finished_at, g.created_at)
 on conflict do nothing;
 get diagnostics k = row_count; n := n + k;
 insert into prospect_events(account_id, type, occurred_at, source, evidence_ref, details)
 select distinct on (pa.id) pa.id, 'purchased', coalesce(py.paid_at, py.created_at), 'server', 'payment:' || py.id,
   jsonb_build_object('payment', py.id, 'amount_cents', py.amount_cents)
  from prospect_accounts pa
  join agency_members m on m.agency_id=pa.agency_id
  join payments py on py.user_id=m.user_id and py.paid_at is not null and py.paid_at >= m.created_at
   and py.status in ('approved', 'partially_refunded', 'refunded', 'charged_back', 'in_mediation')
  where not exists (select 1 from prospect_events e where e.account_id=pa.id and e.type='purchased')
  order by pa.id, coalesce(py.paid_at, py.created_at)
 on conflict do nothing;
 get diagnostics k = row_count; n := n + k;
 insert into prospect_events(account_id, type, occurred_at, source, evidence_ref, details)
 select pa.id, 'refunded', now(), 'server', 'refund:' || py.id, jsonb_build_object('payment', py.id, 'status', py.status, 'occurred_at', 'detected')
  from prospect_accounts pa
  join agency_members m on m.agency_id=pa.agency_id
  join payments py on py.user_id=m.user_id and py.paid_at >= m.created_at and py.status in ('refunded', 'charged_back')
 on conflict do nothing;
 get diagnostics k = row_count; n := n + k;
 update prospect_accounts pa set stage=x.stage, version=version+1
  from (select id, habita_prospect_derived_stage(id) as stage from prospect_accounts where stage not in ('lost', 'discarded', 'customer')) x
  where pa.id=x.id and pa.stage<>x.stage and x.stage in ('activated', 'customer');
 return n;
end $$;

-- Applies a reviewed import. Rows are matched by (source, source_key): a
-- second run updates the source fields and never duplicates accounts,
-- contacts or legacy sends. Operational fields (SDR, next action, stage) are
-- only overwritten when p_overwrite is true. Idempotent per import id.
create or replace function public.habita_prospect_import(p_actor uuid, p_import uuid, p_source text, p_file_name text, p_file_hash text, p_mapping jsonb, p_rows jsonb, p_overwrite boolean)
 returns jsonb language plpgsql security definer set search_path=public as $$
declare imp prospect_imports; r jsonb; acc prospect_accounts; ag uuid; ct jsonb; v_outcome text; msgs jsonb; v_created integer := 0; v_updated integer := 0;
 v_unchanged integer := 0; v_conflicts integer := 0; v_legacy integer := 0; v_contacts integer := 0; k integer; sent_day date; cid uuid; before jsonb; v_report jsonb;
 lkey text; att uuid;
begin
 select * into imp from prospect_imports where id=p_import;
 if found then
  if imp.status='applied' then return imp.report || jsonb_build_object('replayed', true); end if;
  raise exception 'IMPORT_IN_PROGRESS';
 end if;
 if p_source is null or length(btrim(p_source)) = 0 then raise exception 'INVALID_SOURCE'; end if;
 if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then raise exception 'INVALID_ROWS'; end if;
 insert into prospect_imports(id, source, file_name, file_hash, mapping, created_by) values (p_import, btrim(p_source), p_file_name, p_file_hash, coalesce(p_mapping, '{}'), p_actor);
 for r in select * from jsonb_array_elements(p_rows) loop
  msgs := '[]';
  if coalesce(btrim(r->>'source_key'), '') = '' or coalesce(btrim(r->>'name'), '') = '' then
   insert into prospect_import_rows(import_id, row_number, source_key, outcome, messages, raw)
    values (p_import, (r->>'row_number')::int, coalesce(r->>'source_key', ''), 'error', '["Falta el nombre o la clave de la fila"]', coalesce(r->'raw', '{}'));
   continue;
  end if;
  select * into acc from prospect_accounts where source=btrim(p_source) and source_key=r->>'source_key' for update;
  if found then
   before := jsonb_build_object('score', acc.score, 'score_components', acc.score_components, 'source_notes', acc.source_notes, 'source_data', acc.source_data,
    'zone', acc.zone, 'address', acc.address, 'priority', acc.priority, 'decision_maker', acc.decision_maker);
   update prospect_accounts set
    score=(r->>'score')::numeric, score_components=coalesce(r->'score_components', '{}'), scoring_version=coalesce(r->>'scoring_version', scoring_version),
    priority=r->>'priority', zone=r->>'zone', address=r->>'address', source_notes=r->>'notes', source_data=coalesce(r->'raw', '{}'),
    decision_maker=coalesce(decision_maker, r->>'decision_maker'),
    sdr=case when p_overwrite then r->>'sdr' else coalesce(sdr, r->>'sdr') end,
    campaign=case when p_overwrite then r->>'campaign' else coalesce(campaign, r->>'campaign') end,
    last_import_id=p_import, imported_at=now(), version=version+1
   where id=acc.id;
   if before is distinct from jsonb_build_object('score', (r->>'score')::numeric, 'score_components', coalesce(r->'score_components', '{}'),
     'source_notes', r->>'notes', 'source_data', coalesce(r->'raw', '{}'), 'zone', r->>'zone', 'address', r->>'address', 'priority', r->>'priority',
     'decision_maker', coalesce(acc.decision_maker, r->>'decision_maker')) then
    v_outcome := 'updated'; v_updated := v_updated + 1;
    insert into prospect_events(account_id, type, occurred_at, actor, source, details)
     values (acc.id, 'imported', now(), p_actor, 'import', jsonb_build_object('import', p_import, 'row', r->'row_number', 'previous', before));
   else
    v_outcome := 'unchanged'; v_unchanged := v_unchanged + 1;
   end if;
  else
   ag := nullif(r->>'agency_id', '')::uuid;
   if ag is not null then
    if not exists (select 1 from agencies where id=ag) then
     insert into prospect_import_rows(import_id, row_number, source_key, outcome, messages, raw)
      values (p_import, (r->>'row_number')::int, r->>'source_key', 'error', '["La inmobiliaria elegida no existe"]', coalesce(r->'raw', '{}'));
     continue;
    end if;
    if exists (select 1 from prospect_accounts where agency_id=ag) then
     v_conflicts := v_conflicts + 1;
     insert into prospect_import_rows(import_id, row_number, source_key, account_id, outcome, messages, raw)
      values (p_import, (r->>'row_number')::int, r->>'source_key', (select id from prospect_accounts where agency_id=ag), 'conflict',
       '["La inmobiliaria ya está en la base desde otra fila u origen: revisá la fusión a mano"]', coalesce(r->'raw', '{}'));
     continue;
    end if;
   else
    insert into agencies(name, website, created_by) values (left(btrim(r->>'name'), 120), left(nullif(r->>'website', ''), 300), p_actor) returning id into ag;
   end if;
   insert into prospect_accounts(agency_id, source, source_key, campaign, sdr, priority, score, score_components, scoring_version, zone, address,
     decision_maker, source_notes, source_data, imported_at, last_import_id, created_by)
    values (ag, btrim(p_source), r->>'source_key', r->>'campaign', r->>'sdr', r->>'priority', (r->>'score')::numeric, coalesce(r->'score_components', '{}'),
     r->>'scoring_version', r->>'zone', r->>'address', r->>'decision_maker', r->>'notes', coalesce(r->'raw', '{}'), now(), p_import, p_actor)
    returning * into acc;
   insert into prospect_events(account_id, type, occurred_at, actor, source, details)
    values (acc.id, 'imported', now(), p_actor, 'import', jsonb_build_object('import', p_import, 'row', r->'row_number', 'status', r->>'legacy_status'));
   v_outcome := 'created'; v_created := v_created + 1;
  end if;
  -- Contacts: added when new; existing ones (same channel and address) are kept as they are.
  for ct in select * from jsonb_array_elements(coalesce(r->'contacts', '[]')) loop
   cid := null;
   if ct->>'address' is not null then
    select id into cid from prospect_contacts where account_id=acc.id and channel=ct->>'channel' and address=ct->>'address';
   else
    select id into cid from prospect_contacts where account_id=acc.id and channel=ct->>'channel' and address is null and address_original=ct->>'address_original';
   end if;
   if cid is null then
    insert into prospect_contacts(account_id, person_name, is_decision_maker, channel, address, address_original, confidence, source, source_url,
      needs_review, review_reason, invalid_at, invalid_reason, is_primary, created_by)
     values (acc.id, ct->>'person_name', coalesce((ct->>'is_decision_maker')::boolean, false), ct->>'channel', ct->>'address', ct->>'address_original',
      ct->>'confidence', ct->>'source', ct->>'source_url', coalesce((ct->>'needs_review')::boolean, false), ct->>'review_reason',
      case when (ct->>'invalid')::boolean then now() end, case when (ct->>'invalid')::boolean then ct->>'invalid_reason' end,
      coalesce((ct->>'is_primary')::boolean, false) and not exists (select 1 from prospect_contacts where account_id=acc.id and is_primary), p_actor)
     returning id into cid;
    v_contacts := v_contacts + 1;
   elsif (ct->>'invalid')::boolean then
    -- "Número incorrecto" in the sheet invalidates that endpoint only.
    update prospect_contacts set invalid_at=coalesce(invalid_at, now()), invalid_reason=coalesce(invalid_reason, ct->>'invalid_reason'), is_primary=false where id=cid;
   end if;
  end loop;
  -- A legacy "Enviado" with a date: one send with day precision, channel and variant unknown.
  sent_day := nullif(r->>'sent_date', '')::date;
  if r->>'legacy_status'='sent' then
   lkey := btrim(p_source) || ':' || (r->>'source_key') || ':sent:' || coalesce(sent_day::text, 'sin-fecha');
   if sent_day is not null and not exists (select 1 from outreach_attempts o where o.legacy_key=lkey) then
    select count(*) into k from outreach_attempts where account_id=acc.id and status in ('sent', 'bounced');
    insert into outreach_attempts(idempotency_key, legacy_key, account_id, campaign, step, ordinal, variant_label, channel, status, prepared_at, prepared_by,
      sent_at, sent_precision, confirmed_at, confirmed_by, verification_method, legacy, evidence)
     values (gen_random_uuid(), lkey, acc.id, coalesce(r->>'campaign', 'general'), 1, k + 1, null, 'unknown', 'sent',
      (sent_day::text || ' 00:00:00-03')::timestamptz, p_actor, (sent_day::text || ' 00:00:00-03')::timestamptz, 'day', now(), p_actor, 'imported', true,
      left('Planilla: ' || coalesce(r->>'notes', ''), 500))
     returning id into att;
    insert into prospect_events(account_id, attempt_id, type, occurred_at, occurred_precision, actor, source, channel, details)
     values (acc.id, att, 'sent', (sent_day::text || ' 00:00:00-03')::timestamptz, 'day', p_actor, 'import', 'unknown',
      jsonb_build_object('legacy', true, 'import', p_import, 'variant', null));
    perform habita_prospect_advance(acc.id, 'sent');
    v_legacy := v_legacy + 1;
   elsif sent_day is null then
    msgs := msgs || '["Figura como Enviado sin fecha: no se registró un envío"]';
   end if;
  end if;
  insert into prospect_import_rows(import_id, row_number, source_key, account_id, outcome, messages, raw)
   values (p_import, (r->>'row_number')::int, r->>'source_key', acc.id, v_outcome, msgs || coalesce(r->'messages', '[]'), coalesce(r->'raw', '{}'));
 end loop;
 v_report := jsonb_build_object('import', p_import, 'created', v_created, 'updated', v_updated, 'unchanged', v_unchanged, 'conflicts', v_conflicts,
  'errors', (select count(*) from prospect_import_rows where import_id=p_import and outcome='error'), 'legacy_sends', v_legacy, 'contacts', v_contacts);
 update prospect_imports set status='applied', applied_at=now(), report=v_report where id=p_import;
 return v_report;
end $$;

-- Adds an agency to the base: an existing one (by id) or a new one by name.
-- An agency is in the base once; adding it again returns its account.
create or replace function public.habita_prospect_add(p_actor uuid, p_agency uuid, p_name text, p_website text, p_sdr text, p_campaign text, p_zone text)
 returns jsonb language plpgsql security definer set search_path=public as $$
declare a prospect_accounts; ag uuid := p_agency;
begin
 if ag is null then
  if p_name is null or length(btrim(p_name)) not between 1 and 120 then raise exception 'INVALID_NAME'; end if;
  insert into agencies(name, website, created_by) values (btrim(p_name), nullif(btrim(coalesce(p_website, '')), ''), p_actor) returning id into ag;
 elsif not exists (select 1 from agencies where id=ag) then raise exception 'AGENCY_NOT_FOUND';
 end if;
 select * into a from prospect_accounts where agency_id=ag;
 if found then return to_jsonb(a) || jsonb_build_object('replayed', true); end if;
 insert into prospect_accounts(agency_id, sdr, campaign, zone, created_by)
  values (ag, nullif(btrim(coalesce(p_sdr, '')), ''), nullif(btrim(coalesce(p_campaign, '')), ''), nullif(btrim(coalesce(p_zone, '')), ''), p_actor)
  returning * into a;
 return to_jsonb(a);
end $$;

-- One account with its full history, for the account sheet.
create or replace function public.habita_prospect_account(p_account uuid) returns jsonb
 language sql stable security definer set search_path=public as $$
 select case when pa.id is null then null else jsonb_build_object(
  'account', to_jsonb(pa),
  'agency', jsonb_build_object('id', ag.id, 'name', ag.name, 'website', ag.website, 'linked', ag.owner_id is not null, 'claimedAt', ag.claimed_at),
  'contacts', coalesce((select jsonb_agg(to_jsonb(c) order by c.is_primary desc, c.created_at) from prospect_contacts c where c.account_id=pa.id), '[]'),
  'events', coalesce((select jsonb_agg(to_jsonb(e) order by e.occurred_at desc, e.recorded_at desc)
    from (select * from prospect_events where account_id=pa.id order by occurred_at desc, recorded_at desc limit 300) e), '[]'),
  'attempts', coalesce((select jsonb_agg(to_jsonb(a) order by a.prepared_at desc)
    from (select * from outreach_attempts where account_id=pa.id order by prepared_at desc limit 100) a), '[]'),
  'suppressions', coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at desc) from prospect_suppressions s where s.account_id=pa.id), '[]'),
  'demos', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'token', d.token, 'status', d.status, 'published_at', d.published_at,
    'created_at', d.created_at, 'title', p.title) order by d.created_at desc)
    from demos d join demo_properties p on p.id=d.property_id where d.agency_id=pa.agency_id), '[]'))
 end
 from (select 1) one left join prospect_accounts pa on pa.id=p_account left join agencies ag on ag.id=pa.agency_id
$$;

-- Agencies with their prospecting key, for import matches.
create or replace function public.habita_prospect_agencies() returns jsonb
 language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(jsonb_build_object('id', ag.id, 'name', ag.name, 'website', ag.website, 'account_id', pa.id,
   'source', pa.source, 'source_key', pa.source_key) order by ag.created_at), '[]')
 from agencies ag left join prospect_accounts pa on pa.agency_id=ag.id
$$;

-- What the server needs to render a template version for an account.
create or replace function public.habita_prospect_context(p_account uuid, p_version uuid) returns jsonb
 language sql stable security definer set search_path=public as $$
 select jsonb_build_object('body', v.body, 'subject', v.subject, 'name', ag.name, 'decision_maker', pa.decision_maker, 'sdr', pa.sdr,
  'demo_token', (select d.token from demos d where d.agency_id=pa.agency_id and d.status='published' order by d.published_at desc nulls last limit 1))
 from prospect_accounts pa join agencies ag on ag.id=pa.agency_id join outreach_template_versions v on v.id=p_version
 where pa.id=p_account
$$;

-- Everything the team's panel needs in one read, as JSON (no row limit).
-- Private: only service_role can execute it, after requireAdmin.
create or replace function public.habita_prospect_dataset() returns jsonb
 language sql stable security definer set search_path=public as $$
 select jsonb_build_object(
  'now', now(),
  'settings', (select to_jsonb(s) from prospect_metric_settings s order by version desc limit 1),
  'accounts', coalesce((select jsonb_agg(jsonb_build_object(
    'id', pa.id, 'agency_id', pa.agency_id, 'name', ag.name, 'website', ag.website, 'linked', ag.owner_id is not null,
    'campaign', pa.campaign, 'sdr', pa.sdr, 'priority', pa.priority, 'score', pa.score, 'score_components', pa.score_components,
    'scoring_version', pa.scoring_version, 'zone', pa.zone, 'decision_maker', pa.decision_maker, 'decision_maker_role', pa.decision_maker_role,
    'stage', pa.stage, 'lost_reason', pa.lost_reason, 'next_action', pa.next_action, 'due_at', pa.due_at, 'due_precision', pa.due_precision,
    'version', pa.version, 'created_at', pa.created_at, 'imported', pa.source is not null,
    'demos', (select count(*) from demos d where d.agency_id=pa.agency_id),
    'suppressed', habita_prospect_blocked(pa.id, null, null) is not null,
    'contacts', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'channel', c.channel, 'address', c.address, 'address_original', c.address_original,
       'person_name', c.person_name, 'is_decision_maker', c.is_decision_maker, 'confidence', c.confidence, 'source', c.source,
       'needs_review', c.needs_review, 'review_reason', c.review_reason, 'verified', c.verified_at is not null, 'invalid', c.invalid_at is not null,
       'is_primary', c.is_primary, 'blocked', habita_prospect_blocked(pa.id, c.id, c.channel)) order by c.is_primary desc, c.created_at)
      from prospect_contacts c where c.account_id=pa.id), '[]')
   ) order by pa.created_at) from prospect_accounts pa join agencies ag on ag.id=pa.agency_id), '[]'),
  'attempts', coalesce((select jsonb_agg(jsonb_build_object(
    'id', a.id, 'account_id', a.account_id, 'contact_id', a.contact_id, 'campaign', a.campaign, 'step', a.step, 'ordinal', a.ordinal,
    'template_version_id', a.template_version_id, 'template_id', v.template_id, 'is_custom', a.is_custom, 'variant_label', a.variant_label,
    'channel', a.channel, 'recipient', a.recipient, 'sender', a.sender, 'subject', a.subject, 'body', a.body, 'status', a.status,
    'status_reason', a.status_reason, 'prepared_at', a.prepared_at, 'opened_at', a.opened_at, 'lock_holder', a.lock_holder,
    'lock_expires_at', a.lock_expires_at, 'sent_at', a.sent_at, 'sent_precision', a.sent_precision, 'verification_method', a.verification_method,
    'legacy', a.legacy, 'version', a.version) order by a.prepared_at)
   from outreach_attempts a left join outreach_template_versions v on v.id=a.template_version_id), '[]'),
  'events', coalesce((select jsonb_agg(jsonb_build_object(
    'id', e.id, 'account_id', e.account_id, 'attempt_id', e.attempt_id, 'type', e.type, 'occurred_at', e.occurred_at,
    'precision', e.occurred_precision, 'channel', e.channel, 'human', e.human, 'source', e.source, 'details', e.details,
    'corrected', exists (select 1 from prospect_events c where c.corrects_event_id=e.id)) order by e.occurred_at)
   from prospect_events e where e.type in ('reply', 'auto_reply', 'interest', 'not_interested', 'meeting', 'lost', 'activated', 'purchased', 'refunded')), '[]'),
  'templates', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'purpose', t.purpose, 'step', t.step, 'channel', t.channel,
    'archived', t.archived_at is not null,
    'versions', (select jsonb_agg(jsonb_build_object('id', v.id, 'version', v.version, 'subject', v.subject, 'body', v.body, 'created_at', v.created_at) order by v.version desc)
      from outreach_template_versions v where v.template_id=t.id)) order by t.step, t.channel, t.name)
   from outreach_templates t), '[]'),
  'last_import', (select jsonb_build_object('id', i.id, 'source', i.source, 'file_name', i.file_name, 'applied_at', i.applied_at, 'report', i.report)
   from prospect_imports i where i.status='applied' order by i.applied_at desc limit 1)
 )
$$;

do $$ declare f text; begin
 foreach f in array array[
  'habita_prospect_append_only()', 'habita_prospect_blocked(uuid,uuid,text)', 'habita_prospect_replied(uuid)', 'habita_prospect_derived_stage(uuid)',
  'habita_prospect_advance(uuid,text)',
  'habita_prospect_prepare(uuid,uuid,uuid,uuid,integer,text,uuid,boolean,text,text,text,boolean)',
  'habita_prospect_open(uuid,uuid,integer,integer)', 'habita_prospect_confirm(uuid,uuid,text,timestamptz,text,text)',
  'habita_prospect_resolve(uuid,uuid,text,text)',
  'habita_prospect_record(uuid,uuid,uuid,text,timestamptz,text,text,uuid,uuid,text,jsonb,uuid)',
  'habita_prospect_suppress(uuid,uuid,text,text,uuid,text)', 'habita_prospect_lift(uuid,uuid,text)',
  'habita_prospect_update(uuid,uuid,integer,jsonb)', 'habita_prospect_contact(uuid,uuid,uuid,jsonb)',
  'habita_prospect_template(uuid,uuid,text,text,integer,text,text,text)', 'habita_prospect_sync_conversions()',
  'habita_prospect_import(uuid,uuid,text,text,text,jsonb,jsonb,boolean)', 'habita_prospect_dataset()',
  'habita_prospect_add(uuid,uuid,text,text,text,text,text)', 'habita_prospect_account(uuid)', 'habita_prospect_agencies()',
  'habita_prospect_context(uuid,uuid)'] loop
  execute format('revoke all on function public.%s from public, anon, authenticated', f);
  execute format('grant execute on function public.%s to service_role', f);
 end loop;
end $$;
commit;
