# Instrumentación para el CRO diario

Qué necesita saber quien analiza la conversión de Habita para leer PostHog sin errores. Este archivo es público: describe la estructura de la medición y no trae resultados. Métricas, hipótesis y enlaces a grabaciones quedan fuera del repositorio.

Quién hace qué: Claude corrige lo técnico y registra en `docs/qa-habita.md`. Astra analiza la conversión y propone cambios. Una persona aprueba y Claude implementa.

## 1. Versión de UX en cada evento

Desde este cambio, todos los eventos del navegador llevan estas propiedades. Las grabaciones no, pero se unen por `$session_id`.

| Propiedad | Qué es | Ejemplo |
| --- | --- | --- |
| `flow_name` | Flujo de la página: `home`, `demo`, `studio`, `signup`, `panel`, `pricing`, `account`, `auth`, `agency_site`, `admin`, `other` | `demo` |
| `ux_version` | Versión del diseño de ese flujo. Se lee siempre junto con `flow_name` | `v1` |
| `deployment_id` | Despliegue de Vercel que sirvió la página. Si no está disponible, el commit corto | `dpl_…` |
| `experiment_variant` | `experimento:variante`. Solo si hay un experimento activo. Hoy no hay ninguno | `precios_cta:b` |

Se agregan en `before_send` (`src/instrumentation-client.ts`, con `src/lib/ux-context.ts`), así que no se pierde el primer `$pageview` ni hay eventos nuevos o duplicados. Una pestaña abierta antes de un despliegue informa la versión que realmente muestra.

**Datos históricos.** No se renombró ningún evento y `tracking_version` sigue en `2`. Los eventos anteriores no tienen estas propiedades: valor vacío significa «antes del versionado», no una versión.

### Cuándo subir `ux_version`

Subí el número del flujo en `UX_VERSIONS` (`src/lib/ux-context.ts`), en el mismo PR, si el cambio altera cómo se usa ese flujo: orden de pasos, acción principal, textos que deciden una acción, formularios, precios mostrados o momento en que se pide la cuenta.

No lo subas por arreglos que no cambian la intención: un bug, rendimiento, accesibilidad sin cambio visible. Para eso alcanza `deployment_id`.

En el PR indicá flujo, versión anterior y nueva, y qué cambió. Sin esto no se pueden comparar cohortes antes y después.

### Historial de versiones

| Flujo | Versión | Desde | Qué cambió |
| --- | --- | --- | --- |
| `pricing` | `v1` → `v2` | Rediseño de precios | Los cuatro paquetes con precio total, precio por crédito y ahorro se ven de entrada; 25 créditos marcado «Recomendado» y preseleccionado; el CTA compra el paquete elegido; plan Gratis compacto al lado (solo en la página pública); datos NAR sobre home staging; «Cómo funcionan los créditos», «Qué incluye» y FAQ desplegables; desaparece la tarjeta de precios separada. |

### Precios dentro de otros flujos

El componente de precios también se muestra dentro del panel (`/panel/creditos`, flujo `panel`) y de la demo de una inmobiliaria (flujo `demo`). Ahí `flow_name` y `ux_version` siguen siendo los de la página, para no mover la versión de esos flujos. Para comparar el diseño de precios en cualquier superficie, los eventos propios de precios (`pricing_viewed`, `pricing_packages_viewed`, `pricing_package_selected`, `pricing_link_copied`, `pricing_link_shared`) llevan además `pricing_ux_version` (hoy `v2`) y `surface` (`precios`, `panel` o `demo`).

### Experimentos

`setExperimentVariant("experimento", "variante")` en `src/lib/analytics.ts`, y `setExperimentVariant(null)` al terminar.

## 2. Embudo y dónde leer cada paso

Los eventos se capturan en el navegador salvo que se indique otra cosa. Estado: **completo** se puede reconstruir hoy; **parcial** tiene una limitación concreta.

| # | Paso | Eventos | Estado |
| --- | --- | --- | --- |
| 1 | Primera visita a home o demo | `$pageview` con `flow_name` o `$pathname`; `demo_vista` | Completo. Primera visita por navegador |
| 2 | Primera interacción significativa con la demo | `demo_estilo`, `demo_style_selected`, `comparison_slider_used`, `cta_clicked`, `demo_value_action` | Completo. `demo_style_viewed` mide tiempo, no interacción |
| 3 | Inicio de generación | `demo_trial_generation_started`, `demo_owner_generation_started`, `first_generation_started`, `property_ai_generation_started`, y `foto_subida` en `/estudio` | Parcial. `/estudio` no tiene evento de inicio: `foto_subida` es el mejor aproximado |
| 4 | Imagen generada | `demo_trial_generation_completed`, `demo_generation_completed`, `first_generation_completed`, `diseno_generado` | Completo |
| 5 | Continuación a panel o editor | `demo_generated_result_save_clicked`, `cta_clicked`, `panel_entry_choice`, `panel_exploration_home_viewed`, `$pageview` en `/panel` | Completo |
| 6 | Cuenta creada | `account_created`, `agency_created`, `agency_claimed`, `panel_claim_completed` | Parcial. `account_created` puede ser anterior a confirmar el e-mail |
| 7 | Primera interacción en el panel | `panel_start_picker_chosen`, `property_import_started`, `studio_opened`, `video_section_viewed`, `cta_clicked` con `surface = panel` | Parcial. No hay un evento único: se toma el primero de estos |
| 8 | Activado | Ver sección 3 | Parcial en PostHog; completo en la base |
| 9 | Vio precios | `pricing_viewed`, `limite_planes_visto`, `$pageview` en `/precios`. Desde `pricing` `v2`: `pricing_packages_viewed` (los paquetes estuvieron al menos un 60 % en pantalla, una vez por vista) y `pricing_package_selected` (eligió otro paquete; `sku`, `credits`, `discount_pct`, `recommended`) | Completo. `pricing_package_selected` no se dispara si compra el preseleccionado: en ese caso el paquete está en `plan` del `cta_clicked` de `pricing_buy_credits` |
| 10 | Checkout iniciado | `credits_checkout_started`, `checkout_creado`, `plan_click` | Completo |
| 11 | Pago confirmado | `compra_confirmada`; en el servidor, `payments_commercial` | Parcial. El evento solo sale si la persona vuelve a la página de retorno. La fuente de verdad es la base |

## 3. Qué significa «activado»

Se usa la definición que ya tiene el panel comercial (`docs/PROSPECCION.md`), para que los números no se contradigan:

> Primera ambientación hecha por un miembro de la inmobiliaria después de sumarse, completada y elegida como versión preferida de una foto de esa inmobiliaria.

Una visita, un clic, abrir el estudio, importar una propiedad o generar sin elegir **no** activan.

- **Fuente de verdad:** la base (`approved_generation_id`), por `src/lib/prospecting/metrics.ts`.
- **Aproximado en PostHog:** `first_generation_completed`. Es una condición necesaria, no suficiente: PostHog no ve la elección de la versión preferida. Sirve para encontrar grabaciones, no para informar activados.

## 4. Identificadores

| Necesidad | Cómo | Límite |
| --- | --- | --- |
| Usuario único | `person_id` | Es por navegador. No se llama a `identify`, así que el mismo usuario en dos dispositivos cuenta como dos |
| Sesión | `$session_id`, en todos los eventos | Ninguno |
| Anónimo a registrado | El mismo `distinct_id` antes y después del registro | Solo en el mismo navegador |
| Unir con la base | `agency_id` después de crear o reclamar la inmobiliaria | No se envía el id de usuario. Antes de eso no hay unión |
| Dispositivo | `$device_type`, `$browser`, `$os` | Ninguno |
| Canal | `gclid`, `fbclid`, `utm_*`, `$referring_domain`, `demo_link_type` | Los enlaces de WhatsApp no llevan UTM y su navegador interno no se distingue por user agent. `demo_link_type` indica el tipo de enlace, no el canal |

## 5. Tráfico interno

Filtro de cuentas de prueba del proyecto 683617: cohorte 659781 **y** `is_internal ≠ true`. En SQL:

```sql
NOT (properties.is_internal = true OR person_id IN COHORT 659781)
```

En SQL, comparar con `IS NOT NULL` y no con `!= ''`: en HogQL una propiedad ausente también cumple `!= ''`.

Detalle y limitaciones: `docs/TRAFICO_INTERNO.md`. Para detectar fugas, verificar que no queden `$pageview` en `/admin` después del filtro.

## 6. Grabaciones

Una grabación se relaciona con sus eventos por `session_id = $session_id`. Eso también da la versión de UX de cada momento de la sesión.

No hay filtro por nombre de evento en la lista de grabaciones: primero se buscan las sesiones y después se piden sus grabaciones.

```sql
-- Sesiones de ayer (Argentina) con intención comercial alta, excluyendo tráfico interno
SELECT $session_id AS session_id,
       max(event IN ('credits_checkout_started', 'checkout_creado')) AS inicio_checkout,
       max(event IN ('pricing_viewed', 'limite_planes_visto', 'plan_click')) AS vio_precios,
       max(event IN ('account_created', 'agency_created', 'agency_claimed', 'panel_claim_completed')) AS cuenta,
       max(event IN ('first_generation_completed', 'first_import_completed')) AS usa_el_panel,
       max(event IN ('diseno_generado', 'demo_trial_generation_completed', 'demo_generation_completed')) AS genero,
       max(event IN ('signup_form_viewed', 'signup_form_started', 'agency_signup_started')) AS abrio_registro
FROM events
WHERE toDate(toTimeZone(timestamp, 'America/Argentina/Buenos_Aires'))
        = toDate(toTimeZone(now(), 'America/Argentina/Buenos_Aires')) - 1
  AND timestamp >= now() - INTERVAL 3 DAY
  AND $session_id != ''
  AND NOT (properties.is_internal = true OR person_id IN COHORT 659781)
GROUP BY session_id
HAVING inicio_checkout OR vio_precios OR cuenta OR genero OR abrio_registro
```

Para ver si hay grabación: `session_id IN (SELECT session_id FROM session_replay_events WHERE start_time >= now() - INTERVAL 4 DAY)`. Para abrirlas: `query-session-recordings-list` con `session_ids` y `date_from`.

Algunos segmentos se definen por persona y no por sesión (por ejemplo, cuentas sin activación): usar `person_id` y traer todas sus sesiones.

### Limitaciones

- **Retención:** 30 días.
- **Muestreo:** ninguno configurado, y sin duración mínima. Aun así, no toda sesión tiene grabación: faltan sobre todo las de pocos segundos, y también algunas sesiones largas. El 100 % de lo disponible no es el 100 % de las sesiones. Siempre informar cuántas sesiones del segmento no tenían grabación.
- **Privacidad:** los campos de formularios se enmascaran. Las grabaciones de demos incluyen a compradores de las inmobiliarias: no copiar datos ni enlaces al repositorio.
- **`$dead_click`:** apagado en el proyecto. **`$exception`:** sin eventos en los últimos 30 días, porque la captura de excepciones no está activada. Los errores se ven en Vercel y en `console_error_count` de las grabaciones.
- **Zona horaria del proyecto:** UTC. «Ayer» debe calcularse en hora de Argentina.
- **`session_replay_events` trae metadatos**, no lo que ocurrió. Para eso hay que ver la grabación o usar Replay Vision, que consume créditos.
