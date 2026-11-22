# HABITA — importability flag audit (2026-11-22, read-only production)

Source: Supabase project `cmpfwuycxdleunuumlkm`, `public.prospect_profiles`. This audit is a current 476-profile population, **not** the identified original 298 cohort. It does not independently verify ownership of agency sites, image access, or validity of existing flags.

| Current status | Total | `demo_photos_importable='si'` | Missing or other | Flag 'si' on known third-party host | Flag 'si' on other host |
|---|---:|---:|---:|---:|---:|
| descubierto | 244 | 0 | 244 | 0 | 0 |
| en_cola | 232 | 117 | 115 | 0 | 117 |
| **Total** | **476** | **117** | **359** | **0** | **117** |

**Release implication:** 115 of 232 currently queued profiles (49.6%) do not have a positive importability flag. The 117 with `si` have a URL on a host outside the narrowly identified third-party set (Argenprop, Zonaprop, Proppies), but that **does not prove** agency ownership or actual importability. Do not silently change historic queue decisions. Require positive importability, a verified own-site property URL, and evidence metadata for *new automatic admissions*. The current `missingForQueue` checks the flag and known portal hosts, not proof of host ownership. No data mutation or outreach performed.

Reproduction:

```sql
with q as (
 select status,profile,
 coalesce(lower(substring(profile->>'demo_listing_url'
  from '^(?:https?://)?(?:www\\.)?([^/?#]+)')),'') as host
 from public.prospect_profiles
)
select status,count(*) total,
 count(*) filter(where profile->>'demo_photos_importable'='si') flag_si,
 count(*) filter(where profile->>'demo_photos_importable' is distinct from 'si') unverified,
 count(*) filter(where host in ('argenprop.com','zonaprop.com.ar','proppies.app')
   and profile->>'demo_photos_importable'='si') portal_flag_si,
 count(*) filter(where host not in ('','argenprop.com','zonaprop.com.ar','proppies.app')
   and profile->>'demo_photos_importable'='si') other_host_flag_si
from q group by status order by status;
```

Next: reconcile original 298 IDs, verify own-site pages and importability in small source-backed batches, preserve manual holds, add transactional admission tests (including 48/24h and A/B), then check Chapa Labs and production QA. **NO-GO**.
