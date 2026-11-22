# HABITA — 23 queue records lacking admission provenance (2026-11-22)

Read-only production audit, project cmpfwuycxdleunuumlkm. Query:

```sql
select account_id, queued_at is null as missing_queued_at,
       queue_snapshot is null as missing_snapshot, updated_at
from public.prospect_profiles
where status='en_cola' and (queued_at is null or queue_snapshot is null)
order by updated_at, account_id;
```

**Result: 23 rows, all 23 lack BOTH queued_at and queue_snapshot** (not 23 split between either field). All have status en_cola. Breakdown by last update timestamp: 11 (Nov 11), 3 (Nov 16 14:13), 4 (Nov 16 14:14), 1 (Nov 16 14:16), 2 (Nov 16 14:17), 1 (Nov 16 14:19), 1 (Nov 18) = 23.

These are **updated_at timestamps, NOT evidence of queue admission**. Never backfill queued_at from updated_at, created_at or now(); never synthesize snapshots from current mutable profile as historical truth. Retrieve the original queue-entry event or an authenticated operator action/audit log, reconcile each account ID, then repair via a reviewed migration/RPC preserving manual holds and the 48/24h gate. If event evidence is unavailable, document unresolved cases and require explicit operator re-admission rather than silently reconstructing history.

Current database totals: 244 descubierto, 232 en_cola. No production writes performed. QA remains NO-GO. No WhatsApp sent; daily 300-at-09 routine unchanged.
