# QA gate: persistent manual queue removal (2026-11-22)

## Live database evidence
Read-only inspection of `pg_get_functiondef('public.habita_prospect_pool_save'::regproc)` on project `cmpfwuycxdleunuumlkm` confirms that the canonical RPC clears both `queued_at` and `queue_snapshot` whenever a status patch leaves `en_cola`. It writes an `account_updated` event but does **not** persist a durable suppression/removal flag in `prospect_profiles`.

Consequently **the presence of `queued_at` cannot be used as a manual-removal guard**. A later save, recalculation, or automatic fill may re-enqueue a manually removed prospect if the guard only checks current status/timestamp. This is a deployment-blocking correctness risk; no production writes or deployment were performed during this audit.

## Required fix and acceptance checks
1. Model manual queue removal as an explicit durable exclusion (with reason, actor and timestamp), distinct from a reversible qualification state. Preserve the exclusion across enrichment, scoring and fill; clear it only by an explicit authorized user action. Keep existing `descartado` and contact opt-outs authoritative.
2. Make auto-enqueue and manual removal transactional/serialized per account. Verify two concurrent fill workers cannot insert duplicate queue transitions and cannot override a removal.
3. Regression: queue -> manual remove -> save profile -> rescore -> fill must remain excluded; explicit restore -> qualify -> fill may enqueue once. Also cover external contact updates, ranking, 15% exploration, immutable snapshots, 48/24h mobile cap and A/B assignment preservation.
4. Compare behavior in authenticated HABITA and Chapa Labs against the same backend. Do not merge or deploy before tests and production-equivalent QA pass.

## Reproducible read-only query
```sql
select pg_get_functiondef('public.habita_prospect_pool_save'::regproc);
```

This audit establishes a **confirmed design blocker**, not proof that a regression has already happened. The historical cohort of 298 and source-backed enrichment remain separate outstanding work. The existing 09:00 prospecting automation must not be duplicated; no WhatsApp messages are authorized.
