-- HABITA PR #310 / issue #311: read-only cohort reconciliation and release preflight.
-- Run against production BEFORE any enrichment. No writes, no WhatsApp.
-- The original 298 (288 discovered + 10 queued) cannot be inferred from a date alone.
-- Each candidate must be joined to an immutable source import/event identifier.
--
-- 1. Cohorts by profile creation day and status (NOT proof of original membership).
select date(p.created_at at time zone 'America/Argentina/Buenos_Aires') as local_day,
       p.status, count(*) as profiles
from public.prospect_profiles p
group by 1,2 order by 1,2;
--
-- 2. Accounts without profiles, grouped by origin; do not bulk-enqueue them.
select coalesce(a.source,'(null)') as source,
       coalesce(a.campaign,'(null)') as campaign,
       count(*) as accounts_without_profile
from public.prospect_accounts a
left join public.prospect_profiles p on p.account_id=a.id
where p.account_id is null
group by 1,2 order by 3 desc;
--
-- 3. Queue provenance and exploration; do not synthesize historical snapshots.
select count(*) filter(where status='en_cola') as queued,
       count(*) filter(where status='en_cola' and queued_at is null) as missing_queued_at,
       count(*) filter(where status='en_cola' and queue_snapshot is null) as missing_snapshot,
       count(*) filter(where coalesce(explore,false)) as exploration,
       count(*) filter(where coalesce((profile->>'manual_queue_hold')::boolean,false)) as manual_holds
from public.prospect_profiles;
--
-- 4. Import lineage by distinct account IDs (never count import rows as accounts).
select count(*) as import_rows,
       count(distinct account_id) as distinct_accounts
from public.prospect_import_rows
where account_id is not null;
--
-- 5. External contact edits and manual suppressions: inspect before backfill.
select type, coalesce(source,'(null)') as source, count(*) as events
from public.prospect_events
where type ilike '%contact%' or type ilike '%suppress%'
group by 1,2 order by 3 desc;
--
-- Release remains NO-GO until original 298 UUIDs are independently established,
-- canonical write-path tests pass, Chapa Labs authenticated parity is verified,
-- and the 48/24h + A/B behavior is proven unchanged.
