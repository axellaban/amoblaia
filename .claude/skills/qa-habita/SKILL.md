---
name: qa-habita
description: QA autónomo de producción de Habita (www.habitaia.app). Revisa errores de Vercel y Supabase, recorre con Playwright los flujos de crear demo, estudio de imágenes, video y demos públicas (escritorio y celular), corrige lo que encuentra, lo verifica, lo mergea a main (producción) y deja el resultado en docs/qa-habita.md. Usar cuando se pida «QA de Habita», «correr el QA» o desde la tarea programada.
---

# QA autónomo de Habita

Objetivo: encontrar errores reales en producción, corregirlos y publicarlos sin intervención. Al final dejar un resumen corto con lo encontrado, lo corregido (con el enlace al PR) y lo que quedó pendiente.

## Reglas que no se rompen

- **Plata:** no comprar créditos ni planes y no completar pagos. Si algo pide pago, frenar ese flujo y anotarlo.
- **Generaciones:** como máximo una por flujo, la mínima. Leer el «Costo estimado» en pantalla antes de generar. El video se prueba con el estilo **Clásico**, que no consume créditos.
- **Datos reales:** no abrir demos ni paneles de inmobiliarias reales sin la sesión de QA. Sin sesión, la visita cuenta como cliente externo y ensucia métricas y lead score (`docs/TRAFICO_INTERNO.md`). Con la sesión de QA, que es cuenta interna, sí se puede.
- **Base de datos:** solo lecturas con `execute_sql`. Una migración se aplica solo si es aditiva (`add column if not exists`, funciones nuevas). Antes, simular con un `select` a cuántas filas reales afecta. Nunca volver a correr una migración vieja entera: puede pisar funciones más nuevas. Ver con `grep` si una migración posterior redefine la misma función.
- **Facturación y Mercado Pago:** si un arreglo cambia cómo se cobra, reembolsa o cancela, abrir el PR **sin mergear** y avisar.
- **Tests:** nunca saltear, borrar ni desactivar un test para que pase.
- **Secretos:** nunca escribir credenciales en archivos del repo, logs ni commits. El archivo de sesión va al scratchpad y se borra al terminar.
- **Duplicados:** antes de corregir algo, leer las «Observaciones abiertas» de `docs/qa-habita.md` y `git log --oneline -30`, para no rehacer lo que otra sesión ya arregló.

## Datos fijos

- Vercel: proyecto `prj_2oV0H7KmtlUAzpq1xdiaiQatoX3b`, equipo `team_KSLdEYQ5MNrnhjPR9G3PxpVO`.
- Supabase: proyecto `cmpfwuycxdleunuumlkm`.
- Panel de QA: `/panel` (inmobiliaria QA_Habita, slug `qa-habita-2`). Inmobiliaria de prueba original: `/admin/inmobiliarias/67b74437-b305-41a3-bada-42205ae090aa`.
- Credenciales: variables de entorno `HABITA_QA_EMAIL` y `HABITA_QA_PASSWORD` del entorno de la nube. **No** leerlas de Vercel: el modo automático lo bloquea.

## Pasos

### 1. Preparar
```bash
npm ci --no-audit --no-fund
```
Si faltan `HABITA_QA_EMAIL` o `HABITA_QA_PASSWORD`, hacer los pasos 2, 5, 6 y 7 (todo lo que no necesita login) y avisar en el resumen que el QA con sesión quedó sin hacer.

### 2. Errores de producción (siempre primero)
- `get_runtime_errors` de Vercel con `since: "24h"`. Si es la primera corrida del día, usar `"7d"`. Cada grupo nuevo o que sigue apareciendo es un candidato a bug. Comparar `last` con la fecha del último deploy: si es anterior al arreglo, ya está resuelto.
- Para errores SSR minificados (`at K (.next/server/chunks/ssr/<chunk>.js:1:<col>)`): `next build` local con `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (valores públicos, están en `scripts/qa-login.mjs`). Abrir el chunk del mismo nombre y mapear la columna con su `.js.map`; las secciones del source map tienen offset. Así se encontró el `window is not defined` del 5/11.
- Si un RPC falla, confirmar en `pg_proc` que exista. Una migración del repo puede no estar aplicada: comparar con `list_migrations` buscando un objeto de cada archivo.

### 3. Sesión de QA
```bash
node scripts/qa-login.mjs "$SCRATCH/qa-session.json" --check
```
Debe decir «OK: /admin abre (200)». Usar el archivo con `browser.newContext({ storageState })`.

### 4. Flujos con Playwright (escritorio 1366×900 y celular `devices["iPhone 13"]`)
En cada página: capturar `console` de tipo error, `pageerror`, respuestas ≥ 400 del dominio y scroll horizontal (`scrollWidth > innerWidth`). Los `ERR_TUNNEL_CONNECTION_FAILED` de PostHog y Meta son de la red del sandbox: ignorarlos.
1. **Crear demostración:** desde `/panel`, subir 2 fotos de `public/` o `tests/fixtures`, ver el borrador, editar título y ubicación, guardar y recargar para confirmar que persistió.
2. **Estudio de imágenes:** abrir una foto de la demo de QA, leer el costo, generar **un** estilo, ver el progreso y el resultado, y comparar antes y después.
3. **Video:** estilo Clásico, generar, confirmar que el MP4 descarga y que no tiene título genérico si la demo tiene título.
4. **Demos públicas:** abrir la demo de QA publicada (`/demo/<token>` y `/presentacion`), comparación de fotos, CTA, WhatsApp, y en celular.
5. **Resto:** `/panel` (lista, filtros, enlaces), `/admin` (inmobiliarias, ficha con todas sus pestañas, demos, prospección) y `/`, `/precios`, `/acceso`.

Borrar al final las demos y propiedades de prueba que creó la corrida, con la UI y no por SQL.

### 5. Corregir
- Arreglo mínimo en la causa, con un test en `tests/` cuando sea lógica.
- `npx eslint <archivos>`, `npx tsc --noEmit`, `npx vitest run --maxWorkers=2`. Si cambió algo de render o del servidor, también `npx next build`.
- Migración nueva: `supabase/migrations/<siguiente número>_<nombre>.sql`, con comentario del porqué. Aplicarla con `apply_migration` solo si cumple la regla de base de datos y dar siempre el enlace de GitHub (ver `AGENTS.md`).

### 6. Publicar
- Rama `claude/qa-<fecha>-<am|pm>` desde `origin/main` (o la rama que indique la sesión). Commit en castellano explicando causa y arreglo, con las líneas de atribución de la sesión.
- Crear el PR y mergearlo (método `merge`) si todo está en verde y no toca cobros. Esperar el deploy (`list_deployments`, target production, estado READY) y repetir en producción el paso que fallaba para confirmar.
- Si el deploy queda en ERROR: leer los logs de build, corregir o revertir con un PR nuevo. Nunca dejar producción rota.

### 7. Registrar
Agregar en `docs/qa-habita.md` la sección «Resultado del QA del <fecha> <am|pm>»: flujos probados, bugs corregidos con su PR, lo esperado que no es bug y las observaciones abiertas. Commit y merge junto con el resto, o solo si no hubo arreglos.
