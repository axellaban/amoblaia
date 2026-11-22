# Cohortes de creación del pool HABITA — 2026-11-22

Auditoría de solo lectura contra Supabase proyecto `cmpfwuycxdleunuumlkm`, tabla `public.prospect_profiles`. No se modificaron registros.

## Resultado observado
| created_at (UTC) | status | cantidad | sin queued_at | sin queue_snapshot | explore=true |
|---|---|---:|---:|---:|---:|
| 2026-11-11 | descubierto | 244 | — | — | 0 |
| 2026-11-11 | en_cola | 150 | 23 | 23 | 0 |
| 2026-11-18 | en_cola | 82 | 0 | 0 | 0 |
| Total | | 476 | 23 | 23 | 0 |

Los 23 incompletos están exclusivamente en la cohorte de creación del 11/11. Los 82 creados el 18/11 están todos en cola y tienen ambos campos; no se puede deducir que la rutina diaria haya creado estos 82 sin cotejar logs y procedencia. Los 394 creados el 11/11 tampoco identifican por sí solos a los 298 originales: `created_at` es fecha del perfil, no necesariamente del descubrimiento de la cuenta.

## SQL reproducible
```sql
select created_at::date as day, status, count(*) n,
 count(*) filter(where queued_at is null and status='en_cola') missing_queued_at,
 count(*) filter(where queue_snapshot is null and status='en_cola') missing_snapshot,
 count(*) filter(where explore is true) explore_n
from public.prospect_profiles
group by 1,2 order by 1,2;
```

## Implicancias y próximos controles
1. Priorizar reconstrucción de procedencia de los 23 perfiles creados el 11/11 usando eventos reales; nunca sintetizar fecha ni snapshot.
2. Comparar los 82 perfiles creados el 18/11 con auditoría de importación y operaciones canónicas antes de atribuirlos a la rutina de 300/día.
3. Identificar la cohorte original de 298 mediante manifiesto o trazabilidad de cuentas, no por fecha de creación del perfil.
4. `explore=true` es cero en ambas cohortes; esto requiere verificar el flujo real de inserción y el algoritmo, sin concluir que el 15% esté roto por esta métrica aislada.
5. Mantener QA NO-GO hasta validar exclusiones persistentes, concurrencia, contactos externos, cupo 48/24h, A/B y Chapa Labs.

No se ejecutaron tests, deploy ni mensajes WhatsApp en esta auditoría.
