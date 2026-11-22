# HABITA — demo URL host eligibility audit (2026-11-22, read-only production)

Supabase project `cmpfwuycxdleunuumlkm`, table `public.prospect_profiles`. This audit **does not** verify agency ownership of any remaining host, nor claim that all 476 records are in the historical 298 cohort.

## Counts by current status

| Status | Total | Missing URL | Known third-party hosts | Other hosts (ownership unverified) |
|---|---:|---:|---:|---:|
| descubierto | 244 | 128 | 116 | 0 |
| en_cola | 232 | 11 | 45 | 176 |
| **Total** | **476** | **139** | **161** | **176** |

Known third-party URL hosts in this narrow audit: `argenprop.com` (156), `zonaprop.com.ar` (2), `proppies.app` (3). The first two are listing portals; the third is classified as a third-party platform pending source-level ownership checks. These are *URL-host classifications*, not proof of importability or final prospect eligibility. Of the 232 currently queued, **45 have a candidate demo URL on one of these three hosts** and **11 have no URL**. Hence at least 56 queued profiles lack a demonstrated own-agency demo URL **in this field**. The remaining 176 are only candidates for manual ownership and importability verification. Do not silently remove queued records or suppress outreach without reviewing existing manual decisions and downstream effects.

## Reproduce

```sql
with x as (
 select status,
  coalesce(lower(substring(profile->>'demo_listing_url'
   from '^(?:https?://)?(?:www\\.)?([^/?#]+)')),'') host
 from public.prospect_profiles
)
select status,count(*) total,
 count(*) filter(where host='') no_url,
 count(*) filter(where host in ('argenprop.com','zonaprop.com.ar','proppies.app')) known_third_party,
 count(*) filter(where host<>'' and host not in ('argenprop.com','zonaprop.com.ar','proppies.app')) other_host
from x group by status order by status;
```

## Release gate and safe next batch

1. Match the **298 original stable IDs** before attributing any of these counts to the original cohort.
2. For each queued third-party/missing-URL candidate, search the **agency's own website**, record evidence URL, verification timestamp, exact property page, and whether import is possible; do not substitute portal listings or invent WhatsApp data.
3. Make own-site URL verification an explicit prerequisite for **new automatic** queue admissions; do not retroactively change manual exclusions or historic queued status without a separate reviewed migration.
4. Verify ranking, 15% exploration, 48/24h contact accounting, A/B assignment, snapshots and optimistic concurrency in integration tests before release.
5. This run made no database mutations, no WhatsApp sends, and no deployment. PR #310 remains NO-GO.
