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
- **OBS-005** En la presentación de la demo pública en Android chico (Galaxy S8), la fila de pestañas «Sobre la propiedad / Galería / Contacto» queda cortada a la derecha (sin indicio de que se desliza) y debajo queda un bloque vacío alto. Visto en la demo de QA, que no tiene descripción; ver si pasa en una demo con datos completos. **Se repite** el 6/11 pm (completa): en Android chico «Contactar» queda cortada en `/demo/<token>` y en `/presentacion` (la fila se desliza, `overflow-x: auto`, pero no hay indicio), y en el editor del panel en iPhone 13 la pestaña «Publicar» queda cortada igual. El bloque vacío es la sección «Sobre la propiedad» de una demo sin descripción: solo muestra la tarjeta de contacto.
- **OBS-006** Clics repetidos aislados en sesiones reales: el enlace «Continuar en mi panel» de la presentación en celular, un botón de `/panel/imagenes` y un formulario de la ficha del panel en escritorio. Uno por lugar; ver si se repiten.
- **OBS-007** Una inmobiliaria intentó importar la misma publicación varias veces seguidas y recibió el aviso de que ya estaba en su panel (409 `duplicateOf`). Funciona como debe; ver si el aviso se entiende o si se repite.
- **OBS-008** El 404 dentro del panel (ficha que no existe o no es de la inmobiliaria) muestra la cabecera y el pie del sitio público y «Volver al inicio» lleva a la home, no al panel. Visto con un enlace inválido.
- **OBS-009** Un 520 aislado de Storage al subir una foto de propiedad (5/11 a la noche). No se repitió.
- **OBS-010** (7/11 am) La consulta de grabaciones de PostHog (`session_replay_events`) no devolvió ninguna sesión en las últimas 72 h, ni siquiera internas. Las corridas anteriores sí tenían grabaciones. Ver si es de la consulta o si la grabación se cortó (`docs/CRO_INSTRUMENTACION.md`, receta de grabaciones).
- **OBS-011** (7/11 am) Un `lead_recompute_failed` aislado en `POST /api/demo/<token>/leads` (6/11 a la noche). Es el recálculo de puntaje «mejor esfuerzo»: se registra y el siguiente lote lo corrige. Ver si se repite.
- **OBS-012** (7/11 pm) Tres «statement timeout» de Postgres (`57014`) en las últimas 24 h: dos juntas en `/api/metricas` (a las 14:12 de Argentina, coincidieron con un deploy) y una en `/api/prospeccion` (13:42). Lecturas completas de `demos`, `demo_activity` y del dataset de prospección. Ver si se repite; si sí, paginar o indexar.
- **OBS-013** (8/11 am) Al terminar de generar un estilo en el editor de la propiedad (escritorio), el visor grande de antes/después desapareció de la captura hasta recargar y la miniatura de la versión nueva se vio en blanco un momento. Aislado; no se repitió al recargar. Ver si se repite.

### Propuestas UX pendientes

Para que Astra las evalúe. Claude no las implementa sin aprobación.

- **UX-001** Contraste bajo en la guía de la home del panel (`panel-guide.tsx`): el texto gris de «Por qué importa» sobre el verde bosque (`.hg-why-lead`, `.hg-why-note`) y las notas chicas sobre arena (`.hg-social-art small`, `.hg-reel-copy small`) no llegan a 4.5:1 (axe `color-contrast`, serious). Escritorio; se repitió en celular el 6/11 pm. Reproducido. **Se repite** el 7/11 am: el mismo contraste bajo (axe `color-contrast`, serious) también en `/`, `/acceso`, `/admin` e `/admin/inmobiliarias` en las cuatro pantallas.
- **UX-002** La demo pública (`/demo/<token>` y `/presentacion`) tarda más de 5 s en cargar en Android chico con red de celular lenta, sin un indicador de avance claro durante la espera. Reproducido una vez. Se midió de nuevo el 6/11 pm (segunda corrida): la imagen principal aparece en menos de 5 s, pero la página termina de cargar recién después de 9 s; sigue abierta para confirmar con datos reales. El 6/11 pm (completa): con red lenta el contenido aparece antes de 1,5 s con espacios grises en las miniaturas, y el botón de WhatsApp está listo en unos 4 s (debajo de 5 s). No se reprodujo; Astra decide si se cierra.
- **UX-003** La demo pública tiene un atributo ARIA prohibido (axe `aria-prohibited-attr`, serious) en todas las pantallas, y un texto de bajo contraste en celular (`color-contrast`, serious). Reproducido en `/demo/<token>` y `/presentacion`. **Se repite** el 6/11 pm (completa): el ARIA prohibido está en `.dv2-owner-habita` y el contraste en `.after-label` (etiqueta «Después», escritorio).
- **UX-004** La demo pública carga lento en escritorio: en sesiones reales la imagen principal (LCP) aparece bastante después de 3 s, y en el recorrido la primera carga en 1366×900 tardó más de 5 s (las siguientes, menos de 2 s). Evidencia real (PostHog, `$web_vitals`) y reproducido. Repetido.
- **UX-005** La ficha de una propiedad en el panel, en celular, muestra el editor a los 2 s pero las fotos de antes y después recién aparecen cerca de los 8 s, con recuadros grises sin indicador: las llamadas van una detrás de otra (`/api/session` → `/api/interno/estado` → `/api/panel/videos` → `/api/admin/demos/<id>`). En PostHog se repite el patrón de inmobiliarias que abren una ficha del panel en el celular y se van a los pocos segundos sin tocar nada. Reproducido en iPhone 13 (en escritorio, unos 7 s).
- **UX-006** En celular (iPhone 13 y Galaxy S8), el botón principal «Contactar por WhatsApp» de la demo pública queda debajo del primer pantallazo: hay que deslizar para verlo. Reproducido en `/demo/<token>` y `/presentacion`.
- **UX-007** Zonas táctiles chicas en la demo pública en celular: flechas «Anterior» y «Siguiente» de la galería (34×34 px), «Ver en pantalla completa» (40×40), el enlace «Contacto» del pie (61×22) y «Por habita.» en `/presentacion` (67×18). Menos de 44×44 px. Reproducido.
- **UX-008** En celular, si se lleva el control de la comparación cerca del borde derecho, queda encima de la flecha «Siguiente» de la galería y se superponen. Reproducido en iPhone 13 y Galaxy S8.
- OBS-002 sigue siendo candidata.

- **UX-009** Guardar la ficha sin conexión muestra «Failed to fetch» en inglés y sin explicar qué hacer (el reintento sí funciona). Pantalla: editor de la propiedad, pestaña «Datos» (escritorio). Falla el punto 7 de la lista (mensajes de error en castellano). Reproducido.
- **UX-010** Dejar vacío el título de la propiedad y guardar muestra solo el aviso nativo del navegador («Please fill out this field.» en un navegador en inglés), sin un mensaje propio junto al campo. Punto 7 de la lista. Reproducido en escritorio con navegador en inglés.
- **UX-011** (8/11 am) En `/panel/imagenes`, en celular (Galaxy S8), el aviso rojo «Elegí un estilo.» aparece apenas se abre la pantalla, antes de que la persona haya hecho algo, junto al botón «Generar versión» deshabilitado. Punto 7 de la lista (mensajes de error). Reproducido una vez.
- **UX-012** (8/11 am) En celular, el botón flotante del asistente «¿Te ayudo?» queda encima de los controles de la esquina de la foto en `/panel/imagenes` (los botones «Comparar» y de pantalla completa). Punto 2 de la lista. Reproducido en Galaxy S8.

### PRs de usabilidad abiertos

- Ninguno con título `UX:` al 6/11/2026 pm.

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

### QA 2026-11-09 am

- Inicio: 2026-11-09T07:33:01-03:00 · Fin: 2026-11-09T07:42:05-03:00 · Estado: parcial (ver «Sin revisar»)
- Commit: ec786f9 (#202) · Despliegue: dpl_7HDB49YnoXdeGqZV7TByYm1HLT66 (production, READY)
- Tipo: completa (mañana), recortada · Pantallas: escritorio 1366×900, iPhone 13, Galaxy S8 (también con red lenta y con el navegador de WhatsApp) e iPad (gen 7).
- Paso 2: errores de Vercel en 24 h: un solo grupo, `DATABASE_57014` en `/api/prospeccion` (OBS-012, se repite; el último fue ayer a la tarde). Sin errores SSR.
- Sesión de QA: OK. `/`, `/precios`, `/acceso`, `/panel`, `/panel/imagenes`, `/admin`, `/admin/inmobiliarias`, `/admin/prospeccion`, ficha de la inmobiliaria de prueba y token inexistente en las cuatro pantallas: 200 (404 propio para el token inexistente), sin errores de JavaScript propios, sin scroll horizontal ni placeholders, sin violaciones axe `critical`. Demo publicada de QA y `/presentacion` en las cuatro pantallas, con red lenta y con el navegador de WhatsApp: 200, `og:title`/`og:description`/`og:image` presentes, enlaces a `wa.me`, imágenes sin romper, botón «Siguiente» y comparación (clic/arrastre en escritorio y tablet, toque en celular) sin fallas, foco visible. Axe: solo `color-contrast`, y en la demo `aria-prohibited-attr`. Se miraron las capturas de la demo en Galaxy S8 con WhatsApp y la de `/panel` en Galaxy S8 (reducida, no legible a detalle).
- Dato de la corrida: la demo de QA más reciente está en borrador (da 404 público); se usó la publicada.
- Bugs encontrados: ninguno · Corregidos: ninguno
- Observaciones nuevas: ninguna · Propuestas nuevas: ninguna. Se repiten OBS-005, OBS-012, UX-001, UX-003, UX-006, UX-007 y UX-004 (carga de 5 a 6 s en escritorio, 10 s en Android con red lenta).
- PRs de usabilidad abiertos: ninguno con título `UX:`
- PostHog revisado hasta: 2026-11-09T07:42:05-03:00 · cobertura: parcial · ventana desde el corte del 8/11 am. Filtro de tráfico interno verificado. Casi sin tráfico externo: ninguna visita a demos ni al panel; sin clics repetidos ni excepciones; sin grabaciones (OBS-010 sigue igual). Los eventos de clics muertos y de excepciones no existen en el proyecto.
- Sin revisar (motivo: corrida recortada por tiempo): crear demostración, estudio de imágenes y video Clásico; caminos de error (HEIC, archivos grandes, guardar vacío, doble clic, sin conexión); teclado en formularios; ficha de inmobiliaria con todas sus pestañas; la mayoría de las capturas no se miraron una por una; logs de Supabase; panel con red lenta. Nada que borrar: no se crearon datos.
- Esperado, no es bug: el 404 de la consola en `/demo/<token-inexistente>`; el error de Google (`gsi/style`) en `/acceso` es de la red del entorno; los tiempos incluyen el proxy.

### QA 2026-11-08 pm

- Inicio: 2026-11-08T17:51:39-03:00 · Fin: 2026-11-08T17:55:25-03:00 · Estado: parcial (ver «Sin revisar»)
- Commit: 71b7374 (#201) · Despliegue: dpl_DEXTosZwcCdaxXbt6DBmKWExJr7C (production, READY)
- Tipo: liviana (tarde) · Pantallas: escritorio 1366×900, iPhone 13 y Galaxy S8 (este también con red lenta y con el navegador de WhatsApp).
- Paso 2: errores de Vercel en 24 h: un solo grupo, `DATABASE_57014` (timeout de base) en `/api/prospeccion`, el mismo de OBS-012; se repite una vez más. Avisos de salud de Supabase: ninguno. No se pudieron leer los logs de Postgres (la consulta de logs devolvió «tabla inexistente»).
- Sesión de QA: OK. Demo pública, `/presentacion`, token inexistente y `/panel`: 200 (404 propio y claro para el token inexistente), sin errores de JavaScript, sin scroll horizontal ni placeholders, `og:title`, `og:description` y `og:image` presentes, enlaces `wa.me` correctos. Comparación con arrastre y botón «Siguiente» de la galería sin fallas en todas las pantallas. Axe: solo `color-contrast` y, en la demo, `aria-prohibited-attr` (UX-001, UX-003). Se miraron las capturas de la demo en iPhone 13, del panel en Galaxy S8 y del 404 en Galaxy S8.
- Bugs encontrados: ninguno · Corregidos: ninguno
- Observaciones nuevas: ninguna · Propuestas nuevas: ninguna. Se repiten OBS-012, OBS-005 (pestaña «Contactar» cortada en celular), UX-001, UX-003 y UX-004 (carga lenta en escritorio, 5 a 9 s en este entorno).
- PRs de usabilidad abiertos: ninguno con título `UX:`
- PostHog revisado hasta: sin cambios respecto de la corrida anterior · cobertura: sin acceso · el conector de PostHog no estaba disponible en esta sesión.
- Sin revisar: PostHog completo (sin conector); teclado y zonas táctiles en detalle; el resto de las capturas (solo se miraron tres); tablet; crear demo, estudio de imágenes y video (la corrida liviana los excluye y la mañana no dejó arreglos pendientes). Nada que borrar: no se crearon datos.
- Esperado, no es bug: el 404 de la consola en `/demo/<token-inexistente>`; los `ERR_TUNNEL_CONNECTION_FAILED` son de la red del entorno; los tiempos de carga incluyen el proxy.

### QA 2026-11-08 am (2)

- Inicio: 2026-11-08T08:54:06-03:00 · Fin: 2026-11-08T09:20:00-03:00
- Commit: f27ee45 (#198) · Despliegue: dpl_Cz7ovhPV3R7LJPVMuEGj6TWZTRvt (production, READY) · Estado: parcial (ver «Sin revisar»)
- Tipo: completa (mañana), pero recortada: segunda corrida del día, una hora después de la anterior. Pantallas: escritorio 1366×900, iPhone 13, Galaxy S8 e iPad (gen 7).
- Paso 2: errores de Vercel en 24 h: los mismos dos grupos de timeout de base (`DATABASE_57014`, OBS-012), sin repetirse después de ayer a la tarde. Logs de Supabase en 24 h: solo un puñado de errores de Postgres, los mismos timeouts; sin errores SSR.
- Sesión de QA: OK. `/`, `/precios`, `/acceso`, `/demo/<token-inexistente>`, `/panel`, `/admin`, `/admin/inmobiliarias` y `/admin/prospeccion` en las cuatro pantallas: 200, sin errores de JavaScript, sin scroll horizontal ni placeholders, sin violaciones axe `critical`. El token inexistente da el 404 propio (el error de consola es esperado).
- Bugs encontrados: ninguno · Corregidos: ninguno
- Observaciones y propuestas nuevas: ninguna. Sin cambios en las listas.
- PRs de usabilidad abiertos: no consultados en esta corrida.
- PostHog revisado hasta: sin cambios respecto de la corrida anterior · cobertura: sin acceso · el conector de PostHog no estaba disponible en esta sesión.
- Sin revisar (motivo: corrida repetida con poco tiempo, una hora después de la completa de la mañana): PostHog completo (sin conector); crear demo, estudio de imágenes y video Clásico; demo pública con red lenta, navegador de WhatsApp, galería, comparación y CTA; caminos de error; teclado y zonas táctiles; ficha de inmobiliaria con todas sus pestañas; no se miraron las capturas una por una. Nada que borrar: no se crearon datos.
- Esperado, no es bug: el 404 de la consola en `/demo/<token-inexistente>`.

### QA 2026-11-08 am

- Inicio: 2026-11-08T07:32:57-03:00 · Fin: 2026-11-08T07:58:00-03:00
- Commit: e091d7d (#197) · Despliegue: dpl_3MiS3RNtmd6M8w5T9YMgHnLKZ17T (production, READY) · Estado: parcial (ver «Sin revisar»)
- Tipo: completa (mañana) · Pantallas: escritorio 1366×900, iPhone 13, Galaxy S8 (también con red lenta y con el navegador de WhatsApp) e iPad (gen 7).
- Paso 2: errores de Vercel en 24 h: dos grupos de timeout de base (`DATABASE_57014`, `/api/metricas` y `/api/prospeccion`), los mismos de OBS-012 de ayer; no se repitieron. Logs de Supabase en 24 h: sin errores de Postgres ni 5xx de la API. Sin errores SSR.
- Sesión de QA: OK. Crear demo en escritorio y en celular con red lenta (2 fotos: la subida y el borrador terminan, con indicador de avance visible), doble clic en «Continuar» y en «Guardar» sin duplicados, título y ubicación persistidos tras recargar, volver atrás sin perder lo guardado, guardar sin conexión con reintento posterior correcto. Errores de subida (HEIC, PDF, TXT y archivo de más de 3 MB): mensaje claro por archivo y no se rompe nada. Estudio de imágenes: costo leído en pantalla («sin costo: la foto ya está paga»), una generación, progreso visible («Creando…») y resultado en unos 30 s, doble clic sin duplicar. Video Clásico (sin créditos): un solo pedido con doble clic, MP4 descargado con el título de la propiedad. Demo pública y `/presentacion` en las cuatro pantallas, red lenta y navegador de WhatsApp: 200, sin errores de JavaScript, sin scroll horizontal ni placeholders, `og:title`/`og:description`/`og:image` presentes, galería por botón y por teclado, comparación con clic y con arrastre (mouse y toque), enlaces de WhatsApp con destino `wa.me`, CTA, foco visible; token inexistente: 404 propio y claro. Resto (`/`, `/precios`, `/acceso`, `/galeria`, panel completo, `/admin`, ficha de inmobiliaria, prospección, internos) en las cuatro pantallas: 200, sin errores ni scroll horizontal. Axe: solo `color-contrast` y, en la demo, `aria-prohibited-attr`.
- Se miraron las capturas de la demo (iPhone 13 y Galaxy S8, normal y presentación), del 404, del editor, del estudio, del video, de `/panel`, `/panel/imagenes` en Galaxy S8, `/precios` y `/admin/prospeccion` en iPhone 13.
- Bugs encontrados: ninguno · Corregidos: ninguno
- Observaciones nuevas: OBS-013 · Propuestas nuevas: UX-011, UX-012. Se repiten UX-001, UX-003, UX-004 (con evidencia real en celular), UX-005, UX-006, UX-007, UX-009, UX-010, OBS-003, OBS-005 y OBS-010. OBS-012 no se repitió.
- PRs de usabilidad abiertos: ninguno con título `UX:`
- PostHog revisado hasta: 2026-11-08T07:30:00-03:00 · cobertura: parcial · ventana desde el corte del 7/11 am. Filtro de tráfico interno verificado (sin visitas externas a `/admin`). Demos, panel, rebote, fotos, comparación, CTA, clics repetidos y web vitals revisados con muy poco tráfico externo: ninguna visita al panel y pocas sesiones de demos, todas en celular. Patrones: rebote rápido en parte de las demos (se van sin interactuar), las que interactúan usan la comparación y cambian de foto, una llegó a la CTA; sin clics repetidos. LCP de las demos en celular entre 5 y 9 s. No existen los eventos de clics muertos ni de excepciones en el proyecto. Sin grabaciones disponibles: la tabla de grabaciones no tiene ninguna en los últimos 10 días (OBS-010), así que no se pudo mirar nada a nivel de grabación.
- Sin revisar: grabaciones de PostHog (no hay, ver arriba); funnel del panel por falta de sesiones externas; `Equilibrado` y `Cinematográfico` del video (OBS-003). Borrado: se eliminaron con la UI del admin las dos propiedades de prueba creadas por la corrida; la demo publicada de QA se conserva.
- Esperado, no es bug: el 404 de la consola en `/demo/<token-inexistente>`; el límite de subida es de 3 MB por foto y así lo dice la pantalla; los tiempos de carga de la corrida incluyen el proxy del entorno.

### QA 2026-11-07 pm

- Inicio: 2026-11-07T17:52:14-03:00 · Fin: 2026-11-07T18:10:00-03:00
- Commit: f0c6682 (#193) · Despliegue: dpl_CJRCh26AbWxZqCELaLEj9JZSVJFg (production, READY) · Estado: parcial (ver «Sin revisar»)
- Tipo: liviana (tarde) · Pantallas: escritorio 1366×900, iPhone 13 y Galaxy S8 (también con el navegador de WhatsApp) para la demo pública, `/presentacion` y token inexistente; panel en escritorio, iPhone 13 y Galaxy S8.
- Paso 2: errores de Vercel en 24 h: dos timeouts de base de datos (`DATABASE_57014`) en `/api/metricas` y uno en `/api/prospeccion` (OBS-012); dos de Mercado Pago por límite de consultas (429) en el cron, ya diferidos por el código (sin acción); el `lead_recompute_failed` de anoche (OBS-011, no se repitió). Logs de Supabase: sin errores 5xx de la API y solo esos «statement timeout» en Postgres.
- Sesión de QA: OK. Demo pública, `/presentacion`, token inexistente y `/panel` en las variantes indicadas: 200 (404 propio y claro para el token inexistente), sin errores de JavaScript, sin scroll horizontal ni placeholders, `og:title`, `og:description` y `og:image` presentes. Galería con miniaturas, enlace de WhatsApp con destino `wa.me`. Axe: solo `color-contrast` y, en la demo, `aria-prohibited-attr` (UX-001, UX-003). Se miraron las capturas de la demo y el 404 en celular y del panel en iPhone 13.
- Bugs encontrados: ninguno · Corregidos: ninguno
- Observaciones nuevas: OBS-012 · Propuestas nuevas: ninguna. Se repiten UX-001, UX-003 y OBS-005 (pestaña «Contactar» cortada en celular).
- PRs de usabilidad abiertos: ninguno con título `UX:`
- PostHog revisado hasta: sin cambios respecto de la corrida anterior · cobertura: sin acceso · el conector de PostHog no estaba disponible en esta sesión.
- Sin revisar: PostHog completo (sin conector); red lenta; comparación antes/después por clic y arrastre (el control no expone valor accesible, solo se vio en la captura); teclado y zonas táctiles; tablet; crear demo, estudio de imágenes y video (la corrida liviana los excluye y la mañana no dejó arreglos pendientes). Nada que borrar: no se crearon datos.
- Esperado, no es bug: el 404 de la consola en `/demo/<token-inexistente>`; los tiempos de carga de la corrida (4 a 9 s) incluyen el proxy del entorno y no son comparables con los de usuarios.

### QA 2026-11-07 am (2)

- Inicio: 2026-11-07T08:51:40-03:00 · Fin: 2026-11-07T09:00:00-03:00
- Commit: 1224a0d (#183) · Despliegue: dpl_B9PxsqZ1LDkVKRDC1iGSpsruy4b3 (production, READY) · Estado: parcial (ver «Sin revisar»)
- Tipo: completa (mañana), segunda corrida del día, sobre el mismo código que la primera (desde entonces solo cambió este archivo) · Pantallas: escritorio 1366×900, iPhone 13, Galaxy S8 (también con red lenta y con el navegador de WhatsApp) e iPad (gen 7)
- Paso 2: errores de Vercel en 24 h: dos de Mercado Pago por límite de consultas (429 local) en el cron, ya diferidos por el propio código (sin acción), y el `lead_recompute_failed` aislado (OBS-011, no se repitió). Sin errores SSR.
- Sesión de QA: OK. Demo pública publicada de QA (`/demo/<token>` y `/presentacion`) en las seis variantes: 200, sin errores de consola, de JavaScript ni de red, sin scroll horizontal, sin imágenes rotas ni placeholders, `og:title`, `og:description` y `og:image` presentes, galería («Siguiente») y comparación con arrastre, enlaces de WhatsApp con destino `wa.me`. Con red lenta: carga completa en unos 7 s, imagen principal en menos de 3 s. Se miraron las capturas de la demo y de `/panel` en iPhone 13.
- Paso 5, resto: `/`, `/precios`, `/acceso`, `/panel`, `/panel/propiedades`, `/panel/imagenes`, `/admin`, `/admin/inmobiliarias`, `/admin/prospeccion` en las cuatro pantallas: 200, sin errores, sin scroll horizontal ni placeholders. Axe: solo `color-contrast` (UX-001) y, en la demo, `aria-prohibited-attr` (UX-003).
- Bugs encontrados: ninguno · Corregidos: ninguno
- Observaciones nuevas: ninguna · Propuestas nuevas: ninguna. Se repiten UX-001 y UX-003.
- PRs de usabilidad abiertos: ninguno con título `UX:`
- PostHog revisado hasta: sin cambios respecto de la corrida anterior · cobertura: sin acceso · el conector de PostHog no estaba disponible en esta sesión, no se analizaron sesiones ni grabaciones.
- Sin revisar: PostHog completo (sin conector); crear demo, estudio de imágenes, video y caminos de error (se hicieron completos hace una hora sobre el mismo código y no se repitieron para no gastar generaciones); pestañas internas de la ficha en `/admin`; interacción con CTA, teclado y gesto táctil en esta corrida. Nada que borrar: la corrida no creó demos ni propiedades.
- Esperado, no es bug: la demo de QA publicada (slug `qa-habita-2`) se titula «Propiedad nueva»; las demos más recientes de esa cuenta están en borrador y dan 404 público, como corresponde.

### QA 2026-11-07 am (completa)

- Inicio: 2026-11-07T07:38:49-03:00 · Fin: 2026-11-07T08:35:00-03:00
- Commit: 7c12054 (#181) · Despliegue: dpl_FvhUxkmULpCi3E28kDE8WEPhrQDs (production, READY) · Estado: parcial (ver «Sin revisar»)
- Tipo: completa (mañana) · Pantallas: escritorio 1366×900, iPhone 13, Galaxy S8 (también con red lenta y con el navegador de WhatsApp) e iPad (gen 7) para demos públicas y páginas del panel y del admin. Crear demo, estudio de imágenes, video y caminos de error: solo escritorio.
- Paso 2: errores de Vercel en 24 h: dos de Mercado Pago por límite de consultas (429 local) en el cron, ya diferidos por el propio código (sin acción), y un `lead_recompute_failed` aislado (OBS-011). Sin errores SSR.
- Paso 5, demos públicas (`/demo/<token>`, `/presentacion`, token inexistente) en las seis variantes: 200, sin errores de consola, de JavaScript ni de red, sin scroll horizontal, sin imágenes rotas ni placeholders. Galería, comparación con arrastre de mouse y con gesto táctil (la página no se mueve), CTA «Agendar visita», WhatsApp con destino `wa.me`, foco visible con Tab. Vista previa del enlace con `og:title`, `og:description`, `og:image` (200, JPEG) y `twitter:card`. `/demo/<token-inexistente>`: 404 propio y claro. Con red lenta: carga completa en unos 9 s, imagen principal en menos de 4 s.
- Paso 5, panel y admin (`/`, `/precios`, `/acceso`, `/panel`, propiedades, imágenes, créditos, `/admin`, inmobiliarias, ficha de la inmobiliaria de prueba, prospección, ficha de una propiedad) en cuatro pantallas: 200, sin errores, sin scroll horizontal. Se miraron las capturas de la lista del skill.
- Crear demo (escritorio): subir 2 fotos, borrador en unos 10 s, doble clic en «Continuar» no duplicó la propiedad, título y ubicación guardados y persistidos tras recargar y tras volver atrás, doble clic en «Guardar» envió un solo pedido, guardar sin conexión mostró mensaje y el reintento guardó (UX-009). Errores de subida: HEIC, foto de más de 3 MB (el límite real) y `.txt` muestran un mensaje claro por archivo y no rompen nada. Título vacío: lo frena el navegador (UX-010).
- Estudio de imágenes (escritorio): costo estimado de 1 crédito leído antes, una generación del estilo Moderno, un solo pedido con doble clic, lista en unos 9 s y comparación antes/después.
- Video (escritorio, estilo Clásico, sin créditos): se genera en unos 12 s y el MP4 descarga con nombre de la propiedad.
- Bugs encontrados: (1) doble clic en «Generar video» creaba dos videos, porque la guarda `busy` cambia después de varios `await`; (2) «Ambientar con IA» quedaba cortado en el botón del editor (columna de 316 px con `white-space: nowrap`); (3) `/admin/prospeccion`: `aria-controls` apuntaba a un panel inexistente (axe `aria-valid-attr-value`, critical) · Corregidos: axellaban/amoblaia#182, mergeado y desplegado (dpl_65FMhkh9yq8aS35HcFnr77kxMHMi, READY). Verificado en producción: el doble clic en «Generar video» crea un solo video, el botón «Ambientar con IA» ya no queda cortado y axe ya no marca `aria-valid-attr-value` en `/admin/prospeccion`. Tests de regresión `tests/video-double-click.test.ts`, `tests/global-css.test.ts` y `tests/prospecting-tabs-aria.test.tsx`. No tocan cobros.
- Observaciones nuevas: OBS-010, OBS-011 · Propuestas nuevas: UX-009, UX-010; se repiten UX-001 (más páginas), UX-003, UX-004 (primera carga en escritorio, imagen principal cerca de 5 s) y UX-005 (la pestaña de fotos del editor tarda unos 6 s mostrando «Cargando la propiedad…»); UX-002 no se reprodujo.
- PRs de usabilidad abiertos: ninguno con título `UX:`.
- PostHog revisado hasta: 2026-11-07T08:10:00-03:00 · cobertura: parcial · ventana desde el corte anterior. Filtro de tráfico interno verificado (sin visitas externas a `/admin`). Demos, panel, rebote, comparación, clics repetidos y web vitals: casi sin tráfico externo nuevo, no alcanza para patrones. Grabaciones: ninguna en 72 h (OBS-010), así que no se pudieron chequear las grabaciones. Los eventos `$dead_click` y `$exception` siguen sin existir en el proyecto.
- Sin revisar: crear demo, estudio y video en celular, Android chico y tablet; subir fotos con red lenta; volver atrás en medio de un paso del estudio; pestañas internas de la ficha en `/admin`; Motivo: tiempo de la corrida. La propiedad de prueba creada por la corrida se borró con la UI (confirmación nativa «No se puede deshacer»); el segundo video de la prueba del doble clic se fue con ella.
- Esperado, no es bug: el límite de subida es de 3 MB por foto (el mensaje lo dice); los errores de Mercado Pago 429 son límite local de consultas y el cron los difiere; la demo de QA sigue titulada «Propiedad nueva».

### QA 2026-11-06 pm (completa)

- Inicio: 2026-11-06T19:04:55-03:00 · Fin: 2026-11-06T19:35:00-03:00
- Commit: 1106d0f (#175) · Despliegue: dpl_B1dUb6mWQVajh4PJNSZWeXikAK1d (production, READY) · Estado: completo (todo lo de la corrida liviana, repasado punto por punto contra el skill)
- Tipo: liviana (tarde, a pedido se rehízo de cero) · Pantallas: escritorio 1366×900, iPhone 13, Galaxy S8; Galaxy S8 también con red lenta y con el navegador de WhatsApp
- Paso 2: errores de Vercel en 24 h: ninguno. Logs de Supabase (Postgres, PostgREST, Auth, Storage, edge): los errores de Postgres son consultas sueltas de sesiones de trabajo (columnas o funciones que el código no usa), no de la app; un 520 aislado de Storage (OBS-009).
- Paso 3: ver PostHog abajo.
- Paso 5, demo pública de QA (`/demo/<token>` y `/presentacion`) en las cinco variantes: 200, sin errores de consola, de JavaScript ni de red, sin scroll horizontal, sin imágenes rotas ni placeholders. Galería (siguiente y miniatura), comparación con clic, arrastre de mouse, toque y arrastre táctil (sin mover la página) y teclado; CTA «Agendar visita» y «Coordinar una visita» y WhatsApp con destino `wa.me` y mensaje preparado, el clic abre la pestaña. Pestañas de la ficha: llevan a su sección. Foco visible con Tab en escritorio. Vista previa del enlace en el HTML que recibe WhatsApp: `og:title`, `og:description`, `og:image` (responde 200, JPEG) y `twitter:card`. Con red lenta: capturas durante la carga, contenido visible antes de 1,5 s con espacios grises. `/demo/<token-inexistente>`: 404 propio y claro.
- Paso 5, panel en celular (iPhone 13, con sesión de QA): `/panel` (38 enlaces internos, ninguno roto), `/panel/propiedades` (lista, búsqueda con resultado y vacía con «Ninguna propiedad coincide con la búsqueda.», filtro de estado en sus tres opciones, vista tarjetas y tabla) y la ficha de la demo de QA. Las fotos de la lista cargan; el primer recuadro vacío de una captura era carga diferida.
- Controles en cada página: axe, zonas táctiles, tiempos (LCP y acción principal usable) y todas las capturas revisadas a mano con la lista del skill.
- Sin revisar: estudio de imágenes, video, crear demo y los demás caminos de error, porque la corrida de la tarde no los incluye y la mañana no dejó arreglos de esos flujos sin confirmar. Nada que borrar: la corrida no creó demos ni propiedades.
- Bugs encontrados: el inicio de una generación desde el panel de la inmobiliaria (`property_ai_generation_started` y `first_generation_started`) no llegaba a PostHog: el editor confirma el costo en su diálogo y llama a la cola con `quoted: true`, y el evento solo salía en la confirmación propia de la cola. En 30 días no hubo ningún `property_ai_generation_started` aunque sí generaciones terminadas. Deja sin datos el paso 3 del embudo de `docs/CRO_INSTRUMENTACION.md`. · Corregidos: axellaban/amoblaia#176, mergeado y desplegado (dpl_5eZpwiVn8Z7U8KDHNZMEPkkZYzHF, READY). Verificado en producción en el código servido: el evento sale fuera de la confirmación del costo. Se confirma con datos en la primera generación real desde el panel. Test de regresión: `tests/staging-start-event.test.ts` (falla sin el arreglo). No toca cobros: solo cuándo se manda el evento.
- Observaciones nuevas: OBS-006, OBS-007, OBS-008, OBS-009; se repite OBS-005 · Propuestas nuevas: UX-004, UX-005, UX-006, UX-007, UX-008; se repiten UX-001 (contraste en `/panel`, celular) y UX-003; UX-002 no se reprodujo
- PRs de usabilidad abiertos: ninguno con título `UX:`
- PostHog revisado hasta: 2026-11-06T19:15:00-03:00 · cobertura: completa · ventana de 72 h (las corridas anteriores no dejaron un corte válido). Filtro de tráfico interno verificado (sin visitas a `/admin` después de filtrar). Grabación: más de la mitad de las sesiones en cada área. Demos: rebote, fotos vistas y llegada a la última, uso de la comparación, CTA y WhatsApp, scroll de quienes no convierten, navegador y dispositivo, clics repetidos, web vitals. Panel: embudo (importar, generar, publicar), generaciones iniciadas contra terminadas, sesiones cortas sin interacción, clics repetidos. Los eventos `$dead_click` y `$exception` no existen en el proyecto; el navegador interno de WhatsApp no se distingue por user agent.
- Esperado, no es bug: la demo de QA se titula «Propiedad nueva» y no tiene descripción (OBS-001); el logo de otra inmobiliaria en la demo de QA es configuración de la cuenta de prueba; los `ERR_ABORTED` de `?_rsc=` son prefetch cancelados de Next; las fallas de importación del 5/11 son de una inmobiliaria real y su 409 es el aviso de duplicado (no es tráfico interno filtrado mal).

### QA 2026-11-06 pm (reintento)

- Inicio: 2026-11-06T18:52:02-03:00 · Fin: 2026-11-06T18:55:00-03:00
- Commit: 5faaed3 (#173) · Despliegue: producción READY · Estado: parcial (corregido el 6/11 pm: se registró como completo por error). Faltaron las interacciones de la demo (galería, comparación, CTA, WhatsApp), revisar 10 de las 13 capturas, el análisis de PostHog sin tráfico interno y los logs de Postgres; todo se hizo en la corrida «pm (completa)».
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
