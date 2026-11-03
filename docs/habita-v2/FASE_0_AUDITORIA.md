# Habita V2 — Fase 0: auditoría, baseline y plan

**Fecha:** 01/11/2026 · **Rama:** `claude/friendly-shannon-54k8z1` · **Base:** `main` @ `af25d01` (merge PR #80, links cortos `/p/<propiedad>-<codigo>`).
**Fuente de verdad:** [`docs/HABITA_V2_SPEC.md`](../HABITA_V2_SPEC.md) · referencias visuales en [`docs/ux/habita-v2/`](../ux/habita-v2/).

## 1. Estado real del repositorio

| Área | Stack / estado |
| --- | --- |
| Framework | Next.js 16.4.2 (App Router, `src/proxy.ts`), React 19.3, Node 24, Vercel |
| Datos | Supabase (43 migraciones, última `202611160001_short_demo_links.sql`), Storage privado, RPC transaccionales de créditos |
| Analítica | PostHog (`src/lib/analytics.ts`: `track`, `registerSuperProperties`, `trackMilestone`), `cta()` en `src/lib/interaction-tracking.ts`, Lead Engagement Score (`src/lib/leads/*`) |
| Tests | Vitest 5, 81 archivos, PGlite para tests de base de datos |
| UI | CSS propio (`globals.css`), `lucide-react`; sin librería de componentes |

### Baseline de calidad (antes de cualquier cambio)

| Comando | Resultado |
| --- | --- |
| `npm test` | **778/778 tests OK** (81 archivos, 54,6 s) |
| `npm run lint` | OK, sin errores |
| `npm run typecheck` | OK |
| `npm run build` | se ejecuta al cerrar cada fase |

## 2. Mapa existente → reutilizar / modificar / añadir

| Requisito V2 | Existe hoy | Acción |
| --- | --- | --- |
| Panel: sidebar + home | `src/components/agency-panel.tsx` (`PanelNav` con Inicio, Mis propiedades, Créditos IA, Mi sitio web, Usuarios; home con «Crear demostraciones» e «Importar imágenes») | **Modificar**: sidebar verde (desktop) / drawer (mobile), exactamente 3 tarjetas (Crear demostraciones, Estudio de imágenes, Video), «Tus propiedades», «¿Querés crear otra propiedad?» con URL |
| Sitio web | `/panel/sitio`, `agency-site.tsx`, permisos `managers` | **Reutilizar**, solo se mueve a la sidebar |
| Estudio de imágenes | `/panel/imagenes`, `agency-images.tsx`, `agency-batch.tsx`, `demo-editor.tsx`, `retouch-controls.tsx` | **Reutilizar** como destino de la tarjeta |
| Video | No existe | **Añadir** (Fase 5) — oculto hasta estar operativo |
| Tour 360 / Plano / Redes / API | No existe | **Añadir** un componente común «próximamente» + rutas `/panel/tour-360`, `/panel/planos`, `/panel/redes`, `/panel/api` + tabla `feature_interest` |
| Demo WhatsApp | `src/app/demo/[token]/*`, `public-demo.tsx`, `demo-view.tsx` (1649 líneas), `/p/[link]` | **Modificar**: header compacto, slider + thumbnails + «Estilos» única, editor contextual, ficha completa debajo |
| Vista comprador | `/demo/<token>/presentacion/<codigo>/ficha`, `/p/<...>/ficha` | **Reutilizar** rutas; limpiar herramientas admin |
| Claim | `/panel/empezar`, `api/panel/reclamar`, `api/panel/invitacion` (`acceptWithNewAccount`), `agency_claims` | **Endurecer** (Fase 4) |
| Importador URL | `src/lib/demos/listing.ts` (`fetchPublic`, `parseListing`), `listing-details.ts`, `import.ts` (`toDemo`, `planImport`), `agency/import-flow.ts` (preview/snapshot/409/idempotencia) | **Evolucionar** (Fase 1): fetch seguro nuevo, extractores por plataforma, diagnóstico; contratos de preview conservados |
| Precios | `/precios`, `/demo/.../precios`, `/p/.../precios` | Reutilizar; enlazar desde sidebar y header demo |
| Miguel Ángel | `src/app/panel/layout.tsx` + `assistant.tsx` | Conservar |

## 3. Estados de acceso (hoy)

```
Visitante con /demo/<token>            → presentación sin claim (solo lectura + acciones promocionales)
Visitante con /p/<slug>-<codigo>       → misma demo + botón «Probar en mi panel» si el código está vigente
   └─ /panel/empezar?codigo=…           → acceptWithNewAccount (email+contraseña) ⇒ cuenta con email_confirm: true ⇒ owner
   └─ usuario logueado + código         → /api/panel/reclamar ⇒ owner
Panel reclamado                         → miembros con roles (owner/admin/editor/viewer), /panel/unirme con aprobación
/…/ficha                                → vista comprador
```

## 4. Riesgos priorizados

1. **Claim por posesión del link (crítico, Fase 4).** El link corto que se reenvía por WhatsApp (`/p/<slug>-<codigo>`) *es* el código de reclamo. Quien lo reciba reenviado puede abrir `/panel/empezar`, crear una cuenta con cualquier email y `acceptWithNewAccount` la marca como verificada (`email_confirm: true`) y la convierte en `owner`. Mitigación planificada: separar URL pública de demo y credencial de claim, verificación por OTP de email, autorización (contacto comercial / dominio + aprobación), el código del link corto pasa a identificar la demo y no a reclamarla. **Bloquea** la difusión masiva de «Guardar mi panel».
2. **Precio equivocado en el importador (alto, corregido en Fase 1).** En Inmobiliatica el importador tomaba el precio de una tarjeta de «propiedades similares» (Acampora: USD 84.900 en lugar de U$S 143.640; Homes-Land: $ 75.000 en lugar de $ 210.000).
3. **DNS rebinding en `fetchPublic` (medio, corregido en Fase 1).** Se validaba el DNS y luego `fetch` volvía a resolver. Se reemplaza por un transporte que conecta solo a la IP validada.
4. **Bloqueo por IP de Vercel (por confirmar).** Desde este entorno de desarrollo las 16 URLs de QA respondieron 200 con el UA actual; el 403 histórico de Inmobiliatica/Cloudflare parece ligado a las IP de Vercel. Se mide desde el preview.
5. **Componentes monolíticos** (`agency-panel.tsx` 1828 líneas, `demo-view.tsx` 1649, `demo-editor.tsx` 1669): riesgo de regresión en Fases 2–3; se extraen piezas con tests.
6. **Costos externos** (render provider, video): requieren aprobación antes de contratar.

## 5. Contratos de eventos (se instrumentan en cada fase)

Eventos existentes que se reutilizan: `property_import_started/completed/failed`, `cta_clicked`, `property_shared`, `property_version_downloaded`, `agency_claimed`, `plan_click`, `checkout_creado`, `compra_confirmada`.
Nuevos (spec §8): importador `listing_import_preview_{started,completed,failed}`, `listing_import_{confirmed,completed,partial,failed}` con `platform`, `strategy`, `error_code`, `missing_fields`, `duration_ms` (sin URL cruda); features futuras `future_feature_{nav_clicked,page_viewed,interest_submitted}` con `feature_key`; video `video_*`; funnel `demo_value_action`, `panel_claim_{started,completed}`, `second_property_{import_started,created}`.

## 6. Feature flags

`NEXT_PUBLIC_HABITA_VIDEO` (tarjeta/ruta Video, apagado hasta Fase 5), `SCRAPER_PROVIDER` + credenciales (render provider, apagado sin aprobación), `HABITA_V2_DEMO` (nueva demo, para rollout gradual en Fase 3).

## 7. Plan de fases y migraciones

| Fase | Commits/PR | Migraciones | Dependencias |
| --- | --- | --- | --- |
| 0 Auditoría | este documento | — | — |
| 1 Importador | fetch seguro · detección/extractores · fixtures+tests · diagnóstico preview · QA preview | — (diagnóstico va en la respuesta, no en DB) | — |
| 2 Panel V2 | sidebar/drawer · home 3 tarjetas · páginas futuras + interés | `feature_interest` (aditiva, RLS) | — |
| 3 Demo mobile-first | header · slider/thumbnails/estilos · editor contextual · ficha · comprador | — | Fase 1 (CTA «Crear propiedad») |
| 4 Claim seguro | separación demo/claim · OTP · aprobación · migración de invitaciones | `agency_claim_requests` (aditiva) | bloquea difusión de «Guardar panel» |
| 5 Video | 5A benchmark · 5B infra+Clásico · 5C clip+Equilibrado · 5D Cinematográfico | `video_jobs` (aditiva) | aprobación proveedor |
| 6 Analítica/QA | dashboards PostHog · onboarding · QA transversal | — | todas |

## 8. Decisiones que requieren aprobación

1. Proveedor de render (ScrapingBee / Browserless / Zyte / Firecrawl) **solo si** el preview confirma bloqueos que no se resuelven con el fetch directo.
2. Proveedor de video generativo y su costo por clip (Fase 5A).
3. Estrategia de transición de invitaciones vigentes (Fase 4): propuesta = los links ya enviados siguen abriendo la demo; el reclamo pide verificación OTP del email y, si el email no coincide con el contacto conocido de la agencia, aprobación del equipo.

## 9. Capturas «antes»

Las capturas mobile del estado actual están en `docs/ux/habita-v2/current-mobile-demo-*`. Las capturas de panel/demo antes/después (1440 px y 390 px) se generan con Playwright contra el preview de cada fase, porque requieren datos reales de Supabase.
