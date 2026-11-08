<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Operación comercial

La operación comercial de habita. y Turnia se hace desde Chapa Labs (`facundogregorini-lab/chapa-labs`, `/prospecting`), que lee y ejecuta el Follow-up de este repo por `/api/prospeccion` (`src/lib/followup/chapa.ts`). Antes de tocar Follow-up o Prospección, leé `docs/FOLLOWUP.md`, `docs/PENDIENTES.md` y, en chapa-labs, `docs/CENTRO_COMERCIAL.md` (cómo se conectan los tres repos, el contrato de la API y qué sigue).

## Migraciones de Supabase

Cuando un cambio incluye una migración para aplicar, dar siempre el enlace de GitHub al archivo, sin que haga falta pedirlo, para abrirlo y copiar el SQL en el SQL Editor de Supabase:

- Antes del merge: `https://github.com/axellaban/amoblaia/blob/<rama>/supabase/migrations/<archivo>.sql`
- Después del merge: `https://github.com/axellaban/amoblaia/blob/main/supabase/migrations/<archivo>.sql`

## Regla: cada mejora de habita. se lleva a Turnia

Toda mejora en los paneles comerciales de habita. se lleva también a Turnia, en el mismo trabajo y sin que haga falta pedirlo. Así los dos paneles quedan siempre al día.

- **Qué cuenta como mejora de habita.:** lo que se haga en su panel del equipo (amoblaia: `/admin/prospeccion`, `/admin/inmobiliarias` y lo que se sume) o en su panel dentro de Chapa Labs (chapa-labs: `/prospecting/habita`). Vistas, embudos, filtros, acciones rápidas, métricas, textos y diseño.
- **Dónde se lleva:** a `/prospecting/turnia` en chapa-labs y, si es algo del panel de la app, también al panel de Turnia (turniasalud: `/panel/prospeccion`).
- **Cómo:** adaptado a Turnia, no copiado a ciegas. Usar sus etapas, su demo `/p/<código>`, sus datos y su embudo contra la meta, con las mismas definiciones que ya usa Turnia, para que los números de una vista y otra coincidan.
- **Si no aplica a Turnia:** decirlo en el PR y por qué.
- **Si no entra en el mismo PR** (otro repositorio, falta acceso): abrir el PR de Turnia a continuación. Si no se puede, dejarlo anotado en `PENDIENTES.md` de turniasalud y avisarlo al terminar.
- En chapa-labs la lógica compartida está en `prospecting/agencies.js` (`HABITA` y `TURNIA`) y la configuración de cada unidad en `prospecting/units.js`.
