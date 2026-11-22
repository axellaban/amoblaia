# HABITA — production exploration and queue integrity audit (2026-11-22)

Read-only inspection of Supabase project `cmpfwuycxdleunuumlkm`, `public.prospect_profiles`. No production writes or WhatsApp sends.

| Status | Rows | Missing queued_at | Missing queue_snapshot | manual_queue_hold true | Missing score | explore true |
|---|---:|---:|---:|---:|---:|---:|
| descubierto | 244 | n/a | n/a | 0 | 0 | 0 |
| en_cola | 232 | 23 | 23 | 0 | 0 | 0 |
| TOTAL | 476 | 23 queued | 23 queued | 0 | 0 | **0** |

**New QA observation:** All 232 currently queued profiles have `explore=false`, whereas the requested selection policy reserves 15% for exploration. This snapshot does **not** prove a bug in the selection algorithm: the flag could be omitted historically or only populated in a different pipeline. Verify the implementation and queue-entry events before any backfill or algorithm changes. No invented exploration assignments.

**Persistent integrity issue:** 23/232 queued profiles (9.91%) lack both queue timestamp and snapshot; IDs and non-fabrication policy are documented in `docs/prospect-pool-legacy-queue-audit-20261122.md`.

## Reproducible read-only query

```sql
select status, count(*) n,
 count(*) filter(where queued_at is null and status='en_cola') missing_time,
 count(*) filter(where queue_snapshot is null and status='en_cola') missing_snapshot,
 count(*) filter(where profile->>'manual_queue_hold'='true') holds,
 count(*) filter(where score is null) missing_score,
 count(*) filter(where explore) exploration
from public.prospect_profiles group by status order by status;
```

## Release gate

- Reconcile the original 298 account IDs before claiming enrichment completion; document each verified source or unresolved result.
- Prove exploration allocation on **new** eligible queue entries with a seeded test and inspect actual events; do not assume historical rows should have 15% flags.
- Repair or explicitly classify the 23 legacy incomplete queue records using provenance, not synthetic timestamps.
- Verify manual holds, concurrency, external contacts, suppression, 48/24h and A/B through integration tests before applying the migration.
- Do not merge/deploy until QA passes; daily 300-prospect automation remains the sole scheduled acquisition writer.
