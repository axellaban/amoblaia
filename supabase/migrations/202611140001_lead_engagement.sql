-- Lead Engagement Score (lead_score_v1). See docs/LEAD_SCORE.md.
--
-- * lead_events: the normalized events of the demos, the source of truth.
--   One row per event_id: a retried or repeated delivery is ignored, except
--   active time, whose row keeps the largest cumulative value of its page view.
-- * lead_visitor_scores: the score of each visitor on each demo, computed by
--   the server (src/lib/leads/score.ts) from lead_events and replaced whole
--   for a demo on each recalculation. The panel reads only this table, so it
--   loads without going through the events.
-- * lead_internal_visitors: browsers the team marked as its own (who, when).
--   Their events stay for QA; they never count in the commercial score.
--
-- Only the server (service_role) reads or writes. Additive and idempotent:
-- nothing existing is changed or deleted, and running it again changes nothing.
begin;

create table if not exists public.lead_events (
 event_id text primary key check (length(event_id) between 1 and 120),
 event_name text not null check (event_name in (
  'demo_opened','demo_style_selected','demo_photo_selected','demo_comparison_used','demo_active_time',
  'demo_agency_cta_clicked','demo_pricing_viewed','demo_signup_started','demo_contact_requested',
  'demo_generation_started','demo_generation_completed','demo_property_import_started',
  'demo_property_import_completed','demo_account_created')),
 event_version smallint not null default 1,
 occurred_at timestamptz not null,
 received_at timestamptz not null default now(),
 demo_id uuid not null references public.demos(id) on delete cascade,
 agency_id uuid,
 visitor_id text not null check (length(visitor_id) between 1 and 120),
 session_id text check (session_id is null or length(session_id) <= 120),
 ph_device_id text check (ph_device_id is null or length(ph_device_id) <= 120),
 view_id text check (view_id is null or length(view_id) <= 80),
 style_id text check (style_id is null or length(style_id) <= 40),
 photo_id text check (photo_id is null or length(photo_id) <= 80),
 generation_id text check (generation_id is null or length(generation_id) <= 80),
 property_id text check (property_id is null or length(property_id) <= 80),
 value bigint check (value is null or value >= 0),
 source text not null check (source in ('client','server','backfill')),
 visitor_type text check (visitor_type is null or visitor_type in ('internal','agency','buyer','unknown')),
 is_internal boolean not null default false,
 internal_reason text check (internal_reason is null or length(internal_reason) <= 40),
 identity text not null default 'anonymous' check (identity in ('identified','linked','anonymous')),
 quality text not null default 'complete' check (quality in ('complete','partial','insufficient')),
 link_type text check (link_type is null or length(link_type) <= 40),
 user_id uuid
);
create index if not exists lead_events_demo on public.lead_events(demo_id, occurred_at);
create index if not exists lead_events_visitor on public.lead_events(visitor_id);
create index if not exists lead_events_device on public.lead_events(ph_device_id) where ph_device_id is not null;

create table if not exists public.lead_visitor_scores (
 demo_id uuid not null references public.demos(id) on delete cascade,
 visitor_id text not null check (length(visitor_id) between 1 and 120),
 agency_id uuid,
 score smallint not null check (score between 0 and 100),
 classification text not null,
 score_version text not null,
 visual_score smallint not null default 0,
 depth_score smallint not null default 0,
 commercial_score smallint not null default 0,
 activation_score smallint not null default 0,
 recurrence_score smallint not null default 0,
 score_breakdown jsonb not null default '{}'::jsonb,
 explanation text not null default '',
 signals text[] not null default '{}',
 aliases text[] not null default '{}',
 sessions text[] not null default '{}',
 events integer not null default 0,
 calculated_at timestamptz not null default now(),
 first_event_at timestamptz,
 last_event_at timestamptz,
 last_qualifying_event_at timestamptz,
 attribution_confidence text not null default 'anonymous' check (attribution_confidence in ('identified','linked','anonymous')),
 visitor_type text not null default 'unknown',
 is_internal boolean not null default false,
 internal_reasons text[] not null default '{}',
 score_data_quality text not null default 'complete' check (score_data_quality in ('complete','partial','insufficient')),
 primary key (demo_id, visitor_id)
);
create index if not exists lead_visitor_scores_agency on public.lead_visitor_scores(agency_id);

create table if not exists public.lead_internal_visitors (
 visitor_id text primary key check (length(visitor_id) between 1 and 120),
 reason text not null default 'manual' check (length(reason) <= 40),
 note text check (note is null or length(note) <= 200),
 marked_by uuid,
 marked_at timestamptz not null default now()
);

alter table public.lead_events enable row level security;
alter table public.lead_visitor_scores enable row level security;
alter table public.lead_internal_visitors enable row level security;
revoke all on public.lead_events from anon, authenticated;
revoke all on public.lead_visitor_scores from anon, authenticated;
revoke all on public.lead_internal_visitors from anon, authenticated;

-- Stores a batch of normalized events. A known event_id changes nothing,
-- except active time, which keeps the largest value reported for its view.
create or replace function public.habita_lead_record(p_events jsonb) returns integer language plpgsql security definer set search_path=public as $$
declare stored integer;
begin
 if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) > 200 then raise exception 'INVALID_LEAD_EVENTS'; end if;
 insert into lead_events(event_id,event_name,event_version,occurred_at,demo_id,agency_id,visitor_id,session_id,ph_device_id,view_id,
  style_id,photo_id,generation_id,property_id,value,source,visitor_type,is_internal,internal_reason,identity,quality,link_type,user_id)
 -- The same id twice in one batch (a retry queued with the original): keep its largest value.
 select distinct on (e.event_id) e.event_id,e.event_name,coalesce(e.event_version,1),e.occurred_at,e.demo_id,e.agency_id,e.visitor_id,e.session_id,e.ph_device_id,e.view_id,
  e.style_id,e.photo_id,e.generation_id,e.property_id,e.value,e.source,e.visitor_type,coalesce(e.is_internal,false),e.internal_reason,
  coalesce(e.identity,'anonymous'),coalesce(e.quality,'complete'),e.link_type,e.user_id
 from jsonb_to_recordset(p_events) as e(event_id text,event_name text,event_version smallint,occurred_at timestamptz,demo_id uuid,agency_id uuid,
  visitor_id text,session_id text,ph_device_id text,view_id text,style_id text,photo_id text,generation_id text,property_id text,value bigint,
  source text,visitor_type text,is_internal boolean,internal_reason text,identity text,quality text,link_type text,user_id uuid)
 order by e.event_id, e.value desc nulls last, e.occurred_at
 on conflict (event_id) do update set
  value = greatest(lead_events.value, excluded.value),
  occurred_at = greatest(lead_events.occurred_at, excluded.occurred_at)
 where lead_events.event_name = 'demo_active_time' and coalesce(excluded.value,0) > coalesce(lead_events.value,0);
 get diagnostics stored = row_count;
 return stored;
end $$;

-- Replaces every visitor score of one demo at once (a recalculation is whole, never partial).
create or replace function public.habita_lead_replace_scores(p_demo uuid, p_rows jsonb) returns integer language plpgsql security definer set search_path=public as $$
declare stored integer;
begin
 if jsonb_typeof(p_rows) <> 'array' then raise exception 'INVALID_LEAD_SCORES'; end if;
 delete from lead_visitor_scores where demo_id = p_demo;
 insert into lead_visitor_scores(demo_id,visitor_id,agency_id,score,classification,score_version,visual_score,depth_score,commercial_score,
  activation_score,recurrence_score,score_breakdown,explanation,signals,aliases,sessions,events,calculated_at,first_event_at,last_event_at,
  last_qualifying_event_at,attribution_confidence,visitor_type,is_internal,internal_reasons,score_data_quality)
 select p_demo,r.visitor_id,r.agency_id,r.score,r.classification,r.score_version,r.visual_score,r.depth_score,r.commercial_score,
  r.activation_score,r.recurrence_score,coalesce(r.score_breakdown,'{}'::jsonb),coalesce(r.explanation,''),coalesce(r.signals,'{}'),
  coalesce(r.aliases,'{}'),coalesce(r.sessions,'{}'),coalesce(r.events,0),now(),r.first_event_at,r.last_event_at,r.last_qualifying_event_at,
  r.attribution_confidence,r.visitor_type,coalesce(r.is_internal,false),coalesce(r.internal_reasons,'{}'),r.score_data_quality
 from jsonb_to_recordset(p_rows) as r(visitor_id text,agency_id uuid,score smallint,classification text,score_version text,visual_score smallint,
  depth_score smallint,commercial_score smallint,activation_score smallint,recurrence_score smallint,score_breakdown jsonb,explanation text,
  signals text[],aliases text[],sessions text[],events integer,first_event_at timestamptz,last_event_at timestamptz,
  last_qualifying_event_at timestamptz,attribution_confidence text,visitor_type text,is_internal boolean,internal_reasons text[],score_data_quality text);
 get diagnostics stored = row_count;
 return stored;
end $$;

revoke all on function public.habita_lead_record(jsonb) from public, anon, authenticated;
grant execute on function public.habita_lead_record(jsonb) to service_role;
revoke all on function public.habita_lead_replace_scores(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.habita_lead_replace_scores(uuid, jsonb) to service_role;

commit;
