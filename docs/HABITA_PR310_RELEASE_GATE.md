# HABITA PR #310 — QA gate and cohort reconciliation (2026-11-21)

## Initial cohort — do not infer IDs
Issue #311 explicitly records **288 descubierto + 10 en_cola = 298** at its initial audit. This is a historical snapshot, **not** a stable cohort identifier. Current `prospect_profiles` contains 244 descubierto + 232 en_cola = 476 (read-only SQL, 2026-11-21). Never select the 298 by current status, creation date, or arbitrary LIMIT. Recover the initial account IDs from an audit/export/event snapshot and record their provenance before any bulk write.

## Release blockers
- `sacar` must persist `profile.manual_queue_hold=true`; `guardar`, `recalcular`, `llenar` and account creation must respect it. Only explicit `cola` may clear it. `queued_at` is cleared when leaving queue and is not a durable exclusion flag.
- Qualification is not admission: admission must select eligible accounts through existing ranking and exploration quota, not simply set `status=calificado` or admit every qualifying save.
- Every admission path must check manual discard, suppression, external contact history, WhatsApp usability/review, candidate URL and reference, importability/listing checks, and cap 48 first contacts per rolling 24h. Preserve A/B assignments and snapshots.
- Concurrent writes must reject stale `expected_updated_at` without losing profile fields or queue snapshots. Apply migration only after testing existing three-argument RPC callers.
- Repair 23 legacy queued records with missing `queued_at` and `queue_snapshot` only after verifying provenance; never invent timestamps.
- Compare authenticated HABITA and Chapa Labs queues/actions/counters, including mobile; verify A/B 50/50 and no duplicated 300/day discovery job. No WhatsApp sends during QA.

## Regression matrix (must automate before merge)
1. `cola -> sacar -> guardar -> recalcular -> llenar`: remains out; explicit `cola` re-admits and clears hold.
2. `descartar -> recalcular -> llenar`: remains discarded.
3. Externally contacted or suppressed pending account: never admitted by any operation.
4. Missing/needs-review WhatsApp, listing reference, listing importability: remains out; valid account ranks correctly.
5. Exploration selection uses existing configured share, not a second random assignment; tie-breaking deterministic.
6. Two edits with same expected timestamp: exactly one succeeds; stale one returns conflict, preserving first edit.
7. Snapshot and queued timestamp captured atomically on admission and retained until explicit exit; no queue entry without both.
8. Rolling 48/24h first-contact cap and A/B split unchanged; test boundary at 47/48/49 and 24h rollover.
9. HABITA vs Chapa Labs parity on identical dataset and operator role.
10. Daily 300 at 09:00: inspect execution logs and staging/account inserts; no extra run from this PR.

## Read-only monitoring SQL
```sql
SELECT status, count(*) AS n,
 count(*) FILTER (WHERE status='en_cola' AND (queued_at IS NULL OR queue_snapshot IS NULL)) AS incomplete_queue,
 count(*) FILTER (WHERE profile->>'manual_queue_hold'='true') AS manual_holds,
 count(*) FILTER (WHERE created_at >= now()-interval '24 hours') AS new_24h
FROM public.prospect_profiles GROUP BY status ORDER BY status;
```
Observed 2026-11-21: descubierto 244, en_cola 232, incomplete_queue 23, manual_holds 0, new_24h 0. Counts do not establish daily prospect discovery failure because other staging tables may be used.

**Release decision: NO-GO** until tests, cohort provenance, migration compatibility, Chapa Labs QA and production smoke tests are evidenced. No production deployment or WhatsApp dispatch authorized.
