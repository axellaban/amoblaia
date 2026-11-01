# Habita V2 — Fase 2: panel, sitio web y features futuras

**Estado:** implementado; tests, lint, typecheck y build OK. Evidencia visual tomada con los componentes reales y datos de prueba (ver §4). **Pendiente para cerrar:** aplicar la migración en Supabase y una pasada en el preview con una cuenta real (ver §6).

## 1. Qué cambió

| Pieza | Archivo |
| --- | --- |
| Sidebar desktop + barra y drawer mobile | [`src/components/panel-shell.tsx`](../../src/components/panel-shell.tsx) |
| Home: saludo, 3 tarjetas, «Tus propiedades», crear otra propiedad, accesos | [`src/components/agency-panel.tsx`](../../src/components/agency-panel.tsx) (`HomeCards`, `HomeProperty`, `PanelHome`) |
| Página común «próximamente» con ilustración y opt-in | [`src/components/future-feature.tsx`](../../src/components/future-feature.tsx) |
| Rutas | `/panel/tour-360`, `/panel/planos`, `/panel/redes`, `/panel/api`, `/panel/video` |
| Catálogo de features y flag de Video | [`src/lib/agency/future-features.ts`](../../src/lib/agency/future-features.ts), [`src/lib/agency/flags.ts`](../../src/lib/agency/flags.ts) |
| API de interés | [`src/app/api/panel/interes/route.ts`](../../src/app/api/panel/interes/route.ts) (GET/POST/DELETE) |
| Migración | [`supabase/migrations/202611170001_feature_interest.sql`](https://github.com/axellaban/amoblaia/blob/claude/friendly-shannon-54k8z1/supabase/migrations/202611170001_feature_interest.sql) |
| «Estudio de imágenes» | `/panel/imagenes` renombrado y marcado en la sidebar |

**Video:** la tarjeta y la sección se ven en preview/desarrollo y llevan a una página honesta «Próximamente» que mide interés (no simula un generador). En producción quedan ocultas hasta que la Fase 5 esté operativa y se active `NEXT_PUBLIC_HABITA_VIDEO=1`. Hasta entonces la home de producción muestra 2 tarjetas; la tercera aparece con el flag.

## 2. Matriz requisito → implementación → evidencia

| Requisito (spec) | Implementación | Evidencia | Estado |
| --- | --- | --- | --- |
| §2.1 Sidebar verde con logo HABITA | `PanelNav` fija 248 px; header/footer del sitio se ocultan en páginas con sidebar | `panel-home-desktop.jpg`, test «sidebar» | ✅ |
| §2.1 Exactamente 3 tarjetas grandes: Crear demostraciones, Estudio de imágenes, Video | `HomeCards` | `compare-panel-home-desktop.jpg`, test «exactly three» | ✅ (Video tras flag en prod) |
| Crear demostraciones funcional | Lleva a «¿Querés crear otra propiedad?» con el importador de la Fase 1 y enfoca el campo | captura | ✅ |
| Estudio de imágenes → editor/importador existente | `/panel/imagenes` | — | ✅ |
| Sidebar: Inicio, Mis propiedades, Estudio, Video, Sitio web, Tour 360, Planos, Redes, API, Planes y créditos, Usuarios, Ayuda, Mi cuenta | `GROUPS` | test «sidebar» | ✅ |
| Tour 360/Planos/Redes/API sin «Próximamente» ni aspecto deshabilitado en sidebar | ítems normales con hover/foco/activo | test (`not.toMatch(/Próximamente/)`) | ✅ |
| …y sin tarjetas ni CTA en home | — | test «never the upcoming tools» | ✅ |
| Página propia: ilustración, título, beneficio, «Próximamente», «Me interesa / Avisame» | `FutureFeaturePage` + SVG original por feature | `compare-tour360-desktop.jpg`, test por feature | ✅ |
| Interés autenticado sin pedir email, reversible, canales opt-in separados | checkboxes **destildados**; «Cambiar avisos» / «Ya no me interesa» | `panel-tour360-submitted-desktop.jpg`, tests API | ✅ |
| Visitante no autenticado: email opt-in sin crear cuenta | Las páginas están dentro del panel autenticado; no hay acceso anónimo hoy | — | N/A en esta fase (se revisa con la demo temporal, Fase 3/4) |
| §5 `future_feature_nav_clicked` al elegir (con `feature_key`, `role`, `source_surface`, `device_type`) | `onClick` del ítem | código | ✅ |
| `future_feature_page_viewed` y `future_feature_interest_submitted` solo ante opt-in guardado | `FutureFeaturePage` | código | ✅ |
| Tabla `feature_interest` idempotente por agencia/feature/usuario, RLS | migración + `upsert onConflict` | test PGlite (unique, check, sin acceso `authenticated`) | ✅ |
| KPI agencias únicas interesadas / expuestas | `count(distinct agency_id)`; exposición = `future_feature_page_viewed` por `agency_id` (super-propiedad registrada) | test SQL | ✅ (insight en Fase 6) |
| «Sitio web» en sidebar, no en home | ítem para dueño/administrador; acceso rápido al pie | captura | ✅ |
| Precios accesibles | «Planes y créditos» + caja en sidebar | captura | ✅ |
| Mis propiedades y acciones existentes no pierden acceso | `HomeProperty` usa las mismas acciones (`usePropertyActions`, `MoreMenu`) | captura | ✅ |
| «Guardar panel» solo en demo temporal | El panel autenticado no lo muestra | test (`not.toMatch(/Guardar panel/)`) | ✅ |
| §2.2 Mobile: header compacto + drawer, 3 CTA legibles, propiedades sin scroll excesivo | barra de 60 px, drawer con Esc/foco, tarjetas en columna en el primer viewport | `panel-home-mobile-viewport.jpg`, `panel-drawer-mobile.jpg` | ✅ |
| Accesibilidad: targets ≥ 44 px, foco visible, sin acciones solo por hover | ítems, botones y enlaces ≥ 44 px; `:focus-visible` | capturas | ✅ |
| Roles: viewer no ve Sitio web/Usuarios ni las tarjetas de creación | filtros por rol | test «owner and administrators» | ✅ |
| Miguel Ángel preservado | `src/app/panel/layout.tsx` sin cambios | — | ✅ |

## 3. Diferencias conscientes con el mockup

- La caja derecha del saludo muestra **«Tu última propiedad»** en lugar de «Demo personalizada»: el panel autenticado no es una demo (ese mensaje corresponde a la demo temporal de la Fase 3).
- Las filas de «Tus propiedades» muestran operación, precio («Consultar precio» si no hay), estado y progreso de fotos. El resumen del panel no trae ambientes/m²/descripción; agregarlos requiere ampliar `/api/panel` (pendiente menor).
- «Compartir demo» del mockup se reemplaza por «Tu sitio web» en los accesos útiles: compartir cada ficha ya está en las acciones de la propiedad.
- Las imágenes de las tarjetas son las escenas ilustrativas propias de `public/ejemplos/`.

## 4. Evidencia visual

Capturas en [`docs/ux/habita-v2/evidencia/fase-2/`](../ux/habita-v2/evidencia/fase-2/), tomadas con Playwright sobre los **componentes reales** en `next dev`, con `/api/panel` y `/api/panel/interes` simulados (datos ilustrativos) porque este entorno no tiene credenciales de Supabase. En las capturas de página completa la sidebar fija termina a la altura del viewport: es un efecto de la captura, no del layout.

| Captura | Comparar con |
| --- | --- |
| `compare-panel-home-desktop.jpg` (izq. mockup, der. implementación) | `final-panel-desktop.png` |
| `compare-tour360-desktop.jpg` | `future-feature-page-example.png` (estado 2) |
| `panel-home-mobile-viewport.jpg`, `panel-home-mobile.jpg`, `panel-drawer-mobile.jpg` | §2.2 |
| `panel-tour360-mobile.jpg`, `panel-tour360-submitted-desktop.jpg`, `panel-home-empty-desktop.jpg` | estados vacío y confirmado |

## 5. Tests

`npm test`: **831/831** (822 al cierre de la Fase 1 + 9 de [`tests/panel-v2.test.tsx`](../../tests/panel-v2.test.tsx)) · lint OK · typecheck OK · build OK.

## 6. Para cerrar la fase

1. Aplicar la migración en el SQL Editor de Supabase: [`202611170001_feature_interest.sql`](https://github.com/axellaban/amoblaia/blob/claude/friendly-shannon-54k8z1/supabase/migrations/202611170001_feature_interest.sql). Sin ella, «Me interesa» responde error (el resto del panel funciona).
2. Recorrer el preview con una cuenta real (dueño y viewer) en 1440 px y 390 px.
