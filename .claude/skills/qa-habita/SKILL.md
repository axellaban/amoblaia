---
name: qa-habita
description: QA autónomo de producción de Habita (www.habitaia.app). Revisa errores de Vercel y Supabase, analiza en PostHog las sesiones reales de demos públicas y del panel, recorre con Playwright los flujos de crear demo, estudio de imágenes, video y demos públicas (escritorio, celular, tablet y red lenta) buscando errores técnicos y problemas de usabilidad, corrige lo que encuentra, lo verifica, mergea los errores a main (producción), registra los hallazgos de usabilidad para que los evalúe Astra (CRO) y anota el resultado en docs/qa-habita.md. Usar cuando se pida «QA de Habita», «correr el QA» o desde la tarea programada.
---

# QA autónomo de Habita

Objetivo: encontrar en producción errores reales **y problemas de usabilidad** en el panel y en las demos, corregirlos y publicarlos. Al final dejar un resumen corto con lo encontrado, lo corregido (con el enlace al PR), los hallazgos de usabilidad registrados y lo que quedó pendiente.

Claude responde por lo técnico: bugs y regresiones. Astra analiza la conversión todos los días, lee `docs/qa-habita.md` por su cuenta y decide qué cambios de usabilidad proponer. No suponer que esta corrida ocurre a una hora determinada: registrar siempre la hora real.

## Reglas que no se rompen

- **Plata:** no comprar créditos ni planes y no completar pagos. Si algo pide pago, frenar ese flujo y anotarlo.
- **Generaciones:** como máximo una por flujo, la mínima. Leer el «Costo estimado» en pantalla antes de generar. El video se prueba con el estilo **Clásico**, que no consume créditos. Las pruebas de caminos de error (paso 5) **no** generan: se frenan antes de confirmar o usan entradas que el sistema rechaza.
- **Datos reales:** no abrir demos ni paneles de inmobiliarias reales sin la sesión de QA. Sin sesión, la visita cuenta como cliente externo y ensucia métricas y lead score (`docs/TRAFICO_INTERNO.md`). Con la sesión de QA, que es cuenta interna, sí se puede.
- **Privacidad (PostHog):** los visitantes de las demos son clientes de las inmobiliarias. Usar solo datos agregados y patrones. Nunca copiar nombres, teléfonos, emails, IPs ni IDs de persona a archivos del repo, commits, PRs, logs ni al resumen.
- **Repositorio público:** hasta que se confirme que es privado, en archivos del repo, commits y PRs no van métricas comerciales, tasas de conversión, cantidades de sesiones o usuarios, enlaces a grabaciones ni IDs de sesión. Se describe el patrón con palabras y su frecuencia como `aislado` o `repetido`. Para citar una sesión concreta, usar el enlace de PostHog solo en el resumen final de la conversación.
- **Base de datos:** solo lecturas con `execute_sql`. Una migración se aplica solo si es aditiva (`add column if not exists`, funciones nuevas). Antes, simular con un `select` a cuántas filas reales afecta. Nunca volver a correr una migración vieja entera: puede pisar funciones más nuevas. Ver con `grep` si una migración posterior redefine la misma función.
- **Facturación y Mercado Pago:** si un arreglo cambia cómo se cobra, reembolsa o cancela, abrir el PR **sin mergear** y avisar.
- **Usabilidad:** no abrir PRs de mejoras de usabilidad por iniciativa propia (textos, diseño, orden de pasos, flujo). Se registran con su identificador en `docs/qa-habita.md` para que Astra los evalúe y priorice. Solo se corrigen y mergean solos los arreglos de algo roto (error, botón que no responde, contenido cortado o tapado, scroll horizontal, imagen que no carga). Si se pide a mano implementar un cambio de usabilidad ya aprobado, va como PR **sin mergear**.
- **Tests:** nunca saltear, borrar ni desactivar un test para que pase.
- **Secretos:** nunca escribir credenciales en archivos del repo, logs ni commits. El archivo de sesión va al scratchpad y se borra al terminar.
- **Duplicados:** antes de corregir algo, leer las «Observaciones abiertas» y las «Propuestas UX pendientes» de `docs/qa-habita.md`, `git log --oneline -30` y los PR abiertos (`list_pull_requests` de GitHub, o `gh api "repos/axellaban/amoblaia/pulls?state=open"`; `gh pr list` no funciona en estas sesiones), para no rehacer lo que otra sesión ya arregló o propuso.

## Datos fijos

- Vercel: proyecto `prj_2oV0H7KmtlUAzpq1xdiaiQatoX3b`, equipo `team_DnTysSLh1CQWo2OEYu6cpMQv` (Grego).
- Supabase: proyecto `cmpfwuycxdleunuumlkm`.
- PostHog: proyecto 683617, por el conector de PostHog de la tarea (consultas SQL y grabaciones de sesión). Si el conector no está, saltear el paso 3, marcar la cobertura de PostHog como `sin acceso` y avisarlo en el resumen. Recetas y limitaciones: `docs/CRO_INSTRUMENTACION.md`.
- Panel de QA: `/panel` (inmobiliaria QA_Habita, slug `qa-habita-2`). Inmobiliaria de prueba original: `/admin/inmobiliarias/67b74437-b305-41a3-bada-42205ae090aa`.
- Credenciales: variables de entorno `HABITA_QA_EMAIL` y `HABITA_QA_PASSWORD` del entorno de la nube. **No** leerlas de Vercel: el modo automático lo bloquea.

## Tipo de corrida

Mirar la hora de Argentina (`TZ=America/Argentina/Buenos_Aires date +%H`):

- **Mañana (antes de las 13 h): corrida completa.** Pasos 1 a 9, todos los flujos y todas las pantallas.
- **Tarde (13 h o después): corrida liviana.** Pasos 1, 2, 3 (PostHog), 4, y del paso 5 solo las demos públicas (5.4) y el panel en celular. Saltear el estudio de imágenes y el video salvo que la mañana haya dejado un arreglo de esos flujos sin confirmar. Después pasos 7 a 9.

Si se pide a mano «QA completo», hacer la completa a cualquier hora.

## Pasos

### 1. Preparar
Anotar la hora real de inicio (`TZ=America/Argentina/Buenos_Aires date -Iseconds`), el commit de `origin/main` y el despliegue de producción analizado (`list_deployments`). Van al registro del paso 9.
```bash
npm ci --no-audit --no-fund
npm i --no-save --no-audit --no-fund @axe-core/playwright
```
Si faltan `HABITA_QA_EMAIL` o `HABITA_QA_PASSWORD`, hacer todo lo que no necesita login (pasos 2, 3, demos públicas ya publicadas, páginas públicas, 7, 8 y 9) y avisar en el resumen que el QA con sesión quedó sin hacer.

### 2. Errores de producción (siempre primero)
- `get_runtime_errors` de Vercel con `since: "24h"`. Si es la primera corrida del día, usar `"7d"`. Cada grupo nuevo o que sigue apareciendo es un candidato a bug. Comparar `last` con la fecha del último deploy: si es anterior al arreglo, ya está resuelto.
- Para errores SSR minificados (`at K (.next/server/chunks/ssr/<chunk>.js:1:<col>)`): `next build` local con `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (valores públicos, están en `scripts/qa-login.mjs`). Abrir el chunk del mismo nombre y mapear la columna con su `.js.map`; las secciones del source map tienen offset. Así se encontró el `window is not defined` del 5/11.
- Si un RPC falla, confirmar en `pg_proc` que exista. Una migración del repo puede no estar aplicada: comparar con `list_migrations` buscando un objeto de cada archivo.

### 3. Sesiones reales en PostHog
Qué tiene que revisar: lo que hacen los usuarios reales, no la cuenta de QA. Claude no mira las grabaciones como video: analiza los eventos de cada sesión (páginas, clics, rage clicks, dead clicks, excepciones, scroll, tiempos).

**Ventana:** solo sesiones nuevas desde la corrida anterior. La fecha de corte está en `docs/qa-habita.md` como `PostHog revisado hasta: <ISO>`. Si no existe, usar las últimas 72 h. Al final, actualizar ese valor.

**Excluir tráfico interno** según `docs/TRAFICO_INTERNO.md` (cuenta de QA, cuentas internas, filtro de tráfico interno del proyecto). Antes de sacar conclusiones, confirmar con una consulta que el filtro funciona.

**Antes de empezar, chequear la grabación:** contar sesiones con grabación vs. sesiones totales en `/demo/*` (incluye `/presentacion`) y `/panel*`. Si en alguna se graba menos del 50 % o nada, anotarlo como observación (no se puede analizar bien) y seguir con los eventos.

**3.1 Demos públicas (`/demo/*`, incluida `/demo/*/presentacion`) — foco principal.** Con HogQL (`query-run`), separando celular / escritorio y navegador (incluido el navegador interno de WhatsApp, Instagram y Facebook):
- Rebote rápido: sesiones de menos de 10 s o sin ninguna interacción después de cargar.
- Fotos: cuántas fotos ven en promedio y qué parte llega a la última.
- Comparación antes/después: qué parte la usa; si hay intentos fallidos (clics o arrastres repetidos sobre el control, dead clicks cerca).
- Conversión: qué parte llega a la CTA y qué parte toca WhatsApp o contacto. Profundidad de scroll de los que se van sin convertir.
- Fricción: `$rageclick`, `$dead_click` y `$exception`, agrupados por página y elemento (selector o texto).
- Velocidad: si hay web vitals o eventos de carga de imágenes, LCP y tiempo hasta la primera foto, por tipo de dispositivo.

**3.2 Panel (`/panel*`) — todas las sesiones de inmobiliarias.**
- Embudo crear demo: subir fotos → borrador → editar → publicar o compartir. En qué paso abandonan y cuánto tardan en cada uno.
- Generaciones (estudio de imágenes y video): iniciadas vs. resultado visto; abandono durante el progreso.
- Confusión: idas y vueltas entre las mismas dos pantallas, tiempo largo sin interacción en una pantalla con acción pendiente, búsquedas o filtros que no devuelven nada.
- Fricción: `$rageclick`, `$dead_click` y `$exception` por página y elemento.

**3.3 Qué hacer con lo que aparece.** Para cada patrón: cuántas sesiones lo muestran sobre el total (por ejemplo, «7 de 20 en celular») y 1 a 3 enlaces a grabaciones de ejemplo, solo para el resumen final, nunca en el repo. Después:
- Si el patrón apunta a algo roto, reproducirlo con Playwright en el paso 5 y corregirlo (paso 7).
- Si es de usabilidad, reproducirlo si se puede y registrarlo en «Propuestas UX pendientes» con identificador `UX-NNN`, sin implementarlo.
- Si son pocos casos (menos de 3 sesiones) o no se puede reproducir, anotarlo en «Observaciones abiertas» con identificador `OBS-NNN` para ver si se repite en las próximas corridas.

### 4. Sesión de QA
```bash
node scripts/qa-login.mjs "$SCRATCH/qa-session.json" --check
```
Debe decir «OK: /admin abre (200)». Usar el archivo con `browser.newContext({ storageState })`.

### 5. Flujos con Playwright

**Pantallas:** escritorio 1366×900, celular `devices["iPhone 13"]`, Android chico 360×740 (`devices["Galaxy S8"]`, que ya trae `isMobile` y `hasTouch`; `Galaxy S9+` mide 320 px) y tablet `devices["iPad (gen 7)"]`. En la corrida de la tarde, solo escritorio e iPhone 13 (más Android chico para demos públicas).

**Red lenta:** las demos públicas se prueban también con red de celular lenta, con CDP en Chromium: `Network.emulateNetworkConditions` con `latency: 150`, `downloadThroughput: 1.6 * 1024 * 1024 / 8`, `uploadThroughput: 750 * 1024 / 8`. El panel, solo el paso de subir fotos.

**Navegador de WhatsApp:** abrir la demo pública con un user agent del navegador interno de WhatsApp en Android (que contenga `WhatsApp/`), porque así la abre la mayoría de los clientes.

**En cada página, controles técnicos:** errores de `console`, `pageerror`, respuestas ≥ 400 del dominio y scroll horizontal (`scrollWidth > innerWidth`). Los `ERR_TUNNEL_CONNECTION_FAILED` de PostHog y Meta son de la red del sandbox: ignorarlos.

**En cada página, controles de usabilidad:**
- **Captura** de pantalla completa (`fullPage: true`) en cada paso, guardada en el scratchpad, y **mirarla** (Read de la imagen) con esta lista:
  1. ¿Se entiende en 5 segundos qué es la pantalla y cuál es la acción principal?
  2. ¿La acción principal está a la vista sin scrollear en celular y no la tapa nada (banners, teclado, barras fijas, botón de WhatsApp)?
  3. ¿Hay texto cortado, superpuesto, en inglés, con errores de ortografía o con placeholders (`undefined`, `null`, `NaN`, `{{ }}`, «Lorem»)?
  4. ¿Las imágenes cargan, tienen buena proporción y no se ven deformadas ni pixeladas?
  5. ¿Mientras algo carga o se genera hay un indicador claro y una idea del tiempo?
  6. ¿Los estados vacíos (sin demos, sin fotos, sin resultados) explican qué hacer?
  7. ¿Los mensajes de error dicen qué pasó y qué hacer, en castellano y sin jerga técnica?
  8. ¿Es coherente con el resto (mismos nombres para lo mismo, mismos estilos de botón)?
- **Tiempos:** medir con `performance` el LCP y el tiempo hasta que la acción principal está usable. Anotar cualquier pantalla de más de 3 s en escritorio o 5 s en celular con red lenta, y cualquier paso sin indicador de carga que tarde más de 1 s.
- **Accesibilidad:** `new AxeBuilder({ page }).withTags(["wcag2a","wcag2aa"]).analyze()`. Reportar violaciones `serious` y `critical` (contraste, botones o imágenes sin nombre, campos sin etiqueta). Revisar también que las zonas táctiles midan al menos 44×44 px en celular.
- **Teclado:** en formularios, que se pueda avanzar con Tab y enviar con Enter, y que el foco se vea.

**Flujos (camino feliz):**
1. **Crear demostración:** desde `/panel`, subir 2 fotos de `public/ejemplos/` (`tests/fixtures` no tiene imágenes), ver el borrador, editar título y ubicación, guardar y recargar para confirmar que persistió.
2. **Estudio de imágenes:** abrir una foto de la demo de QA, leer el costo, generar **un** estilo, ver el progreso y el resultado, y comparar antes y después.
3. **Video:** estilo Clásico, generar, confirmar que el MP4 descarga y que no tiene título genérico si la demo tiene título.
4. **Demos públicas:** abrir la demo de QA publicada (`/demo/<token>` y `/demo/<token>/presentacion`) en todas las pantallas, con red lenta y con user agent de WhatsApp. Probar la galería, la comparación de fotos con clic **y** con gesto táctil (arrastre), la CTA, WhatsApp y que la vista previa del enlace tenga título, descripción e imagen (`og:title`, `og:description`, `og:image` en el HTML).
5. **Resto:** `/panel` (lista, filtros, búsqueda, enlaces, estado vacío si se puede ver), `/admin` (inmobiliarias, ficha con todas sus pestañas, demos, prospección) y `/`, `/precios`, `/acceso`.

**Caminos de error (sin generar):**
- Subir una foto HEIC, una de más de 15 MB y un archivo que no es imagen (un `.pdf` o `.txt`): tiene que haber un mensaje claro y no se tiene que romper nada.
- Guardar el formulario de demo con campos obligatorios vacíos: el error tiene que marcar el campo.
- Doble clic rápido en «Guardar» y en el botón de generar (frenar antes de confirmar el costo, o verificar que el botón queda deshabilitado después del primer clic): no tiene que duplicar nada.
- Volver atrás con el navegador en medio de un paso y recargar la página: no se tiene que perder lo guardado ni quedar en un estado roto.
- Cortar la red (`context.setOffline(true)`) durante un guardado: tiene que haber un mensaje y poder reintentar.
- Abrir `/demo/<token-inexistente>`: tiene que mostrar una página clara, no un error.

Borrar al final las demos y propiedades de prueba que creó la corrida, con la UI y no por SQL.

### 6. Priorizar
Ordenar todo lo encontrado (pasos 2, 3 y 5) así:
1. **Roto:** errores, flujos que no terminan, datos que no se guardan, contenido tapado o cortado, scroll horizontal, violaciones de accesibilidad `critical`.
2. **Usabilidad con evidencia real:** patrones de PostHog que se reproducen con Playwright.
3. **Usabilidad detectada solo en el recorrido:** puntos de la lista de chequeo, tiempos lentos, accesibilidad `serious`.

Corregir los de la categoría 1. Los de 2 y 3 no se implementan: van a «Propuestas UX pendientes» para que Astra los evalúe.

### 7. Corregir
- Arreglo mínimo en la causa.
- **Cada bug corregido deja un test de regresión** en `tests/`: unitario si es lógica; si es de interfaz y el repo tiene una suite de Playwright (hoy no la tiene: no hay `playwright.config.*`), sumar el caso ahí; si no, un test de componente o, como mínimo, el paso de reproducción en `docs/qa-habita.md`.
- `npx eslint <archivos>`, `npx tsc --noEmit`, `npx vitest run --maxWorkers=2`. Si cambió algo de render o del servidor, también `npx next build`.
- Migración nueva: `supabase/migrations/<siguiente número>_<nombre>.sql`, con comentario del porqué. Aplicarla con `apply_migration` solo si cumple la regla de base de datos y dar siempre el enlace de GitHub (ver `AGENTS.md`).
- **Hallazgos de usabilidad:** no se corrigen acá. Cada uno se registra con el problema, la pantalla y el dispositivo, qué punto de la lista falló y si se reprodujo.

### 8. Publicar
- Rama `claude/qa-<fecha>-<am|pm>` desde `origin/main` (o la rama que indique la sesión) para los arreglos. Commits en castellano explicando causa y arreglo, con las líneas de atribución de la sesión.
- **Arreglos de algo roto:** crear el PR y mergearlo (método `merge`) si todo está en verde y no toca cobros. Esperar el deploy (`list_deployments`, target production, estado READY) y repetir en producción el paso que fallaba para confirmar.
- Si el deploy queda en ERROR: leer los logs de build, corregir o revertir con un PR nuevo. Nunca dejar producción rota.

### 9. Registrar
Agregar en `docs/qa-habita.md`, debajo de «Resultados» y arriba de los anteriores, una sección con la plantilla de ese archivo. El título es siempre `### QA AAAA-MM-DD <am|pm>`, con la fecha de Argentina, para que Astra encuentre la del día. Si la corrida se corta, registrar igual lo hecho con estado `parcial` o `fallido`. Campos:
- Inicio y fin, con hora real y zona horaria.
- Commit y despliegue analizados.
- Estado: `completo` (se hizo todo lo que corresponde a ese tipo de corrida), `parcial` (faltó algo; decir qué y por qué) o `fallido`.
- Tipo de corrida (completa o liviana) y pantallas probadas.
- Flujos técnicos revisados y los que no se revisaron.
- Bugs encontrados y corregidos, con su PR.
- Observaciones y propuestas nuevas, por identificador.
- PRs de usabilidad abiertos y pendientes (`gh api "repos/axellaban/amoblaia/pulls?state=open"`, los de título `UX:`).
- `PostHog revisado hasta: <ISO> · cobertura: completa|parcial|sin acceso`, con qué áreas y qué quedó afuera, sin cantidades.
- Lo esperado que no es bug.

Actualizar las listas «Observaciones abiertas» y «Propuestas UX pendientes»: sacar lo resuelto, sumar lo nuevo con el número siguiente y marcar lo que se repite. Los identificadores no se reutilizan.

Commit y merge junto con los arreglos, o solo si no hubo arreglos. Este commit a main es lo que Astra lee: sin él, la corrida no existe para ella.

Resumen final, corto y en castellano: qué se probó, qué se corrigió (con enlaces), qué hallazgos de usabilidad se registraron, los 2 o 3 hallazgos más importantes de PostHog y qué no se pudo hacer (por ejemplo, si faltaban las credenciales de QA o el conector de PostHog).
