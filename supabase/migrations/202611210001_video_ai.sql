-- Videos with AI animation (Habita V2, Fase 5C/5D): «Foto en movimiento»
-- (3 credits) and «Recorrido cinematográfico» (10 credits). A provider
-- (fal.ai) animates each photo into a short clip; the clips are kept in the
-- private property-videos bucket and the agency's browser joins them into
-- the MP4. The credits are taken from the payer's grants when the video
-- starts and given back, exactly once, if the animation fails.
-- Only the server (service_role) reads, writes and calls. Additive and idempotent.
begin;

alter table public.property_videos add column if not exists payer_id uuid references public.profiles(id) on delete set null;
-- Set when every clip is in storage: from then on the video can always be joined (it is never failed as abandoned).
alter table public.property_videos add column if not exists clips_ready_at timestamptz;

-- Which video a credit movement belongs to (charges and refunds of AI videos).
alter table public.credit_ledger add column if not exists video_id uuid references public.property_videos(id) on delete set null;
create index if not exists credit_ledger_video on public.credit_ledger(video_id) where video_id is not null;

create table if not exists public.property_video_clips (
 id uuid primary key default gen_random_uuid(),
 video_id uuid not null references public.property_videos(id) on delete cascade,
 position integer not null check (position between 0 and 11),
 photo_id uuid not null,
 staged boolean not null default false,
 style text check (style is null or length(style) <= 80),
 model text not null check (length(model) between 1 and 120),
 request_id text check (request_id is null or length(request_id) <= 120),
 status_url text check (status_url is null or length(status_url) <= 500),
 response_url text check (response_url is null or length(response_url) <= 500),
 status text not null default 'pending' check (status in ('pending', 'running', 'ready', 'failed')),
 attempts integer not null default 0 check (attempts between 0 and 5),
 storage_path text,
 duration_ms integer,
 error text check (error is null or length(error) <= 300),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (video_id, position)
);
create index if not exists property_video_clips_open on public.property_video_clips(video_id) where status in ('pending', 'running');

alter table public.property_video_clips enable row level security;
revoke all on public.property_video_clips from anon, authenticated;

-- Takes p_credits from the payer's usable grants (soonest to expire first),
-- one ledger row per grant, for one video. Charging the same video again
-- changes nothing. NO_CREDITS when the balance is short: nothing is taken.
create or replace function public.habita_video_charge(p_payer uuid, p_video uuid, p_credits integer)
returns integer language plpgsql security definer set search_path = public as $$
declare v property_videos; g record; need integer := p_credits; take integer; available integer;
begin
 if p_credits is null or p_credits < 1 or p_credits > 100 then raise exception 'INVALID_CREDITS'; end if;
 select * into v from property_videos where id = p_video for update;
 if not found then raise exception 'VIDEO_NOT_FOUND'; end if;
 if exists (select 1 from credit_ledger where video_id = p_video and reason = 'video_reserved') then return v.credits_charged; end if;
 perform 1 from profiles where id = p_payer for update;
 if not found then raise exception 'NO_CREDITS'; end if;
 if (select blocked from profiles where id = p_payer) then raise exception 'ACCOUNT_BLOCKED'; end if;
 perform amobla_refresh_annual(p_payer);
 select coalesce(sum(remaining), 0) into available from credit_grants
  where user_id = p_payer and not revoked and remaining > 0
   and source_key not like 'trial:%' and source_key not like 'demo:%'
   and starts_at <= now() and (expires_at is null or expires_at > now());
 if available < p_credits then raise exception 'NO_CREDITS'; end if;
 for g in
  select id, remaining from credit_grants
  where user_id = p_payer and not revoked and remaining > 0
   and source_key not like 'trial:%' and source_key not like 'demo:%'
   and starts_at <= now() and (expires_at is null or expires_at > now())
  order by expires_at nulls last, created_at, id
  for update
 loop
  exit when need = 0;
  take := least(need, g.remaining);
  update credit_grants set remaining = remaining - take where id = g.id;
  insert into credit_ledger(user_id, grant_id, video_id, delta, reason) values (p_payer, g.id, p_video, -take, 'video_reserved');
  need := need - take;
 end loop;
 update property_videos set credits_charged = p_credits, payer_id = p_payer where id = p_video;
 return p_credits;
end $$;

-- Gives back what a video took, to the same grants, exactly once.
create or replace function public.habita_video_refund(p_video uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare r record; refunded integer := 0;
begin
 perform 1 from property_videos where id = p_video for update;
 if not found then return 0; end if;
 if exists (select 1 from credit_ledger where video_id = p_video and reason = 'video_refund') then
  update property_videos set credits_charged = 0 where id = p_video and credits_charged <> 0;
  return 0;
 end if;
 for r in select user_id, grant_id, -delta as n from credit_ledger where video_id = p_video and reason = 'video_reserved' and delta < 0 order by id loop
  update credit_grants set remaining = least(total, remaining + r.n) where id = r.grant_id;
  insert into credit_ledger(user_id, grant_id, video_id, delta, reason) values (r.user_id, r.grant_id, p_video, r.n, 'video_refund');
  refunded := refunded + r.n;
 end loop;
 update property_videos set credits_charged = 0 where id = p_video;
 return refunded;
end $$;

revoke all on function public.habita_video_charge(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.habita_video_charge(uuid, uuid, integer) to service_role;
revoke all on function public.habita_video_refund(uuid) from public, anon, authenticated;
grant execute on function public.habita_video_refund(uuid) to service_role;

commit;
