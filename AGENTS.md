<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Migraciones de Supabase

Cuando un cambio incluye una migración para aplicar, dar siempre el enlace de GitHub al archivo, sin que haga falta pedirlo, para abrirlo y copiar el SQL en el SQL Editor de Supabase:

- Antes del merge: `https://github.com/axellaban/amoblaia/blob/<rama>/supabase/migrations/<archivo>.sql`
- Después del merge: `https://github.com/axellaban/amoblaia/blob/main/supabase/migrations/<archivo>.sql`
