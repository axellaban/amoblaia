# HABITA — audit of pre-existing incomplete queue records

Read-only production audit on 2026-11-22 UTC (2026-11-21 Argentina). Supabase project `cmpfwuycxdleunuumlkm`, table `public.prospect_profiles`.

- Total 476: 244 `descubierto`, 232 `en_cola`.
- Exactly 23 `en_cola` rows have **both** `queued_at IS NULL` and `queue_snapshot IS NULL`.
- Zero profiles with `profile.manual_queue_hold=true`.
- These are historical/incomplete records; **do not synthesize** queued timestamps or snapshots from current profiles, because that would misrepresent the state at original queue entry.

## Account IDs requiring provenance review

- `e122794b-88e5-4090-8004-6d94226e76b0`
- `4e65ed2d-f80e-49d2-bb58-05dd2f0ec772`
- `a99572a8-03a5-4b8d-89b5-9ca6fa0f1e16`
- `d100ee72-d8b1-4b42-871a-9926b830a1b6`
- `41a09c3d-4929-40a8-b42c-c6095d09b9ac`
- `6071a336-f8a5-4319-b460-3bae95cca220`
- `b86211a2-a493-4af3-97ef-4c6c16d77643`
- `a5be1f41-ab57-4182-a855-4c90f1a5cc7c`
- `f20a9eb2-74ab-4c83-a2e6-007ccd73b2a7`
- `59557eda-f994-4bbd-a5b4-1824f283156a`
- `ceb7103a-0011-490f-a4f6-a34c56a2abae`
- `45d4d9d0-3296-402c-8e8a-7ece3d296989`
- `12f5ed5b-f426-4615-922e-509db4f2994d`
- `cc7a8bc6-9e0a-4a8b-b3bd-caad5ff80475`
- `de2f0ceb-d2b9-4a2d-86e6-8d42c251014f`
- `fac2379d-9c3c-4ef4-bcc8-40ed3761d67d`
- `4839a74b-2dfb-4cd2-8d7f-c8840e334610`
- `0f1c19fa-695a-4aae-b6b7-2129595525e6`
- `81f645b6-181d-4fc2-9f5a-58ad870e9217`
- `fef9bfda-e393-4f30-9681-4dd90d0df28f`
- `61b3cfab-6824-454b-a595-28065d5068f8`
- `4a6d0787-898c-470d-8317-ec47da2380b5`
- `0dd64b3b-1e0c-4058-b1de-c0c53f942775`

## Reproduce (read-only)

```sql
select account_id, updated_at from public.prospect_profiles
where status = 'en_cola' and (queued_at is null or queue_snapshot is null)
order by updated_at desc;
```

## Resolution gate

1. Reconstruct original queue entry only if a dated, attributable event or immutable historical source supports the actual snapshot and time. Otherwise mark as legacy unknown, and do not fabricate either field.
2. Decide whether each record remains legitimately queued using suppression, contacts, eligibility and manual-exclusion evidence; don't automatically re-enqueue to repair metadata.
3. Validate the proposed migration in a non-production environment, then regression-test concurrent edits, explicit remove/reactivate, external contacts, 48/24h and A/B before deployment.
4. Re-run this audit after any approved remediation. No database writes were made during this audit.
