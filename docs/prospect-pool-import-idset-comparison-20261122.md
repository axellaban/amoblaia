# HABITA — historical import ID-set comparison (2026-11-22)

Production read-only SQL on Supabase project cmpfwuycxdleunuumlkm. Compared **actual distinct account_id sets**, not just cardinalities, for all imports with 605 distinct IDs against the chronologically first such import.

**Result:** 349 batches inspected; **349/349 identical** to baseline; 0 differing; maximum extra IDs 0; maximum missing IDs 0. Earliest batch: 2026-10-28 16:01:34 UTC. Latest: 2026-11-19 22:04:41 UTC. Thus these 349 historical imports represent one repeated 605-account set, **not 349 distinct prospect pools**. The comparison does not establish which 298 accounts belonged to issue #311's original cohort. Do not use the 605 IDs as an automatic enrichment target for the 298, and do not overwrite current records based on this observation.

Reproducible SQL:

```sql
with batches as (
 select i.id,i.created_at,count(distinct r.account_id) n
 from prospect_imports i join prospect_import_rows r on r.import_id=i.id
 group by i.id,i.created_at
), chosen as (
 select id,created_at,row_number() over(order by created_at,id) rn
 from batches where n=605
), base as (
 select distinct account_id from prospect_import_rows
 where import_id=(select id from chosen where rn=1)
), checks as (
 select c.id,
 (select count(*) from (
   select distinct account_id from prospect_import_rows where import_id=c.id
   except select account_id from base
 ) x) extra,
 (select count(*) from (
   select account_id from base
   except select distinct account_id from prospect_import_rows where import_id=c.id
 ) x) missing
 from chosen c
)
select count(*) batches,
 count(*) filter(where extra=0 and missing=0) identical,
 count(*) filter(where extra>0 or missing>0) different,
 max(extra) max_extra,max(missing) max_missing
from checks;
```

Next step: recover a timestamped manifest of the **298** account IDs or an attributable snapshot of 288 discovered plus 10 queued. The 605-ID import lineage is now fully deduplicated, but not a valid substitute for that manifest. No data writes, WhatsApp sends, or deployment; QA remains NO-GO.
