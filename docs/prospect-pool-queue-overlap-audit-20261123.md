# HABITA PR #310 — cruce de anomalías de cola (2026-11-23, 19:37 AR)

Fuente: SQL de solo lectura sobre Supabase productivo `cmpfwuycxdleunuumlkm`. No se modificaron perfiles.

## Resultado confirmado

- 232 perfiles en cola.
- 23 sin `queued_at` o `queue_snapshot`.
- 11 sin pareja completa `profile.demo_listing_url` + `profile.demo_listing_reference`.
- **Los 11 sin pareja URL/referencia están incluidos dentro de los 23 sin procedencia de incorporación.**
- Los otros **12** tienen URL y referencia, pero les falta `queued_at` o `queue_snapshot`.
- Por lo tanto hay **23 cuentas únicas** afectadas por una o ambas anomalías, no 34. Este cruce es por fila, no por agregación aproximada.

## Consulta reproducible

```sql
select
 count(*) filter(where status='en_cola') queued,
 count(*) filter(where status='en_cola' and (queued_at is null or queue_snapshot is null)) incomplete,
 count(*) filter(where status='en_cola' and
   (nullif(profile->>'demo_listing_url','') is null or nullif(profile->>'demo_listing_reference','') is null)) missing_demo,
 count(*) filter(where status='en_cola' and (queued_at is null or queue_snapshot is null)
   and (nullif(profile->>'demo_listing_url','') is null or nullif(profile->>'demo_listing_reference','') is null)) overlap,
 count(*) filter(where status='en_cola' and (queued_at is null or queue_snapshot is null)
   and nullif(profile->>'demo_listing_url','') is not null
   and nullif(profile->>'demo_listing_reference','') is not null) incomplete_with_demo
from public.prospect_profiles;
```

## Tratamiento por lotes

1. Lote A (11): revisar fuente pública de inmueble y referencia, además de procedencia de cola; no completar datos por inferencia.
2. Lote B (12): URL y referencia presentes, auditar solamente procedencia de cola y elegibilidad externa; no fabricar fecha histórica.
3. Antes de corregir, reconstruir UUID de la cohorte original de 298 desde evidencia histórica inmutable. No suponer que estos 23 pertenecen a esa cohorte.
4. Ejecutar regresiones de concurrencia, exclusión manual, 48/24h, A/B y paridad Chapa Labs antes de aplicar migración o desplegar.

## Estado de migración

La consulta de `list_migrations` productiva al 23/11 no muestra `202612140002_prospect_pool_concurrency`; sí figura `202612140001_prospect_pool` bajo la versión `20261111222315`. **QA: NO-GO.** No WhatsApp, no despliegue y no duplicar la rutina 300/09:00.
