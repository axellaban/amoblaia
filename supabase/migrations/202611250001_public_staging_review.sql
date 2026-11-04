-- «Ambientá con IA» from the agency's demo (202611070001_public_staging.sql):
--
-- * An image generated there waits for the agency's approval before buyers see
--   it: demo_public_stagings.approved_at stays null until «Mostrar esta en la
--   ficha» in the panel. The agency's own demo shows it meanwhile.
-- * The gift credit comes back when the staging ended without an image (every
--   job failed or needs review): habita_public_staging_settle, once per try
--   (refunded_at). Before the agency is claimed it returns to
--   agencies.free_credits_pending; after, to its owner's balance.
--
-- Additive and idempotent. Does not redefine any earlier function.
begin;

alter table public.demo_public_stagings add column if not exists approved_at timestamptz;
alter table public.demo_public_stagings add column if not exists approved_by uuid;
alter table public.demo_public_stagings add column if not exists refunded_at timestamptz;
create index if not exists demo_public_stagings_unsettled on public.demo_public_stagings(created_at) where refunded_at is null;
create index if not exists demo_public_stagings_pending on public.demo_public_stagings(photo_id) where approved_at is null;

-- Settles one try: 'succeeded' (it has an image), 'pending' (still running or not reserved),
-- 'refunded' (every job ended without an image: the credit came back, once) or 'missing'.
create or replace function public.habita_public_staging_settle(p_key uuid) returns text language plpgsql security definer set search_path=public as $$
declare s demo_public_stagings; a agencies; total integer; ok integer; live integer; g uuid; actor uuid;
begin
 select * into s from demo_public_stagings where key = p_key for update;
 if not found then return 'missing'; end if;
 if s.refunded_at is not null then return 'refunded'; end if;
 select count(*),
        count(*) filter (where status = 'succeeded' and result_path is not null),
        count(*) filter (where status in ('queued', 'running'))
   into total, ok, live
   from generations where batch_id = p_key or request_key = p_key;
 if ok > 0 then return 'succeeded'; end if;
 if total = 0 or live > 0 then return 'pending'; end if;
 select * into a from agencies where id = (select agency_id from demos where id = s.demo_id) for update;
 if found then
  if a.owner_id is null then
   update agencies set free_credits_pending = least(free_credits_pending + 1, 1000) where id = a.id;
  else
   insert into credit_grants(user_id, source_key, total, remaining)
    values (a.owner_id, 'public_staging_refund:' || p_key, 1, 1)
    on conflict (source_key) do nothing
    returning id into g;
   if g is not null then
    insert into credit_ledger(user_id, grant_id, delta, reason) values (a.owner_id, g, 1, 'admin_adjustment');
   end if;
  end if;
  -- The account the demo's photos run under (the team's), else the owner: admin_audit needs a profile.
  select p.user_id into actor from demo_photos ph join projects p on p.id = ph.project_id where ph.id = s.photo_id;
  actor := coalesce(a.owner_id, actor);
  if actor is not null and exists (select 1 from profiles where id = actor) then
   insert into admin_audit(actor_id, action, subject_id, details)
    values (actor, 'public_staging_refund', a.id::text,
            jsonb_build_object('key', p_key, 'demo', s.demo_id, 'photo', s.photo_id, 'style', s.style));
  end if;
 end if;
 update demo_public_stagings set refunded_at = now() where key = p_key;
 return 'refunded';
end $$;

-- Settles the recent tries still open (the cron): how many credits came back.
create or replace function public.habita_public_staging_settle_recent() returns integer language plpgsql security definer set search_path=public as $$
declare k uuid; n integer := 0;
begin
 for k in
  select key from demo_public_stagings
   where refunded_at is null and created_at > now() - interval '7 days' and created_at < now() - interval '1 minute'
   order by created_at limit 200
 loop
  if habita_public_staging_settle(k) = 'refunded' then n := n + 1; end if;
 end loop;
 return n;
end $$;

revoke all on function public.habita_public_staging_settle(uuid) from public, anon, authenticated;
grant execute on function public.habita_public_staging_settle(uuid) to service_role;
revoke all on function public.habita_public_staging_settle_recent() from public, anon, authenticated;
grant execute on function public.habita_public_staging_settle_recent() to service_role;
commit;
