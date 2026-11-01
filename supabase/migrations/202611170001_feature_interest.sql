-- Interest in the panel's upcoming tools (Tour 360, Planos, Redes, API and,
-- until it is live, Video): who asked to be told when each one is ready.
--
-- * One row per feature, agency and user (unique): asking again updates it,
--   so the count of interested agencies is a count of distinct agency_id.
-- * The notice channels are separate opt-ins (never inferred from a click);
--   cancelled_at keeps the history when someone withdraws.
-- * Only the server (service_role) reads and writes, after checking the
--   member's agency. Additive and idempotent: safe to run again.
begin;

create table if not exists public.feature_interest (
 id uuid primary key default gen_random_uuid(),
 feature_key text not null check (feature_key in ('tour_360', 'planos', 'redes', 'api', 'video')),
 agency_id uuid not null references public.agencies(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 notify_email boolean not null default false,
 notify_whatsapp boolean not null default false,
 source_surface text check (source_surface is null or length(source_surface) <= 40),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 cancelled_at timestamptz,
 unique (feature_key, agency_id, user_id)
);
create index if not exists feature_interest_feature on public.feature_interest(feature_key, created_at desc) where cancelled_at is null;

alter table public.feature_interest enable row level security;
revoke all on public.feature_interest from anon, authenticated;

commit;
