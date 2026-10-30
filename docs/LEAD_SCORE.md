# Lead Engagement Score (lead_score_v1)

Un score determinístico de 0 a 100 que mide cuánto interactúa cada visitante con
una demo. Mide **engagement e intención observada**, no la probabilidad de
contratar: nunca se muestra como «X % de probabilidad».

- Reglas y pesos: `src/lib/leads/config.ts` (única fuente). Cambiar un peso es una versión nueva.
- Cálculo: `src/lib/leads/score.ts` (funciones puras, sin I/O).
- Demo e inmobiliaria: `src/lib/leads/rollup.ts`.
- Ingesta del navegador: `src/lib/leads/ingest.ts` (validación) y `src/lib/leads/client.ts`.
- Persistencia: `src/lib/leads/server.ts` y `supabase/migrations/202611140001_lead_engagement.sql`.
- Backfill: `src/lib/leads/backfill.ts` y `scripts/lead-backfill.ts`.
- Panel: `/admin/leads` (`src/components/admin-leads.tsx`); badge en `/admin/demos`.

## 1. Auditoría (30/10/2026)

- **Stack.** Next.js 16 (App Router) con React 19, Supabase (Postgres y auth) y PostHog
  (`posthog-js`, con proxy `/ingest`). Tests con Vitest y PGlite sobre las migraciones reales.
- **Relaciones.** `agencies` 1—n `demo_properties` 1—1 `demos` (token público).
  `agency_members` vincula cuentas con inmobiliarias y `demo_public_stagings` vincula las
  generaciones públicas (visitante + clave) con `generations`.
- **Visitantes.** `habita_visitante` (localStorage, aleatorio) para el servidor y `$device_id`
  y `distinct_id` para PostHog. El equipo se detecta por la sesión (`ADMIN_EMAILS`) en el
  servidor y por `is_internal` (panel admin o `?habita_interno=1`) en PostHog.
- **`demo_style_viewed` no es un clic.** Lo dispara `ViewTimer`: mide el tiempo en pantalla de
  una foto en un estilo y se reporta al cambiar de foto o estilo, al **ocultarse la pestaña**,
  en `pagehide` o al navegar. Si el contenido vuelve a quedar a la vista, el timer arranca de
  nuevo. En O'farrel, 30 de los 34 eventos son de un solo dispositivo del equipo con un solo
  estilo (`modern`): 16 al ocultar la pestaña, 11 en `pagehide` y 3 al navegar. Los otros 4
  son del único visitante externo. No suma puntos.
- **El clic explícito en un estilo es `demo_estilo`** (`choose`). Desde `tracking_version = 2`
  (30/10, 12:44 UTC) no hay ningún `demo_estilo`. Las demos abren ya comparadas en un estilo,
  y en ese período nadie eligió otro a mano. Conviene confirmarlo en la validación manual (§8).
- **`demo_photo_changed`** se dispara solo cuando cambia el índice, y eso pasa únicamente
  por una acción del visitante (flecha, swipe, miniatura o teclado). La foto inicial nunca se
  reporta.
- **`comparison_slider_used`** se envía una vez por gesto completo que movió la línea.
- **`agency_signup_started`** se dispara cuando se ve la pantalla de registro, no cuando se
  empieza a completar. El inicio real es `signup_form_started`.
- **No existe hoy una acción de «solicitar contacto o demo» a habita.** `demo_contacto` y
  `demo_visita` son compradores contactando a la inmobiliaria. `demo_contact_requested` queda
  definido y validado para cuando exista ese envío.
- **Las grabaciones de PostHog** están bloqueadas para `/demo` y `/panel` en la configuración del
  proyecto, así que el panel no muestra enlaces a grabaciones.

## 2. Reglas exactas

| Dimensión | Regla | Máx. |
| --- | --- | --- |
| Visual | +4 por estilo distinto (máx. 8) · +2 por foto distinta elegida (máx. 6) · +6 por usar el slider (una vez) | 20 |
| Profundidad | +3 a 30 s activos · +4 a 90 s · +4 a 180 s · +4 por usar ≥ 2 funcionalidades distintas | 15 |
| Comercial | +12 CTA para inmobiliarias · +10 vio precios · +8 empezó el registro · +15 solicitud de contacto | 35 |
| Activación | +5 pidió una generación · +12 generación confirmada · +6 empezó una importación · +15 importación completa o cuenta creada | 25 |
| Recurrencia | +3 un segundo día calendario · +2 un tercero (Buenos Aires) | 5 |

`score = min(suma, sin comercial ni activación ? 39 : 100)`. Las funcionalidades son
selección de estilo, navegación de fotos, slider, generación y consulta comercial.

| Score | Clase |
| --- | --- |
| 0–19 | Muy frío |
| 20–39 | Frío |
| 40–59 | Tibio |
| 60–79 | Caliente |
| 80–100 | Muy caliente |

- **Visitante × demo** es la unidad.
- **Demo** = el mayor score de un visitante externo. Si solo la visitó el equipo, figura como
  «Sin actividad externa».
- **Inmobiliaria** = el mayor score entre sus demos.

Nunca se suman scores.

## 3. Eventos

| Evento lead | Origen | Regla |
| --- | --- | --- |
| `demo_opened` | `demo_vista` (una por vista de página) | sin puntos; cuenta días distintos |
| `demo_style_selected` | `choose()` | con `style_id`; original no cuenta |
| `demo_photo_selected` | cambio de índice hecho por el visitante | la primera foto no se reporta |
| `demo_comparison_used` | `reportSlider` (gesto completo) | |
| `demo_active_time` | `startDemoEngagement` (visible y con actividad en los últimos 30 s) | una fila por vista de página con el total acumulado |
| `demo_agency_cta_clicked` | mismo evento existente | sale por beacon |
| `demo_pricing_viewed` | la sección Precios queda en pantalla | |
| `demo_signup_started` | `signup_form_started` | se acredita a la última demo abierta (60 días) |
| `demo_generation_started` / `_completed` | **servidor**: ruta `/api/demo/[token]/generar` | completada solo con `status = succeeded` y `result_path` |
| `demo_property_import_*`, `demo_account_created` | panel o invitación | se aceptan solo de una cuenta miembro de la inmobiliaria de la demo |

- **Envío.** El navegador manda los eventos en lotes a `POST /api/demo/[token]/leads`. La demo sale
  del token; los ids de demo, agencia, estilo y foto se validan, y no se acepta texto libre,
  URLs ni códigos. Cada evento lleva un `event_id` aleatorio: un reintento se guarda una sola vez.
- **Señales de PostHog.** Los eventos de PostHog no cambiaron. Las señales nuevas salen de los
  mismos puntos del código, así una acción no queda contada dos veces con otro nombre.
- **Recálculo.** La demo se recalcula después de responder (`after`), así que la página nunca espera.

## 4. Visitantes internos

Un visitante es interno si:

- Alguno de sus eventos viene de una sesión del equipo (`team_session`).
- El dispositivo está marcado (`device_flag`, la marca de PostHog `habita_internal`).
- Es una automatización (`navigator.webdriver`).
- Es un bot (por user agent).
- Es tráfico de preview o local (en el backfill).
- El equipo lo marcó a mano desde el panel (`manual`).

Al marcarlo se guarda quién y cuándo (en `lead_internal_visitors` y `admin_audit`) y se
recalculan sus demos. Sus eventos quedan guardados para QA, pero no cuentan.

Confianza de identidad:

- `identified`: cuenta de la inmobiliaria verificada por el servidor.
- `linked`: llegó por el enlace de presentación.
- `anonymous`: cualquier otro caso.

Tener el enlace no prueba que lo abrió el dueño, y el panel lo dice. También avisa cuando un
visitante abrió demos de varias inmobiliarias: suele ser alguien del equipo.

## 5. Arquitectura y rendimiento

- Los eventos (`lead_events`) son la fuente de verdad.
- Cada lote nuevo recalcula su demo completa (cientos de filas) y reemplaza sus filas en
  `lead_visitor_scores`.
- El panel solo lee `lead_visitor_scores`, en una consulta.
- La lista de demos carga primero y los badges de score llegan después, en un pedido aparte.
- El detalle de una inmobiliaria carga cuando se abre.
- No hay cron. `POST /api/admin/leads/recalcular` (el botón «Recalcular todo») rehace todo desde
  los eventos para auditar, y da las mismas filas que el cálculo incremental.

## 6. Backfill

```bash
node --experimental-strip-types scripts/lead-backfill.ts          # dry-run
node --experimental-strip-types scripts/lead-backfill.ts --apply  # guarda y recalcula
```

Se pagina de a 1000 eventos por (timestamp, uuid). Se puede reanudar (`--state`) y es
idempotente: guarda `b:<uuid de PostHog>` y para las generaciones usa los mismos ids que el
servidor en vivo. Corta en el primer evento de la instrumentación nueva, así nada se cuenta dos
veces.

**Se puntúa:**

- `demo_vista`.
- `demo_estilo` con estilo.
- `demo_photo_changed` con `method` y `photo_id`.
- `comparison_slider_used` que se movió.
- `demo_active_time`.
- `demo_agency_cta_clicked`.
- `demo_owner_precios`.
- `signup_form_started`.
- Las generaciones de `demo_public_stagings` + `generations`. El dispositivo de PostHog se
  vincula solo con un único clic de generar de la misma demo y estilo en los 2 minutos previos.

**No se puntúa:**

- `demo_style_viewed`.
- `agency_signup_started`.
- `demo_generation_completed` del navegador.
- `diseno_generado` y `foto_subida` (editor general).
- `demo_contacto` y `demo_visita`.
- `cta_clicked` (duplica los eventos anteriores).
- El reclamo de Russillo (cuenta creada el 27/10 por invitación, sin demo vinculada). El panel
  lo muestra como dato («Ya tiene cuenta»), no como puntos.

**Calidad:**

- `complete`: eventos con `tracking_version = 2` (desde el 30/10/2026, 12:44 UTC).
- `partial`: incluye eventos anteriores, cuando no existían fotos, slider ni tiempo activo.

### Simulación con datos reales (30/10/2026, hasta 20:57 UTC)

Se ejecutó con los datos reales de PostHog y Supabase, agregados por visitante y demo con
las mismas reglas, y puntuados con el mismo código. Todavía no se escribió nada.

| Métrica | Valor |
| --- | --- |
| Demos con score (visitas externas) | 13 de 19 |
| Demos solo con visitas del equipo | 6 (Monteagudo, Fernando Bressi, Arenal, Selecto, Pelemene y una de Mazza) |
| Demos con score histórico parcial | 12 |
| Visitantes × demo externos | 41 |
| Visitantes × demo internos excluidos | 26 (3 dispositivos del equipo) |
| Inmobiliarias con señales comerciales | 3 (GMC, Vitelli, Cavalca: CTA para inmobiliarias) |
| Generaciones confirmadas por la base | 5 (GMC 4, Vitelli 1) |

| Inmobiliaria | Score | Clase | Calidad | Ext. | Señal principal |
| --- | --- | --- | --- | --- | --- |
| GMC Propiedades | 43 | Tibio | parcial | 4 | CTA para inmobiliarias + precios + generación |
| Vitelli Propiedades | 33 | Frío | parcial | 1 | CTA para inmobiliarias + generación |
| Cavalca | 24 | Frío | parcial | 9 | CTA para inmobiliarias |
| Russillo Inmobiliaria | 22 | Frío | parcial | 12 | 17 fotos, slider, 2 días |
| O´farrel Propiedades | 19 | Muy frío | completa | 1 | 3 fotos y slider |
| Sauro Propiedades | 19 | Muy frío | parcial | 2 | 7 fotos y slider |
| A.L.A.N. Propiedades | 8 | Muy frío | parcial | 2 | 2 estilos |
| (agencia con nombre de aviso de Argenprop) | 8 | Muy frío | parcial | 2 | 2 estilos |
| GAUSACHS, Mazza, Knaidel, Moghames | 0 | Muy frío | parcial | 1–2 | solo abrieron la demo |

Casos verificados:

- **O'farrel.** Los 34 `demo_style_viewed` suman 0. El visitante externo tiene 19
  (3 fotos, slider y 42 s). El del equipo (33) no cuenta.
- **Sauro.** Dos visitantes externos (19 y 0): la demo vale 19, no 19 + 0.
- **Russillo.** Las 17 fotos y los 5 usos del slider son del visitante `01a18370` en la demo
  enviada (`e5d7286e`).
- **Pelemene.** Solo hay visitas del equipo: Sin actividad externa.

A revisar: cinco dispositivos abrieron demos de más de una inmobiliaria (`01a16fbc`,
`01a17008`, `01a18984`, `01a1836c` y su visitante `a96bb19a`). `01a1836c` hizo 3 de las 4
generaciones de GMC. Si son del equipo, hay que marcarlos como internos en el panel, y GMC
quedaría con el score de su otro visitante (43, sin cambios).

## 7. Riesgos y limitaciones

- Antes del 30/10 no había eventos de fotos, slider ni tiempo activo. Por eso los scores
  históricos son parciales y tienden a ser bajos.
- Los dispositivos del equipo anteriores a la marca `is_internal` (26–27/10) no se detectan
  solos. El aviso de «visitante compartido» ayuda a encontrarlos.
- El visitante es un navegador: la misma persona en dos dispositivos cuenta como dos.
- `demo_contact_requested` todavía no tiene origen en el producto.
- El registro y la importación se acreditan a la última demo abierta en ese navegador, y solo
  si la cuenta es miembro de esa inmobiliaria.

## 8. Validación manual

1. Aplicar la migración `202611140001_lead_engagement.sql` en el SQL Editor.
2. Desde un celular sin sesión, sin `?habita_interno=1`: abrir una demo de prueba, elegir un
   estilo **distinto** al inicial, cambiar 3 fotos, mover el slider, quedarse más de 90 s y abrir
   Precios.
3. En `/admin/leads`, abrir la inmobiliaria: deberían verse 16 de visual (4 + 6 + 6), 11 de
   profundidad (3 + 4 por tiempo y 4 por funcionalidades), 10 de comercial y un score de 37. En PostHog, confirmar que hubo `demo_estilo`.
4. Repetir con la sesión del equipo iniciada: ese visitante no debe aparecer como externo.
5. Marcar el visitante como interno y desmarcarlo: el score debe recalcularse.
6. Correr el backfill en dry-run y después con `--apply`.

## 9. Ideas para v2

- Un formulario real de «quiero que me contacten» en la demo, para dar origen a `demo_contact_requested`.
- Que los puntos pierdan peso con la inactividad (por ejemplo, la mitad a los 14 días), como señal aparte.
- Unir dispositivos de una misma persona cuando inicia sesión.
- Calibrar los pesos con conversiones reales cuando haya suficientes, sin mostrarlo como probabilidad.
- Habilitar las grabaciones de PostHog en `/demo` con enmascarado, para enlazarlas desde el panel.
