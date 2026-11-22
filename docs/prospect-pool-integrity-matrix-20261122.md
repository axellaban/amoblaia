# Auditoría de integridad del pool — 2026-11-22 (16:34 AR)

Fuente: consulta de solo lectura a Supabase proyecto `cmpfwuycxdleunuumlkm`, tabla `public.prospect_profiles`. No se modificaron registros. Los conteos describen presencia de campos, **no** verificación externa de su contenido.

| Estado | Total | URL demo | Referencia | Confianza número | Fotos importables = si | Sin queued_at | Sin snapshot | Exploración |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| descubierto | 244 | 116 | 107 | 19 | 0 | — | — | 0 |
| en_cola | 232 | 221 | 221 | 205 | 117 | 23 | 23 | 0 |

## Consulta reproducible

```sql
select status, count(*) total,
 count(*) filter (where nullif(profile->>'demo_listing_url','') is not null) has_url,
 count(*) filter (where nullif(profile->>'demo_listing_reference','') is not null) has_reference,
 count(*) filter (where profile->>'number_confidence' is not null) has_confidence,
 count(*) filter (where profile->>'demo_photos_importable'='si') importable_yes,
 count(*) filter (where queued_at is null and status='en_cola') missing_queue_date,
 count(*) filter (where queue_snapshot is null and status='en_cola') missing_snapshot,
 count(*) filter (where explore is true) exploration
from public.prospect_profiles group by status order by status;
```

## Implicancias para QA

- El grupo descubierto carece por completo de confirmaciones positivas de importabilidad. **No convertir la presencia de URL/referencia en aprobación de demo**.
- Hay 117 perfiles en cola con importabilidad positiva declarada, pero otros 115 no tienen esa confirmación positiva. Revisar política histórica de entrada y si es consistente con la nueva elegibilidad, sin sacar automáticamente perfiles ni recontactarlos.
- Hay 23 perfiles en cola sin fecha y 23 sin snapshot; no inferir que son necesariamente los mismos sin comprobar la intersección por account_id.
- No hay ningún perfil marcado explore; verificar que el 15% se materialice en incorporaciones nuevas y no se alteren cohortes históricas.
- La cohorte histórica de 298 sigue sin manifiesto inequívoco: **no asignar identidades por fecha de creación**.

Siguiente lote: identificar la intersección exacta de los 23, examinar por qué 115 perfiles en cola carecen de confirmación positiva, ejecutar tests de exclusión manual persistente y concurrencia; no desplegar sin QA aprobado. Rutina diaria de 300 a las 09 AR: mantener independiente, sin crear otra tarea ni enviar WhatsApp.
