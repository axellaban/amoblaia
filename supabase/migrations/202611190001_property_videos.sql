-- Videos of a property (Habita V2, Fase 5). One row per video, whatever made
-- it: the "Clásico" montage is rendered in the agency's browser and uploaded
-- straight to storage; AI clips (later) come from a provider. The state is
-- persisted (queued → processing → completed | failed | cancelled), each
-- request is idempotent by its key, and nothing stays "processing" forever:
-- the server marks stale rows as failed when it reads them.
-- Only the server (service_role) reads and writes. Additive and idempotent.
begin;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('property-videos', 'property-videos', false, 104857600, array['video/mp4'])
on conflict (id) do nothing;

create table if not exists public.property_videos (
 id uuid primary key default gen_random_uuid(),
 agency_id uuid not null references public.agencies(id) on delete cascade,
 demo_id uuid not null references public.demos(id) on delete cascade,
 actor_id uuid not null references auth.users(id) on delete cascade,
 idempotency_key uuid not null unique,
 mode text not null check (mode in ('classic', 'balanced', 'cinematic', 'clip')),
 format text not null check (format in ('9:16', '16:9')),
 status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'failed', 'cancelled')),
 photo_count integer not null check (photo_count between 1 and 30),
 animated_count integer not null default 0 check (animated_count >= 0),
 provider text not null default 'browser' check (length(provider) <= 40),
 credits_charged integer not null default 0 check (credits_charged >= 0),
 storage_path text,
 size_bytes bigint,
 duration_ms integer,
 error text check (error is null or length(error) <= 300),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 completed_at timestamptz
);
create index if not exists property_videos_demo on public.property_videos(demo_id, created_at desc);
create index if not exists property_videos_open on public.property_videos(updated_at) where status in ('queued', 'processing');

alter table public.property_videos enable row level security;
revoke all on public.property_videos from anon, authenticated;

commit;
