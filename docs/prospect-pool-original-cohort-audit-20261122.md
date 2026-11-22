# HABITA — cohort provenance gate (2026-11-22 01:52 ART)

Read-only production query on Supabase project `cmpfwuycxdleunuumlkm`, table `public.prospect_profiles`. No mutations or WhatsApp sends.

## Actual cohort distribution

| profile.source_batch | descubierto | en_cola | total | with demo_listing_url | with demo_listing_reference |
|---|---:|---:|---:|---:|---:|
| Costa 11/2026 | 127 | 102 | 229 | 206 | 200 |
| Pendientes 11/2026 | 117 | 48 | 165 | 49 | 46 |
| Relevamiento costa 18/11 | 0 | 82 | 82 | 82 | 82 |
| **Total** | **244** | **232** | **476** | **337** | **328** |

**Important:** Neither legacy batch alone nor both combined equals the **298 originals** in issue #311: the two November batches total **394**. The historical issue says 288 discovered + 10 queued at the initial audit, but current status is not a durable cohort identifier. It is unsafe to designate arbitrary 298 of these 394 as originals or claim per-original enrichment completion. The 82 records from the 18/11 batch are distinguishable, but excluding them still leaves 394, not 298.

## Reproducible SQL

```sql
select coalesce(profile->>'source_batch','(none)') batch,status,count(*) n,
 count(*) filter(where profile->>'demo_listing_url' is not null) demo_url,
 count(*) filter(where profile->>'demo_listing_reference' is not null) reference
from public.prospect_profiles
 group by 1,2 order by n desc;
```

## QA / enrichment gate

1. Recover original account IDs from the 2026-11-17 snapshot, import log, source spreadsheet or audit trail. Join by stable account ID; do **not** use current status or source_batch alone.
2. Produce a 298-row reconciliation with source URL, observation date, verified WhatsApp, candidate property URL **on the agency's own website**, importability, outcome and explicit unresolved reason. Never infer verification from a portal or fabricate fields.
3. The current profile JSON has demo URL on 337/476 and reference on 328/476; this **does not** establish URL ownership, image importability or contact readiness. Join account/contact tables and verify sources before any automatic queue promotion.
4. The 23 legacy queue records missing timestamps/snapshots and the zero exploration flags remain separate release gates; see the other 2026-11-22 audit documents.
5. Keep PR #310 in NO-GO until transactional tests, 48/24h, A/B, external contacts and Chapa Labs parity pass. Daily 300-at-09:00 acquisition remains the sole scheduled acquisition writer.
