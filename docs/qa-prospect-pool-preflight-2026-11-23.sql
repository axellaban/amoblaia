-- HABITA PR #310: read-only production preflight (2026-11-23).
-- Run before applying any migration. No UPDATE/INSERT/DELETE.
-- A zero count in a category is not proof of behavioral correctness.
select status, count(*) as profiles from public.prospect_profiles group by status order by status;

select
 count(*) filter (where status='en_cola') as queued,
 count(*) filter (where status='en_cola' and queued_at is null) as queued_missing_timestamp,
 count(*) filter (where status='en_cola' and queue_snapshot is null) as queued_missing_snapshot,
 count(*) filter (where status='en_cola' and (queued_at is null or queue_snapshot is null)) as queued_incomplete,
 count(*) filter (where coalesce(profile->>'manual_queue_hold','false')='true') as manual_holds,
 count(*) filter (where explore is true) as exploration_flags,
 max(created_at) as latest_profile_creation
from public.prospect_profiles;

-- Identify exact historical rows for reconciliation; never backfill timestamps by guessing.
select account_id, status, created_at, updated_at, queued_at,
       (queue_snapshot is not null) as has_snapshot
from public.prospect_profiles
where status='en_cola' and (queued_at is null or queue_snapshot is null)
order by created_at, account_id;

-- Check that production has not silently adopted the proposed hold mechanism.
select pg_get_functiondef(p.oid) ilike '%manual_queue_hold%' as production_has_manual_hold,
       pg_get_functiondef(p.oid) ilike '%expected_updated_at%' as production_has_optimistic_lock
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='habita_prospect_pool_save';

-- QA gate before merge/deploy:
-- 1. Execute transactional rollback tests for removal -> recalculation -> no requeue,
--    reactivation, snapshot immutability, malformed JSON, and two concurrent writers.
-- 2. Verify ranking/exploration and external-contact suppression in both consumers.
-- 3. Verify 48/24h and A/B with historical send events, not only queue counts.
-- 4. Reconcile the original 298 IDs separately from today's total.
-- 5. Verify Chapa Labs authenticated UI parity and CI before production rollout.
