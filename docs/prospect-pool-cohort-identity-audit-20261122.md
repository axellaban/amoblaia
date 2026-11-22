# HABITA — cohort identity audit (2026-11-22; production read-only)

Source: Supabase project `cmpfwuycxdleunuumlkm`, `public.prospect_profiles`; GitHub issue #311. No production mutations or outreach.

Issue #311 defines **298 original records = 288 discovered + 10 queued** at baseline. Current table creation dates do **not** isolate those 298:

| Created date | Current status | Count |
|---|---|---:|
| 2026-11-11 | descubierto | 244 |
| 2026-11-11 | en_cola | 150 |
| 2026-11-18 | en_cola | 82 |
| **Total** | | **476** |

The earliest date has **394** rows, or **96 more than the baseline 298**. Thus selecting the earliest 298 by creation timestamp, taking the 394 rows from November 11, or inferring cohort from current status is **not a defensible reconciliation**. The current statuses cannot reconstruct the issue's baseline 288/10 split after subsequent transitions. Do not label records as belonging to the original cohort without an immutable historical account-ID list, import manifest, or equivalent trustworthy baseline evidence.

Reproduction:
```sql
select created_at::date as created_day, status, count(*) as n
from public.prospect_profiles
group by 1,2 order by 1,2;
```

Next executable steps: recover baseline IDs from the original import/commit/logs, reconcile by `account_id`, and create a per-ID evidence ledger with source URL, observed date, own-site listing URL, WhatsApp provenance, photo importability, and an explicit `unresolved` reason. Use canonical writes only for evidence-backed values. Keep the 09:00 daily 300 routine separate; do not send WhatsApp. Deployment remains **NO-GO** until transactional tests and Chapa Labs parity pass.
