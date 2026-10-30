# E2E (Playwright)

Instalación aparte de la app: `cd e2e && npm ci && npm run install-browsers`.

```bash
# Contra un build local (next build && next start en :3000)
npm test
# Contra producción o un preview, con una demo del equipo (solo lectura: no envía formularios
# y bloquea PostHog, Meta, Google y la actividad de la demo)
BASE_URL=https://habitaia.vercel.app DEMO_TOKEN=<token> DEMO_CODE=<código> npm test
```

Proyectos: Chrome de escritorio, Safari de iPhone, navegador de WhatsApp en iPhone y Chrome en Android.
`E2E_PIXEL=1` si el build tiene `NEXT_PUBLIC_META_PIXEL_ID`.
No cubren aún el alta real ni el reclamo (necesitan una base de prueba o una invitación descartable).
