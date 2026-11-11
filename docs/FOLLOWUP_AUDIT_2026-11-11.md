# Auditoría de cola, estados y confirmación de envíos — 11 nov 2026

Backlog CRO #37. Lectura del código en `main` (rutas `/api/admin/followup/*`, `src/lib/followup/server.ts`, RPC `habita_followup_mark` y `habita_followup_mark_capped`) y de los tests existentes. **Sin consultas a producción, sin envíos y sin cambios de datos.** Lo que necesita datos reales queda como verificación pendiente, al final.

Datos de la planilla (10/11): 130 ejecuciones (110 `sent`, 15 `opened`, 5 `failed`), 28 reglas (20 activas), 125 overrides de agencias.

## 1. ¿«sent» es un envío real?

**No es evidencia de entrega.** `sent` lo escribe `POST /api/admin/followup/confirm` cuando el operador (o Chapa por `/api/prospeccion`) dice que el mensaje salió («visto en el chat»). No hay ninguna confirmación de WhatsApp: ni id de mensaje, ni estado de entrega o lectura.

| Estado | Qué significa de verdad |
| --- | --- |
| `sent` (110) | Alguien confirmó que lo mandó. Es una declaración, no una entrega. |
| `opened` (15) | Se abrió WhatsApp con el mensaje y **nunca se confirmó ni se marcó como fallido**. Puede haber salido o no. |
| `failed` (5) | No salió, con motivo. |

**Riesgo 1 (P1): los `opened` sin confirmar no cuentan para el cupo ni bloquean.** El cupo de primeros contactos solo cuenta `sent`. Si alguien abrió WhatsApp, mandó el saludo y no confirmó, ese contacto no consume cupo y la inmobiliaria **sigue en la cola**: solo se muestra el aviso «Se abrió WhatsApp… revisá el chat antes de reenviar» (`blockReason` no la bloquea). Con 15 `opened`, el cupo real puede estar subestimado hasta en 15 y hay riesgo de saludar dos veces a la misma inmobiliaria.
Propuesta (no implementada, es una decisión de operación): que un `opened` de primer contacto de las últimas 24 h cuente para el cupo y bloquee la inmobiliaria hasta que se confirme o se marque fallido.

## 2. Idempotencia de «confirmar envío»

En la base es idempotente: una fila por `(version_id, agency_id)` y un `sent` nunca se pisa (`on conflict … where status <> 'sent'`). Un `failed` u `opened` posterior tampoco lo revierte. Hay tests (`tests/followup-database.test.ts`).

**Hallazgo (P1, corregido en este PR): en la API no lo era.** La comprobación de repetido comparaba con la acción *actual* de la inmobiliaria. Después de un `sent` la inmobiliaria avanza de etapa, así que un reintento (respuesta perdida, doble clic, reintento de Chapa) no se reconocía como repetido: caía en `sameTask` y respondía **409 «Ya no está en …»** para un envío que sí salió. Quien opera puede leer eso como un error y volver a mandar.

**Corrección:** la comprobación lee la fila guardada de `followup_executions` para esa versión e inmobiliaria; si ya está `sent`, devuelve `replayed: true` sin escribir. Además ahorra una lectura completa de la cola por cada confirmación (antes se armaba el tablero hasta tres veces). Test: `tests/followup-confirm-replay.test.ts`.

**Riesgo 2 (P2, a verificar con datos): una misma versión no se puede registrar dos veces para la misma inmobiliaria.** Si una regla repite el mismo mensaje en otro ciclo (por ejemplo, un recontacto que vuelve a «No responde» con la misma versión), el segundo envío queda como repetido y no se registra. Verificar en «Mensajes y reglas» si alguna situación de recontacto vuelve a usar la versión de una etapa anterior.

## 3. Cupo de primeros contactos (48 / 24 h)

- Es configurable (`followup_quota_settings.cap`, 48 por defecto) y se aplica en la base con un bloqueo transaccional al confirmar. Cuenta inmobiliarias distintas (Follow-up + Adquisición paso 1), sin doble conteo, más la estimación manual de saludos externos de las últimas 24 h. Hay tests.
- **Hallazgo (P2, corregido en este PR):** el mensaje de error decía «límite interno de **50**» aunque el cupo configurado sea 48 (u otro). Ahora muestra el valor configurado.
- Sigue abierto el riesgo 2 de la auditoría del 9/11: Adquisición no toma el mismo bloqueo, así que dos confirmaciones simultáneas por caminos distintos podrían pasar el límite por una.
- «Ya saludado» (`registerManualGreeting`) usa el RPC sin cupo a propósito: es conciliación de algo que ya pasó, no permiso para mandar.

## 4. Contadores y consistencia entre lecturas

- `tests/followup-cola-api-consistency.test.ts` («dos GET consecutivos…») **no prueba la consistencia real**: simula `followupQueueView` entero, así que compara dos veces el mismo objeto armado a mano. Sirve para el formato de la ruta, no para el criterio de la planilla.
- El test de base «dos lecturas consecutivas» compara conteos crudos de tablas, no la cola armada (orden, bloqueos, asignación de cupo).
- La confirmación no es atómica entre sistemas: primero guarda la ejecución y después registra el envío en Adquisición. Si lo segundo falla, queda un aviso, pero los contadores de Follow-up y Adquisición pueden diferir. Para medir la diferencia, ver la consulta B.

## 5. Verificación pendiente (necesita datos o sesión)

Consultas de solo lectura para el SQL Editor de Supabase:

```sql
-- A. Primeros contactos «opened» sin confirmar en las últimas 72 h (riesgo 1).
select e.agency_id, a.name, e.updated_at
from followup_executions e join agencies a on a.id = e.agency_id
where e.stage = 'no-contactado' and e.status = 'opened' and e.updated_at > now() - interval '72 hours'
order by e.updated_at desc;

-- B. Confirmados en Follow-up sin su envío en Adquisición (paso 1), últimos 7 días.
select e.agency_id, e.sent_at
from followup_executions e
join prospect_accounts pa on pa.agency_id = e.agency_id
where e.stage = 'no-contactado' and e.status = 'sent' and e.sent_at > now() - interval '7 days'
  and not exists (select 1 from outreach_attempts t where t.account_id = pa.id and t.step = 1 and t.status = 'sent');
```

- Dos `GET /api/admin/follow-up/cola` seguidos con la misma sesión, comparando inmobiliarias, etapas, `summary` y bloqueadas (no se pudo hacer: requiere sesión del equipo).
- Paridad con Chapa Labs: mismos conteos por etapa en `/prospecting/habita` y en `/admin/prospeccion`.
