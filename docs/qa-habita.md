# QA diario de Habita

Guía para retomar el QA de www.habitaia.app en cada sesión nueva.

## Regla principal

- Gastar como máximo una generación por flujo, la mínima, y leer el «Costo estimado» en pantalla antes de generar.
- Video: usar el estilo Clásico, que no consume créditos.
- No comprar créditos ni planes y no completar pagos. Si algo pide pago, frenar y avisar.

## Cómo entrar

Las credenciales de QA están en Vercel (proyecto amoblaia, producción): `HABITA_QA_EMAIL` y `HABITA_QA_PASSWORD`.

1. Si la sesión no tiene esas variables en su entorno, leerlas de Vercel y pasarlas solo en el comando, sin guardarlas en disco.
2. Correr `node scripts/qa-login.mjs <sesion.json> --check`.
   - «OK: /admin abre (200)»: listo.
   - «Invalid login credentials»: la contraseña de Vercel no coincide con la de la cuenta.
3. Usar el archivo de sesión con Playwright (`storageState`) y borrarlo al terminar.

## Dónde probar

- Panel de la inmobiliaria de QA de la cuenta: `/panel` (QA_Habita, slug `qa-habita-2`).
- Inmobiliaria de prueba original, edición administrativa: `/admin/inmobiliarias/67b74437-b305-41a3-bada-42205ae090aa/editar`.
- Flujos prioritarios: crear demostración, estudio de imágenes y video. Después, el resto del panel, el admin, las demos públicas y móvil.

## QA automático

El skill `.claude/skills/qa-habita/SKILL.md` tiene el procedimiento completo (errores de Vercel y Supabase, flujos con Playwright, corrección, merge y registro). Puede correr más de una vez por día, sin hora garantizada: lo que vale es la hora registrada en cada corrida.

## Para quien lee este archivo (Astra)

Buscá `### QA <fecha de hoy> am` o `pm`, con la fecha de Argentina. Si no está, ese día todavía no hay QA: no uses el de otro día como si fuera de hoy. Mirá `Estado` y `PostHog revisado hasta` para saber qué se cubrió de verdad. Este archivo es público: no trae métricas comerciales ni grabaciones, que se consultan directo en PostHog. Ver `docs/CRO_INSTRUMENTACION.md`.

## Listas vivas

### Observaciones abiertas

- **OBS-001** El video toma el título «Propiedad nueva» si el borrador no tiene título.
- **OBS-002** La nota «Generar crea otra» junto a «(sin costo)» puede confundir (`src/components/editor-photos.tsx`).
- **OBS-003** Los estilos de video Equilibrado y Cinematográfico figuran como «No disponible» en la cuenta y no se probaron.

### Propuestas UX pendientes

Para que Astra las evalúe. Claude no las implementa sin aprobación.

- Ninguna registrada todavía con este formato. OBS-002 es candidata.

### PRs de usabilidad abiertos

- Ninguno con título `UX:` al 5/11/2026.

## Plantilla de cada corrida

```markdown
### QA AAAA-MM-DD am|pm

- Inicio: <ISO con zona> · Fin: <ISO con zona>
- Commit: <sha corto> · Despliegue: <id o sha> · Estado: completo|parcial|fallido
- Tipo: completa|liviana · Pantallas: <lista>
- Flujos revisados: <lista> · Sin revisar: <lista y motivo>
- Bugs encontrados: <lista o «ninguno»> · Corregidos: <PR o «ninguno»>
- Observaciones nuevas: <OBS-NNN o «ninguna»> · Propuestas nuevas: <UX-NNN o «ninguna»>
- PRs de usabilidad abiertos: <lista o «ninguno»>
- PostHog revisado hasta: <ISO con zona> · cobertura: completa|parcial|sin acceso · <áreas revisadas y qué faltó, sin cantidades>
- Esperado, no es bug: <lista o «nada nuevo»>
```

Sin nombres, teléfonos, emails, enlaces a grabaciones, IDs de sesión, tasas de conversión ni cantidades de usuarios o sesiones.

## Resultados

### QA 2026-11-06 am

- Inicio: 2026-11-06T08:51:52-03:00 · Fin: 2026-11-06T08:52:27-03:00
- Commit: 5aa52ec · Despliegue: no se pudo consultar (Vercel 403) · Estado: fallido
- Tipo: completa (mañana) · Pantallas: ninguna
- Flujos revisados: ninguno · Sin revisar: todos los de Playwright, porque el sandbox no tiene `HABITA_QA_EMAIL`/`HABITA_QA_PASSWORD` y el proxy rechaza el acceso a www.habitaia.app; errores de Vercel, por 403 del conector (hay que autorizar el acceso al equipo)
- Bugs encontrados: ninguno · Corregidos: ninguno
- Observaciones nuevas: ninguna · Propuestas nuevas: ninguna
- PRs de usabilidad abiertos: ninguno
- PostHog revisado hasta: 2026-11-06T08:52:27-03:00 · cobertura: parcial · solo un conteo agregado de fricción en demos y panel (clics repetidos en la presentación de la demo, aislados); falta el análisis de rebote, fotos, comparación, conversión y embudo del panel. Los eventos de clics muertos y excepciones no existen en el proyecto, así que no se pueden medir
- Esperado, no es bug: nada nuevo

Las corridas nuevas van acá, la más reciente primero. Las anteriores al 6/11/2026 conservan su formato original.

## Resultado del QA del 5/11/2026 pm (segunda corrida)

Corrida liviana (17:51 h Argentina). Sin bugs nuevos; no hubo nada que corregir.

- Pantallas: escritorio 1366×900, iPhone 13 y Galaxy S8 (demos con red lenta y con user agent de WhatsApp).
- Errores de Vercel (24 h): los mismos 6 grupos de la corrida anterior; el último de `window is not defined` (15:32 UTC) es anterior al deploy actual (`ad0f3a0`, READY). Los de cron (09:45) se confirman mañana.
- Sesión de QA: OK. Sin errores de consola ni de red, sin scroll horizontal y sin placeholders en `/panel`, `/panel/propiedades`, `/precios`, `/acceso`, demo publicada (`/demo/<token>` y `/presentacion`) en las tres pantallas; `og:title`, `og:description` y `og:image` presentes.
- `/demo/<token-inexistente>`: página 404 clara en castellano con «Volver al inicio».
- Las demos de QA en borrador dan 404 en `/demo/<token>` aun con la sesión de QA: esperado, solo se ven publicadas.
- Accesibilidad (`serious`, ya conocidas): contraste en `/panel` (5 nodos), `/acceso` en celular (5) y demo pública (1 contraste y 1 `aria-prohibited-attr`).
- Carga de la demo pública con red lenta: 8–9 s hasta `load` en celular (con imágenes); no hay medición de LCP todavía.
- No se hicieron: generaciones (crear demo, estudio, video), tablet, caminos de error de subida; la corrida de la tarde no los incluye y no hay cambios de código en esos flujos.
- PostHog: sin conector en esta sesión; el paso 3 quedó sin hacer.
- Sigue abierta la observación 1 (la demo publicada de QA se titula «Propiedad nueva»).

## Resultado del QA del 5/11/2026 pm

Sin bugs nuevos; no hubo nada que corregir.

- Errores de Vercel (24 h): todos los grupos son anteriores al deploy de #140/#139 (`window is not defined`, barridos del cron, `limit` de Mercado Pago, `IMPORT_UPDATE_FAILED`). Hay que confirmar mañana que no reaparezcan.
- Supabase (logs de Postgres): solo errores de consultas sueltas del 5/11 (columnas inexistentes, tipos) y el check de `property_imports_snapshot_check` ya corregido en #139.
- Con sesión de QA, escritorio y celular, sin errores de consola ni de red y sin scroll horizontal: `/`, `/precios`, `/acceso`, `/panel` y sus 11 subpáginas, ficha de propiedad, `/admin`, inmobiliarias (lista y ficha de prueba), prospección, demos, `/demo/<token>` y `/presentacion`.
- No se hicieron generaciones (crear demo, estudio, video Clásico): se evitó gastar créditos en una corrida sin cambios de código en esos flujos desde el 3/11.
- Sigue abierta la observación 1: la demo de QA se titula «Propiedad nueva».

## Resultado del QA del 5/11/2026

Errores de producción corregidos en [#140](https://github.com/axellaban/amoblaia/pull/140):

- `/admin/inmobiliarias/[id]`: «window is not defined» en el servidor (43 veces). Lo causaba `publicLink` en la vista previa de «Enviar demo».
- Cron: Mercado Pago rechaza `limit=20` en `/authorized_payments/search`, y la conciliación de checkouts quedaba diferida todos los días.
- Cron: los barridos de precio de lanzamiento y de suscripciones reembolsadas fallaban todos los días desde el 23/10, porque `202610230002_billing_audit` no estaba aplicada. Se aplicó solo lo que faltaba, con [202611270001_billing_sweeps.sql](https://github.com/axellaban/amoblaia/blob/main/supabase/migrations/202611270001_billing_sweeps.sql).

Sin hacer: los flujos con sesión (crear demo, estudio, video, demos), porque esta sesión no tenía `HABITA_QA_EMAIL` ni `HABITA_QA_PASSWORD`. Las páginas públicas cargan sin errores en escritorio y celular.

Errores conocidos que no se tocaron:
- `/api/admin/video-musica`: la clave de fal no tiene acceso a los modelos de música (403). Se resuelve en la cuenta de fal, no en el código.
- `/api/asistente`: timeouts de 60 s el 30/10, sin repetirse desde entonces.

## Resultado del QA del 3/11/2026

- Crear demostración (subir fotos, borrador, editor): funciona.
- Estudio de imágenes: una versión «Moderno» generada; costó 1 crédito.
- Video Clásico: MP4 vertical 1080×1920 generado.
- Panel, admin, demos públicas y móvil: cargan sin errores.

### Esperado, no es bug

- `/inmobiliaria/qa-habita` da 404 mientras el catálogo no esté publicado.
- «Generar versión (sin costo)»: el costo se cobra una vez por foto, no por estilo.
- Abrir la edición administrativa hace `POST …/edicion`: inicia la sesión de edición, no guarda datos.

Las observaciones de esta corrida pasaron a «Listas vivas» como OBS-001 a OBS-003.
