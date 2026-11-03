# Métricas para el tablero de Chapa Labs (`/api/metricas`)

El tablero de seguimiento (`facundogregorini-lab/chapa-labs`) lee de acá la prospección, las demos y los ingresos de habita. El endpoint devuelve **solo totales y series por día**: nada de nombres, teléfonos, emails ni ids de usuario.

## Acceso

- `GET /api/metricas` con `Authorization: Bearer $METRICS_SECRET`. Sin la variable (o con menos de 32 caracteres) responde 401 siempre.
- Opcional: `?desde=AAAA-MM-DD&hasta=AAAA-MM-DD` (hora de Buenos Aires).
- En Vercel: `METRICS_SECRET` acá y el mismo valor como `HABITA_METRICS_SECRET` en el proyecto `chapa-labs`. No necesita migraciones.

## Qué devuelve

| Bloque | De dónde sale | Campos |
| --- | --- | --- |
| `prospeccion` | `habita_prospect_dataset()` con las reglas de `src/lib/prospecting/metrics.ts`, las mismas del panel `/admin/prospeccion` | `prospectados`, `contactados` (cuentas con envío confirmado), `mensajes`, `respondieron`, `interesados`, `vinculados`, `activados`, `clientes`, `demos` (pasos de las demos de las cuentas prospectadas), `etapas` (cuentas por etapa), `porSdr`, `porCanal` y `diario` (`envios`, `nuevos`, `respuestas`, `interesados`, `reuniones`) |
| `demos` | `demos` y `demo_activity`: todas las demos comerciales, prospectadas o no | `creadas`, `publicadas`, `ingresaron`, `interactuaron`, `generaron`, `panel`, `suscribieron` (el paso más alto de cada demo), `visitantes` y `diario` por tipo de actividad |
| `ingresos` | `payments` aprobados (también con reembolso parcial) | `pagos`, `ingresos` (ARS), `nuevos` (primer pago en el período), `clientes` (compradores en total) y `diario` |

Con rango de fechas: la prospección cuenta la cohorte del primer envío (como el panel), las demos se cuentan por fecha de creación, y la actividad y los pagos, por su fecha.

Código: `src/app/api/metricas/route.ts` y `src/lib/metrics/summary.ts`. Tests: `tests/metrics-summary.test.ts`.
