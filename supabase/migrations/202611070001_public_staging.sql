-- Generating a style from a demo's public page, without an account. Each try
-- spends one of the agency's gift credits (agencies.free_credits_pending)
-- before the staging starts, so the count the agency sees is the real one.
--
-- * Only for agencies without an account: once claimed, its credits belong to
--   its owner and it generates from its own panel.
-- * The key is the try's id: a repeated request with the same key spends
--   nothing more. A try that cannot start is refunded (habita_public_staging_refund).
-- * The stagings themselves run as the team's demo staging (no customer
--   credit), with the photo's own project and its prompt. Only the server writes.
-- Additive and idempotent: safe to run again. See docs/DEMOS_COMERCIALES.md.
begin;

create table if not exists public.demo_public_stagings (
 key uuid primary key,
 demo_id uuid not null references public.demos(id) on delete cascade,
 visitor text not null check (length(visitor) between 1 and 80),
 photo_id uuid not null references public.demo_photos(id) on delete cascade,
 style text not null check (length(style) between 1 and 40),
 created_at timestamptz not null default now()
);
create index if not exists demo_public_stagings_demo on public.demo_public_stagings(demo_id, created_at desc);

alter table public.demo_public_stagings enable row level security;
revoke all on public.demo_public_stagings from anon, authenticated;

-- Spends one gift credit of the demo's agency, unless this try was already spent.
create or replace function public.habita_public_staging_claim(p_demo uuid, p_visitor text, p_key uuid, p_photo uuid, p_style text) returns jsonb language plpgsql security definer set search_path=public as $$
declare d demos; a agencies; remaining integer;
begin
 if p_visitor is null or length(btrim(p_visitor)) not between 1 and 80 then raise exception 'INVALID_STAGING'; end if;
 select * into d from demos where id = p_demo;
 if not found or d.status <> 'published' then raise exception 'DEMO_NOT_PUBLISHED'; end if;
 select * into a from agencies where id = d.agency_id for update;
 if a.owner_id is not null then raise exception 'AGENCY_CLAIMED'; end if;
 if exists (select 1 from demo_public_stagings where key = p_key) then
  return jsonb_build_object('replay', true, 'remaining', a.free_credits_pending);
 end if;
 if a.free_credits_pending < 1 then raise exception 'NO_GIFT_CREDITS'; end if;
 update agencies set free_credits_pending = free_credits_pending - 1 where id = a.id returning free_credits_pending into remaining;
 insert into demo_public_stagings(key, demo_id, visitor, photo_id, style) values(p_key, p_demo, p_visitor, p_photo, p_style);
 return jsonb_build_object('replay', false, 'remaining', remaining);
end $$;

-- Gives the credit back when the staging could not start. Safe to call again.
create or replace function public.habita_public_staging_refund(p_key uuid) returns void language plpgsql security definer set search_path=public as $$
declare s demo_public_stagings;
begin
 select * into s from demo_public_stagings where key = p_key for update;
 if not found then return; end if;
 update agencies set free_credits_pending = least(free_credits_pending + 1, 1000)
  where id = (select agency_id from demos where id = s.demo_id);
 delete from demo_public_stagings where key = p_key;
end $$;

revoke all on function public.habita_public_staging_claim(uuid, text, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.habita_public_staging_claim(uuid, text, uuid, uuid, text) to service_role;
revoke all on function public.habita_public_staging_refund(uuid) from public, anon, authenticated;
grant execute on function public.habita_public_staging_refund(uuid) to service_role;

commit;
