-- Who opened a shared demo, and when they did so last.
--
-- * One row per viewer and demo: a signed-in account is keyed by its user id,
--   a browser without an account by a random cookie. A visitor who comes back
--   updates the row (views and last_viewed_at) instead of adding one.
-- * viewer_email is a snapshot taken at the visit, so the panel can name the
--   account without reading auth.users.
-- * Only the server (service_role) reads or writes this table, through the
--   demo routes. Browsers get no grants and no policies.
-- Additive and idempotent: safe to run again.
begin;

create table if not exists public.demo_views (
 id uuid primary key default gen_random_uuid(),
 demo_id uuid not null references public.demos(id) on delete cascade,
 visitor text not null check(length(visitor) between 8 and 80),
 user_id uuid,
 viewer_email text check(viewer_email is null or length(viewer_email) <= 200),
 views integer not null default 1 check(views >= 1),
 first_viewed_at timestamptz not null default now(),
 last_viewed_at timestamptz not null default now(),
 unique(demo_id, visitor)
);
create index if not exists demo_views_demo on public.demo_views(demo_id, last_viewed_at desc);

alter table public.demo_views enable row level security;
revoke all on public.demo_views from public,anon,authenticated;
grant all on public.demo_views to service_role;

-- Registers one visit. Atomic: concurrent visits of the same viewer add up
-- instead of failing on the unique key.
create or replace function public.amobla_record_demo_view(p_demo uuid,p_visitor text,p_user uuid,p_email text)
 returns void language sql security definer set search_path=public as $$
 insert into demo_views(demo_id,visitor,user_id,viewer_email)
  values(p_demo,p_visitor,p_user,p_email)
 on conflict(demo_id,visitor) do update set
  views=demo_views.views+1,
  last_viewed_at=now(),
  user_id=coalesce(excluded.user_id,demo_views.user_id),
  viewer_email=coalesce(excluded.viewer_email,demo_views.viewer_email);
$$;

revoke all on function public.amobla_record_demo_view(uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.amobla_record_demo_view(uuid,text,uuid,text) to service_role;
commit;
