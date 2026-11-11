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

## 3 bis. Recorrido de bienvenida del panel

Desde `panel` `v2`. Recorrido de 7 pasos sobre la home real del panel (`src/components/panel-tour.tsx`). Arranca solo una vez por cuenta (miembros que se sumaron hace 14 días o menos y no lo vieron, guardado en `profiles.panel_tour_seen_at`) y se vuelve a abrir desde «Ayuda → Volver a ver el recorrido». No arranca solo si la persona llega a seguir trabajando (enlace de la demo para importar, `?continuar=`, `?accion=`, un ancla de la home): espera a la próxima sesión.

| Evento | Cuándo | Propiedades |
| --- | --- | --- |
| `panel_tour_started` | Empieza el recorrido (no al reanudarlo tras recargar) | `tour_version`, `origin` (`auto` o `help`), `steps_total`, `role`, `device_type` |
| `panel_tour_step_viewed` | Se muestra un paso | Las anteriores y `step_id` (`welcome`, `demo`, `start`, `studio`, `video`, `demos`, `credits`), `step_index` (desde 1) |
| `panel_tour_completed` | Llega a la pantalla final | Las de `started` |
| `panel_tour_skipped` | Sale antes de la pantalla final | Las de `started`, `step_id`, `step_index`, `method` (`button`, `close`, `escape`) |
| `panel_tour_reopened` | Elige «Volver a ver el recorrido» en Ayuda | `tour_version`, `source_surface`, `device_type` |
| `panel_tour_primary_cta_clicked` | «Crear mi primera demostración» en la pantalla final | Las de `started` y `cta` |

`steps_total` cambia según el rol y lo disponible: sin herramientas para quien no puede crear (solo vista, o limitado a algunas propiedades) y sin video donde no está habilitado. Comparar `step_index` solo dentro del mismo `steps_total`.

El paso 3 muestra el selector real sin contar `panel_start_picker_opened`: el recorrido no ejecuta acciones. Después del CTA principal el selector se abre de verdad y sí lo cuenta.

Completar el recorrido no es activación. Para medir su efecto, comparar la activación (sección 3, `approved_generation_id`) de quienes lo vieron con la de quienes lo saltaron o no lo vieron, no `panel_tour_completed`.

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


## 7. Nuevas soluciones comerciales y cobertura de CTA del panel (panel v3)

Desde panel v3 el inicio mantiene las herramientas existentes y muestra Consultas IA y CRM Inteligente debajo de Virtual Staging. Los mismos accesos están en el sidebar debajo de API. Rutas: /panel/consultas-ia y /panel/crm-inteligente.

**Los recorridos trabajan con datos de ejemplo:** las conversaciones y contactos no pertenecen a clientes reales, y no están conectados con WhatsApp. Las acciones no son mensajes enviados ni operaciones concretadas.

### Cobertura universal de clics en el panel

src/lib/interaction-tracking.ts conserva el evento existente **cta_clicked** en elementos con data-cta, e incorpora **panel_cta_clicked** para cada clic en enlace, botón o role=button habilitado cuando la ruta comienza con /panel.

- panel_cta_clicked ofrece cobertura global; cta_clicked ofrece identificación explícita. Nunca sumarlos: un CTA anotado produce ambos eventos.
- Propiedades: cta_id, cta_location, cta_destination, cta_kind, control_tag, panel_path, annotated y surface=panel.
- annotated=true: ID legible explícito. annotated=false: ID estructural auto_*, para detectar controles que aún no tienen data-cta.
- No se registran textos de mensajes, valores de inputs, nombres de clientes, URL con identificadores ni parámetros privados. /panel/propiedades/:id se anonimiza.
- Un clic no equivale a una acción exitosa: el evento de resultado es distinto.

### Embudo de interés por producto

| Paso | Evento y propiedades | Interpretación |
| --- | --- | --- |
| Acceso desde inicio | cta_clicked: panel_home_consultas_ia / panel_home_crm_ia | Clic a cada producto desde tarjetas |
| Acceso desde sidebar | cta_clicked: panel_nav_consultas_ia / panel_nav_crm_inteligente | Clic a cada producto desde barra lateral |
| Entrada | commercial_workspace_viewed y/o $pageview en la ruta | Visita al producto, no demanda confirmada |
| Interacción Consultas IA | commercial_conversation_tested / commercial_visit_requested / commercial_handoff_toggled / commercial_rule_toggled | Interacciones con ejemplos, NO consultas reales |
| Interacción CRM | commercial_lead_opened / commercial_lead_stage_changed / commercial_task_created / commercial_followup_drafted / commercial_rule_toggled | Trabajo con ejemplos, NO contactos reales |
| Apertura de solicitud | commercial_activation_request_opened | Señal débil de intención |
| **Solicitud guardada** | **commercial_activation_request_submitted** | Señal fuerte: la API respondió después de guardar en base |
| Error al guardar | commercial_activation_request_failed | No contar como interesado confirmado |

Eventos de los recorridos llevan feature_key=consultas_ia o feature_key=crm_inteligente, demo_data=true. El contexto lleva flow_name=panel, ux_version=v3 y deployment_id. El formulario solo registra las categorías volume_band, primary_pain, readiness: no texto libre.

**Fuente de verdad:** tabla commercial_product_interest (un registro único por agencia, usuario y producto; vuelve a actualizar el mismo registro). PostHog puede perder eventos por bloqueadores, de modo que las solicitudes confirmadas deben cotejarse con la base.

### CRO diario obligatorio

Reportar ayer (hora Argentina) y períodos móviles de 7 y 14 días, con exclusión de cohorte interna 659781 e is_internal=true:

1. Por cada producto: clics desde inicio, clics desde sidebar, visitas al producto, sesiones y navegadores únicos.
2. Usuarios con una interacción significativa, sin confundir acciones en los ejemplos con operaciones inmobiliarias reales.
3. Solicitudes abiertas, confirmadas (PostHog versus base), tasa confirmadas/visitantes únicos del producto y confirmadas/visitantes únicos del panel.
4. Distribución de solicitudes por primary_pain, volume_band, readiness, dispositivo y día; origen de navegación cuando se pueda reconstruir por sesión.
5. Cobertura: total panel_cta_clicked, ranking de cta_id, porcentaje annotated y controles sin identificación explícita más utilizados. No sumar cta_clicked y panel_cta_clicked.
6. Grabaciones con evidencia real solamente, indicando sesiones sin grabación. Los person_id cuentan navegadores, no personas cross-device.

Si aún no hay tráfico posterior al despliegue, informar SIN DATOS; nunca inferir usuarios activos ni conversiones de los seis contactos ficticios del entorno de demostración.
