# QA diario de Habita

Guía para retomar el QA de www.habitaia.app en cada sesión nueva.

## Regla principal

- Gastar como máximo una generación por flujo, la mínima, y leer el «Costo estimado» en pantalla antes de generar.
- Video: usar el estilo Clásico, que no consume créditos.
- No comprar créditos ni planes y no completar pagos. Si algo pide pago, frenar y avisar.

## Cómo entrar

Las credenciales de QA están en Vercel (proyecto amoblaia, producción): `HABITA_QA_EMAIL` y `HABITA_QA_PASSWORD`.

1. Si la sesión no tiene esas variables en su entorno, leerlas de Vercel y pasarlas solo en el comando, sin guardarlas en disco.
2. Correr `NODE_USE_ENV_PROXY=1 node scripts/qa-login.mjs <sesion.json> --check` (sin esa variable, el `fetch` de Node no pasa por el proxy del sandbox y falla con «fetch failed»).
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
- **OBS-004** En Android chico (Galaxy S8), el selector «¿Con qué querés empezar?» pasa la cruz de cerrar a una segunda línea bajo el título y la miniatura de «Seguir con …» se vio vacía en la captura (posible carga diferida). Aislado; ver si se repite.
- **OBS-005** En la presentación de la demo pública en Android chico (Galaxy S8), la fila de pestañas «Sobre la propiedad / Galería / Contacto» queda cortada a la derecha (sin indicio de que se desliza) y debajo queda un bloque vacío alto. Visto en la demo de QA, que no tiene descripción; ver si pasa en una demo con datos completos.

### Propuestas UX pendientes

Para que Astra las evalúe. Claude no las implementa sin aprobación.

- **UX-001** Contraste bajo en la guía de la home del panel (`panel-guide.tsx`): el texto gris de «Por qué importa» sobre el verde bosque (`.hg-why-lead`, `.hg-why-note`) y las notas chicas sobre arena (`.hg-social-art small`, `.hg-reel-copy small`) no llegan a 4.5:1 (axe `color-contrast`, serious). Escritorio; se repitió en celular el 6/11 pm. Reproducido.
- **UX-002** La demo pública (`/demo/<token>` y `/presentacion`) tarda más de 5 s en cargar en Android chico con red de celular lenta, sin un indicador de avance claro durante la espera. Reproducido una vez. Se midió de nuevo el 6/11 pm (segunda corrida): la imagen principal aparece en menos de 5 s, pero la página termina de cargar recién después de 9 s; sigue abierta para confirmar con datos reales.
- **UX-003** La demo pública tiene un atributo ARIA prohibido (axe `aria-prohibited-attr`, serious) en todas las pantallas, y un texto de bajo contraste en celular (`color-contrast`, serious). Reproducido en `/demo/<token>` y `/presentacion`.
- OBS-002 sigue siendo candidata.

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

### QA 2026-11-06 pm (reintento)

- Inicio: 2026-11-06T18:52:02-03:00 · Fin: 2026-11-06T18:55:00-03:00
- Commit: 5faaed3 (#173) · Despliegue: producción READY · Estado: completo (lo que corresponde a la corrida liviana)
- Tipo: liviana · Pantallas: escritorio 1366×900, iPhone 13, Galaxy S8 (también con red lenta y con user agent de WhatsApp)
- Flujos revisados: sesión de QA (OK, con `NODE_USE_ENV_PROXY=1`); demo publicada de QA (`/demo/<token>` y `/presentacion`) en las tres pantallas, con red lenta y con WhatsApp: 200, sin errores de consola ni de red, sin scroll horizontal, sin imágenes rotas ni placeholders, `og:*` presentes; `/demo/<token-inexistente>` muestra el 404 propio, claro; `/panel` en escritorio y iPhone 13 y `/panel/propiedades` en iPhone 13: sin errores. Axe y capturas en cada pantalla.
- Sin revisar: estudio de imágenes, video y crear demo (corrida liviana, sin cambios en esos flujos); logs de Postgres.
- Bugs encontrados: ninguno · Corregidos: ninguno. El intento anterior falló por la red del entorno (ya habilitada) y porque el `fetch` de Node no usaba el proxy; el skill ahora corre `qa-login` con `NODE_USE_ENV_PROXY=1`.
- Observaciones nuevas: OBS-005 · Propuestas nuevas: ninguna. Se repiten UX-001 (contraste en `/panel`, escritorio y celular), UX-002 (medida de nuevo) y UX-003 (ARIA prohibido y contraste en la demo, todas las pantallas). En escritorio, la primera carga de la demo superó los 3 s; las siguientes quedaron debajo.
- PRs de usabilidad abiertos: ninguno con título `UX:`
- PostHog revisado hasta: 2026-11-06T18:55:00-03:00 · cobertura: parcial · sin cambios respecto del registro anterior.
- Esperado, no es bug: la demo de QA se titula «Propiedad nueva» porque no tiene título (OBS-001).

### QA 2026-11-06 pm

- Inicio: 2026-11-06T18:45:59-03:00 · Fin: 2026-11-06T19:05:00-03:00
- Commit: 524d432 (#171) · Despliegue: dpl_gh85qNy14a1E7WhRZbDhgZrwNm5a (production, READY) · Estado: parcial
- Tipo: liviana · Pantallas: ninguna
- Flujos revisados: errores de Vercel (24 h: ninguno); PostHog por consulta agregada de tráfico en `/demo/*` y `/panel*` desde el corte anterior.
- Sin revisar: todos los de Playwright (sesión de QA, demos públicas, panel en celular), porque el proxy del sandbox responde 403 a www.habitaia.app y a Supabase y `qa-login` falla con «fetch failed»; logs de Postgres (el esquema de `query_logs` rechazó las consultas); el análisis fino de PostHog (rebote, fotos, comparación, conversión, embudo del panel) por poco tráfico externo.
- Bugs encontrados: ninguno · Corregidos: ninguno
- Observaciones nuevas: ninguna · Propuestas nuevas: ninguna. Siguen abiertas UX-001, UX-002 y UX-003
- PRs de usabilidad abiertos: ninguno con título `UX:`
- PostHog revisado hasta: 2026-11-06T19:00:00-03:00 · cobertura: parcial · conteo de fricción en demos y panel: sin clics repetidos. En el proyecto no existen los eventos de clics muertos ni de excepciones, así que no se pueden medir.
- Esperado, no es bug: el bloqueo del proxy es del entorno, no de producción.

### QA 2026-11-06 pm

- Inicio: 2026-11-06T17:51:56-03:00 · Fin: 2026-11-06T18:10:00-03:00
- Commit: 1e3170a (#170) · Despliegue: dpl_Gjy4XeEqZF4qLT2dY52Rs3zBXXo4 (production, READY) · Estado: parcial
- Tipo: liviana · Pantallas: escritorio 1366×900, iPhone 13, Galaxy S8 (también con red lenta y con user agent de WhatsApp para la demo pública)
- Flujos revisados: errores de Vercel (24 h: ninguno) y logs de Postgres (solo un error de sintaxis de una consulta suelta); sesión de QA (OK); `/panel` en escritorio y celular; demo publicada de QA (`/demo/<token>` y `/presentacion`) en las pantallas anteriores: carga 200, sin errores de consola ni de red, sin scroll horizontal, sin imágenes rotas, sin placeholders, `og:title`, `og:description` y `og:image` presentes; en escritorio el LCP queda debajo de 2 s.
- Sin revisar: PostHog (el conector no está disponible en esta sesión); estudio de imágenes, video y crear demo (corrida liviana, sin cambios de código en esos flujos); caminos de error de subida; `/admin`.
- Bugs encontrados: ninguno · Corregidos: ninguno
- Observaciones nuevas: ninguna · Propuestas nuevas: UX-003. Se repiten UX-001 (ahora también en celular) y UX-002
- PRs de usabilidad abiertos: ninguno con título `UX:`
- PostHog revisado hasta: sin cambios · cobertura: sin acceso
- Esperado, no es bug: los borradores de demo dan 404 en `/demo/<token>` hasta publicarse.

### QA 2026-11-06 am

- Inicio: 2026-11-06T11:35:32-03:00 · Fin: 2026-11-06T11:52:00-03:00
- Commit: 2c4ab7f (recorrido de bienvenida del panel, axellaban/amoblaia#156) · Despliegue: dpl_3HoYcWotPxCU4KT72dGKErhdexa6 (el conector de Vercel sigue con 403; se confirmó en producción porque `/api/panel/recorrido` pasó de 404 a 200) · Estado: parcial
- Tipo: completa (recortada, con foco en el recorrido nuevo) · Pantallas: escritorio 1366×900, iPhone 13, Galaxy S8, iPad (gen 7); Galaxy S8 con red lenta y con user agent de WhatsApp para la demo pública
- Flujos revisados: recorrido de bienvenida con la sesión de QA en las cuatro pantallas (los 7 pasos y la pantalla final, el selector real en el paso 3, el menú lateral en celular, «Ayuda → Volver a ver el recorrido» en la home y desde `/panel/propiedades`, Escape, reaparición solo una vez: la API pasa a «no elegible» después de verlo y se guarda en `profiles`). Sin errores de consola ni de red, sin scroll horizontal, la tarjeta siempre dentro de la pantalla; la única escritura es marcar el recorrido como visto. También: demo publicada de QA (`/demo/<token>` y `/presentacion`) en escritorio, iPhone 13, Galaxy S8 con red lenta y WhatsApp, `og:*` presentes; `/`, `/precios`, `/acceso` y `/demo/<token-inexistente>` (404 claro) en escritorio y celular; axe en `/panel` y en la pantalla final del recorrido; logs de Postgres desde el despliegue.
- Sin revisar: generaciones (crear demo con fotos, estudio de imágenes, video Clásico), caminos de error de subida y `/admin`, porque el cambio desplegado no toca esos flujos y se evitó gastar créditos; errores de Vercel, por el 403 del conector.
- Bugs encontrados: ninguno · Corregidos: ninguno
- Observaciones nuevas: OBS-004 · Propuestas nuevas: UX-001, UX-002
- PRs de usabilidad abiertos: ninguno
- PostHog revisado hasta: 2026-11-06T11:50:00-03:00 · cobertura: parcial · conteo agregado de tráfico externo y fricción en demos y panel desde el corte anterior: sin clics repetidos ni excepciones, sin sesiones externas en el panel. Los eventos `panel_tour_*` no se pudieron ver porque la red del sandbox bloquea PostHog; se confirman con la primera inmobiliaria nueva.
- Esperado, no es bug: la cuenta de QA vio el recorrido por sí solo porque su membresía es reciente (menos de 14 días); en el paso 3 de celular la tarjeta tapa el final del selector porque no entra en otro lugar, y el selector no se puede tocar durante el recorrido.

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

### QA 2026-11-06 am

- Inicio: 2026-11-06T08:52-03:00 · Fin: 2026-11-06T09:20-03:00
- Commit: 5aa52ec · Despliegue: dpl_FhRwPCYmtCyJ69wDMoxEx9TBuAxK (READY) · Estado: parcial
- Tipo: completa (recortada) · Pantallas: escritorio 1366×900, iPhone 13, Galaxy S8, iPad (gen 7)
- Flujos revisados: errores de Vercel (24 h) y logs de Postgres; con sesión de QA, `/`, `/precios`, `/acceso`, `/panel`, `/panel/propiedades`, `/admin`, `/admin/inmobiliarias`, `/admin/prospeccion`, demo publicada (`/demo/<token>` y `/presentacion`) y `/demo/<token-inexistente>` en las cuatro pantallas: sin errores de consola ni de red, sin scroll horizontal, sin placeholders; `og:title`, `og:description` y `og:image` presentes.
- Sin revisar: generaciones (crear demo, estudio de imágenes, video Clásico) porque no hubo cambios de código en esos flujos desde el 3/11 y se evitó gastar créditos; caminos de error de subida; red lenta y user agent de WhatsApp; accesibilidad y capturas; PostHog (sin conector en esta sesión).
- Bugs encontrados: ninguno nuevo · Corregidos: ninguno
- Observaciones nuevas: ninguna · Propuestas nuevas: ninguna
- PRs de usabilidad abiertos: no consultados
- PostHog revisado hasta: sin cambios · cobertura: sin acceso
- Esperado, no es bug: `window is not defined` en `/admin/inmobiliarias/[id]` y `IMPORT_UPDATE_FAILED` tienen su último registro el 5/11, anterior a los deploys actuales (arreglados en #140 y #152). El cron muestra un 429 `local_rate_limited` de Mercado Pago en la conciliación de checkouts (diferida, se reintenta; no se tocó por ser de cobros). Los errores de Postgres de la noche son consultas sueltas de sesiones anteriores (columnas inexistentes) y `BUSY`.

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
