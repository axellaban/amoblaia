# HABITA PR #310 — audit de completitud por etapa (2026-11-23, 18:20 AR)

Fuente: consulta SQL de solo lectura en Supabase proyecto `cmpfwuycxdleunuumlkm`. Este informe **no** acredita pertenencia a la cohorte original de 298, ni validación externa de publicaciones, ni cambios en producción.

| Estado | Perfiles | URL candidata | Referencia textual | Ambos | Score |
|---|---:|---:|---:|---:|---:|
| descubierto | 244 | 116 | 107 | 107 | 244 |
| en_cola | 232 | 221 | 221 | 221 | 232 |
| Total | 476 | 337 | 328 | 328 | 476 |

Hallazgos:
- **137 descubiertos** carecen de la pareja URL+referencia (9 tienen URL sin referencia y 128 carecen de URL).
- **11 en cola** carecen de la pareja URL+referencia. Deben revisarse individualmente antes de ofrecer una demo; no borrar ni inventar snapshots históricos.
- **23 en cola** carecen de fecha o snapshot de incorporación. No asumir que son los mismos 11 sin URL+referencia; calcular intersección por UUID.
- **0** perfiles con `manual_queue_hold=true` actualmente; no demuestra que el mecanismo de exclusión funcione.
- Todas las 476 filas tienen score; score presente no equivale a contacto comercial validado.

Consulta reproducible:

```sql
select status, count(*) total,
 count(*) filter(where nullif(profile->>'demo_listing_url','') is not null) has_listing,
 count(*) filter(where nullif(profile->>'demo_listing_reference','') is not null) has_reference,
 count(*) filter(where nullif(profile->>'demo_listing_url','') is not null
                   and nullif(profile->>'demo_listing_reference','') is not null) has_both,
 count(*) filter(where score is not null) has_score
from public.prospect_profiles group by status order by status;
```

Próximo lote recomendado: cruzar por `account_id` los 11 en cola sin URL+referencia y los 23 sin procedencia; verificar fuentes públicas, contactos y elegibilidad antes de cualquier escritura canónica. Separar las 137 faltas de datos del conjunto de 298 originales hasta establecer identificadores inmutables. **NO-GO** para despliegue hasta pruebas de concurrencia, exclusión manual, 48/24h, A/B y paridad Chapa Labs.
