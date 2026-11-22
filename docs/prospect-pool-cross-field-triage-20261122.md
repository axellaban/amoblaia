# HABITA — cross-field backlog triage (2026-11-22)

Read-only production audit, project cmpfwuycxdleunuumlkm. This is **not** an identification of the historical 298-account cohort; these counts describe the current 244 `descubierto` records only.

| Measure | Count |
|---|---:|
| Current discovered | 244 |
| Missing demo URL | 128 |
| Missing demo reference | 137 |
| Missing number confidence | 225 |
| Have demo URL **and** reference | 107 |
| Have demo URL **and** number confidence | 0 |
| Have all three | 0 |
| Missing all three | 109 |
| `demo_photos_importable='si'` | 0 |
| `manual_queue_hold=true` | 0 |
| Queue records missing **both** `queued_at` and `queue_snapshot` | 23 |

The 107 with both listing fields form a practical **verification priority**, not an admission-ready group. They still need WhatsApp confidence and independent confirmation of image importability. The 109 missing all three need discovery from scratch. Do not set `verificado` or `demo_photos_importable='si'` without evidence; do not infer original cohort membership from present status.

Reproduce (read only):

```sql
SELECT
 count(*) FILTER (WHERE status='descubierto' AND nullif(profile->>'demo_listing_url','') IS NOT NULL AND nullif(profile->>'demo_listing_reference','') IS NOT NULL) AS demo_and_reference,
 count(*) FILTER (WHERE status='descubierto' AND nullif(profile->>'demo_listing_url','') IS NOT NULL AND nullif(profile->>'number_confidence','') IS NOT NULL) AS demo_and_confidence,
 count(*) FILTER (WHERE status='descubierto' AND nullif(profile->>'demo_listing_url','') IS NOT NULL AND nullif(profile->>'demo_listing_reference','') IS NOT NULL AND nullif(profile->>'number_confidence','') IS NOT NULL) AS all_three,
 count(*) FILTER (WHERE status='descubierto' AND nullif(profile->>'demo_listing_url','') IS NULL AND nullif(profile->>'demo_listing_reference','') IS NULL AND nullif(profile->>'number_confidence','') IS NULL) AS missing_all_three,
 count(*) FILTER (WHERE status='descubierto' AND profile->>'demo_photos_importable'='si') AS importable_yes
FROM public.prospect_profiles;
```

No writes, queue admissions, WhatsApp sends, rule changes, or deployments were made during this audit. QA remains NO-GO pending the release gate.
