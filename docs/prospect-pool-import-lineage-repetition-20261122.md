# Import lineage: repeated 605-ID snapshots (2026-11-22)

Read-only production SQL audit. The historical import table does **not** establish the original 298-prospect cohort. The original CSV import on 2026-10-28 and each observed automatic synchronization on 2026-11-05 through 2026-11-18 contain the **same count of 605 distinct account IDs**, of which **165** currently join to prospect_profiles. These are per-import counts, **not additive**; counting import rows across syncs inflates apparent source coverage. This finding does not prove the sets are identical (only their cardinality), and must not be used to overwrite or infer identities.

Reproduce:

```sql
select i.source, i.file_name, date(i.created_at) as import_day,
 count(distinct r.account_id) as ids,
 count(distinct p.account_id) as currently_profiled
from prospect_imports i
join prospect_import_rows r on r.import_id=i.id
left join prospect_profiles p on p.account_id=r.account_id
group by 1,2,3 order by ids desc;
```

Next: compare the actual ID sets across snapshots with EXCEPT, inspect historical issue/commit artifacts for an explicit 298-ID manifest, then enrich only matched IDs with independently verifiable public sources. Do not infer membership from timestamps, statuses or import frequency. No production writes, migrations, WhatsApp or deployment were made by this audit. QA remains NO-GO.
