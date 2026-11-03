# Analítica de demos y adquisición B2B (PostHog)

> El Lead Engagement Score (qué inmobiliaria está más interesada) usa estos mismos puntos
> del código y se documenta en [LEAD_SCORE.md](LEAD_SCORE.md).

Qué se mide, dónde se dispara cada evento y cómo leerlo. Todo pasa por el
PostHog existente (`src/instrumentation-client.ts`, proxy `/ingest`), que solo
envía eventos en producción o con `NEXT_PUBLIC_POSTHOG_KEY` definido.

Código:

- `src/lib/analytics.ts`: `track`, super propiedades, `trackMilestone` y
  propiedades de persona.
- `src/lib/interaction-tracking.ts`: clics en CTAs (atributos `data-cta`),
  marca de tráfico interno, resumen del slider, tiempo por estilo y tiempo activo.
- `src/lib/signup-tracking.ts`: pasos de los formularios de registro.
- `src/lib/tracking-routes.ts`: `surfaceOf` y `routeOf` (la pantalla como plantilla).
- `src/lib/analytics-setup.ts` + `scripts/posthog-setup.ts`: los tableros, embudos y
  acciones de PostHog como código (ver §5).

> **Versión 3 (noviembre 2026).** Además de los CTAs con id, ahora se mide **todo clic**
> en botones y enlaces de demos, panel, registro y sitio (`ui_clicked`), los formularios
> enviados (`form_submitted`), hasta qué sección llega cada visita (`section_viewed`),
> mapas de calor y clics sin respuesta de PostHog, y cada evento lleva la pantalla
> (`route`). El panel tiene ids estables en todas sus acciones principales (§3.1).
> `tracking_version` pasa a `3`; los filtros de antes usan `tracking_version >= 2`.

## 1. Los tres eventos que ya existían, exactamente

| Evento | Dónde | Qué representa |
| --- | --- | --- |
| `demo_agency_cta_clicked` | `src/components/demo-view.tsx`: botones de la barra de la inmobiliaria en «modo demostración» (`OwnerHeader`, `origen` = `demo_encabezado_inicio`, `_imagenes`, `_crear`, `_crear_movil`, `_guardar`), el CTA «Probar esta propiedad en mi panel» (`PanelInvite`, `origen` = `demo_invitacion_lateral` / `_final`) y «Crear mi inmobiliaria gratis» (`origen` = `demo`). | **Clic** en un CTA que lleva al alta de la inmobiliaria. Los siete botones van al mismo destino (el alta con la invitación), así que hasta ahora solo se distinguían por `origen`. Ahora suman `cta_id`, `cta_location` y `cta_intent` (qué quería abrir: `panel_home`, `panel_images`, `create_property`, `save_panel`) y salen por beacon para no perderse al navegar. |
| `agency_signup_started` | `src/components/agency-panel.tsx` (`AgencyOnboarding`, sin sesión) y `src/components/agency-invitation.tsx` (`InvitationSignup`, al haber invitación válida). | **Pantalla de registro vista**, no registro empezado: se dispara al montarse la pantalla, sin que la persona toque nada. Se conserva con el mismo nombre para no romper los funnels actuales. Para «empezó a completar» usar `signup_form_started`. Ya no se dispara en la vista previa del equipo. |
| `agency_created` | `src/components/agency-panel.tsx` (`AgencyOnboarding.run("created")`), tras `POST /api/panel` exitoso. | **La inmobiliaria quedó creada** (no la cuenta: la cuenta ya existía). El reclamo con código es `agency_claimed`. Ahora lleva `agency_id` y sale por beacon. |

## 2. Identificación y atribución

Cada evento ya trae de PostHog: `distinct_id` (visitante anónimo, luego la
persona), `$session_id`, `$device_type`, `$current_url`/`$pathname` (con el
`codigo` reemplazado por `[oculto]` en `before_send`), `$utm_*` y el vínculo a la
grabación de la sesión cuando existe.

Super propiedades (viajan en todos los eventos siguientes del navegador):

| Propiedad | Cuándo | Para qué |
| --- | --- | --- |
| `demo_id`, `demo_titulo`, `demo_inmobiliaria`, `demo_inmobiliaria_id` | al ver una demo pública (ya existían) | última demo vista |
| `demo_link_type` | al ver una demo | origen del enlace: `owner_invitation` (presentación con invitación vigente, modo demostración), `presentation_invitation` (con invitación, vista «ficha»), `presentation_invite_unavailable`, `presentation`, `buyer`, `agency_site` |
| `first_demo_id`, `first_demo_agency_id`, `first_demo_link_type` | primera demo vista (`register_once`) | atribución de primer contacto hasta el registro y la primera importación |
| `agency_id` | al crear/reclamar la inmobiliaria y cada vez que carga el panel | vincular todo lo posterior a la cuenta B2B |
| `app_env` | siempre | `production`, `preview` o `local` |
| `is_internal` | dispositivos del equipo | excluir tráfico interno |
| `tracking_version` | siempre (`3` desde noviembre 2026; `2` desde el 30/10/2026) | distinguir datos anteriores a cada instrumentación |
| `product` | siempre (`habita`) | el proyecto de PostHog era «amoblaia»: separa estos eventos si conviven con otros |

Además, `before_send` agrega a **todo** evento (también `$pageview`, `$autocapture`):

| Propiedad | Valor |
| --- | --- |
| `route` | la pantalla como plantilla, sin ids ni códigos: `/demo/:token/presentacion/:code/precios`, `/panel/propiedades/:id`, `/inmobiliaria/:slug/:token`, `/panel/imagenes/lote`… |
| `surface` | si el evento no la trae: `demo`, `agency_site_property`, `agency_site`, `signup`, `panel`, `pricing`, `auth`, `home`, `short_link`, `admin`, `other` |

Propiedades de persona (`$set_once`): `first_demo_*` (solo para enlaces de
presentación, no para compradores, para no crear perfiles de cada visitante),
`account_created_at`, `first_agency_id`, `first_import_started_at`,
`first_import_completed_at`, `first_generation_started_at`,
`first_generation_completed_at`; y `agency_id`, `is_internal` con `$set`.

**Origen comercial de la invitación.** Los enlaces que el equipo manda por
WhatsApp (`presentationPath`) no llevan UTM: el origen se lee de
`demo_link_type`. Si se quiere distinguir campañas o canales (WhatsApp, email,
Instagram de la prospección), el siguiente paso es agregar
`utm_source/utm_medium/utm_campaign` al enlace que arma `src/lib/agency/admin.ts`;
no se hizo porque cambia el enlace que recibe la inmobiliaria.

### Tráfico interno

`is_internal = true` en eventos y persona cuando:

1. El dispositivo abrió el panel del equipo (`AdminNav`, solo se dibuja para el equipo).
2. El equipo ve la vista previa del alta por invitación (`InvitationSignup` con `preview`).
3. Se abrió cualquier página con `?habita_interno=1` (para teléfonos de prueba).
   `?habita_interno=0` lo quita.

La marca queda en `localStorage` (`habita_internal`). En los dashboards:
filtro `is_internal` ≠ `true` **y** `app_env` = `production`. Conviene sumar
esta condición al filtro de cuentas de prueba del proyecto (Settings → Filter
out internal and test users) para que se aplique sola. La vista previa del
equipo desde el admin (`source.kind = "preview"`) no envía eventos.

## 3. Catálogo de eventos nuevos

Salvo indicación, todos los de la demo llevan además el contexto de la demo
(`demo_id`, `agency_id`, `inmobiliaria_id`, `demo_link_type`, `owner_mode`, …).

### CTAs: `cta_clicked`

Un evento por clic en cualquier elemento con `data-cta` (helper `cta()`), en
fase de captura, antes de navegar; por beacon si el enlace sale de la página.

| Propiedad | Valor |
| --- | --- |
| `cta_id` | identificador estable del botón |
| `cta_location` | zona: `owner_bar`, `owner_bar_mobile`, `credits_menu`, `styles_panel`, `pricing_drawer`, `header`, `gallery_side`, `contact_card`, `closing`, `sticky_bar`, `footer`, `habita_section`, `invite_lateral`, `invite_final`, `panel_home`, `panel_nav`, … |
| `cta_destination` | destino lógico: `signup_invitation`, `agency_signup`, `credits_menu`, `pricing_drawer`, `checkout`, `file_download`, `ai_generation`, `whatsapp`, `listing`, `panel_home`, … |
| `cta_kind` | `habita_b2b` (acción comercial de habita), `buyer_contact` (un comprador contactando a la inmobiliaria), `navigation`, `content`, `product_action` (una acción de trabajo dentro del panel: importar, generar, publicar, compartir, descargar) |
| `cta_intent` | solo en la barra de la inmobiliaria: qué quería abrir |
| `photo_id`, `style_id`, `plan` | cuando aplica |
| `surface` | `demo`, `agency_site_property`, `signup`, `panel`, `pricing`, `auth`, … |

CTAs instrumentados:

| `cta_id` | Botón real | Destino |
| --- | --- | --- |
| `owner_inicio`, `owner_imagenes`, `owner_crear`, `owner_crear_movil`, `owner_guardar` | Barra del modo demostración: Inicio, Imágenes, Crear propiedad (desktop/móvil), Guardar mi panel | `signup_invitation` |
| `owner_my_properties` | Mis propiedades | `section_property` |
| `owner_credits` | Créditos (abre el menú) | `credits_menu` |
| `owner_generate_menu` | Generar sin registrarte | `styles_panel` |
| `owner_pricing` | Ver precios (menú Créditos) | `pricing_section` |
| `owner_nav_pricing` | Precios (barra de la inmobiliaria) | `pricing_section` |
| `prices_back` | ← Volver a la propiedad | `demo` |
| `owner_buyer_view` | Ver como comprador | `demo_buyer_view` |
| `owner_download` | Descargar (original o estilo) | `file_download` |
| `owner_generate` | Generar (estilo sin versión) | `ai_generation` |
| `invite_panel_lateral`, `invite_panel_final` | Probar esta propiedad en mi panel | `signup_invitation` |
| `create_agency` | Crear mi inmobiliaria gratis | `agency_signup` |
| `banner_by_habita` | «Por habita.» de la franja | `habita_studio` |
| `pricing_buy_pack`, `pricing_buy_plan`, `pricing_buy_first_pack` | Comprar en /precios y en la sección Precios de la demo (`cta_location` con prefijo `demo_prices_`) | `checkout` o `signup_invitation` |
| `contact_whatsapp`, `contact_url`, `contact_phone`, `contact_email`, `contact_listing`, `schedule_visit`, `agency_website`, `open_map` | Contacto del comprador con la inmobiliaria | canal |
| `nav_property`, `nav_location`, `nav_contact` | Navegación de secciones | sección |
| `signup_create_account`, `signup_have_account`, `go_to_panel`, `invitation_google`, `invitation_back_to_demo`, `google_signin` | Alta y acceso | `auth_signup`, `auth_login`, `panel_home`, `google_oauth`, `demo` |
| `panel_nav_*`, `panel_next_step`, `panel_credits`, `buy_credits`, `import_images_*`, `imported_images`, `import_many_urls` | Panel de la inmobiliaria | sección / importación / precios |

### 3.1 Panel: ids de cada acción (v3)

| Zona (`cta_location`) | `cta_id` |
| --- | --- |
| Inicio, propiedades recientes (`panel_home_recent`) | `property_open`, `property_share`, `property_copy_link`, `property_edit`, `property_preview`; `panel_see_all_properties`, `site_open_public`, `site_open_preview` |
| Mis demostraciones (`panel_properties`, `property_card`, `property_table`) | `properties_add` (`cta_intent` `open`/`close`), `property_open`, `property_open_photo`, `property_quick_<acción>` (`share`, `buyer`, `stage`, `edit`, `video`, `photos`, `progress`, `publish`, `data`; `cta_intent` `primary`/`secondary`) |
| Menú «Más» (`property_more_menu`) | `property_more_photos`, `_edit_images`, `_download`, `_video`, `_data`, `_view_live`, `_preview`, `property_publish`, `property_unpublish`, `property_delete` |
| Importar (`import_form`, `import_preview`, `import_many`, `import_issues`) | `import_read`, `import_reread`, `import_confirm`, `import_many_urls`, `import_many_read`, `import_many_confirm`, `import_issue_open`, `import_issue_complete`, `import_issue_retry`, `import_issue_retry_photos` |
| Editor de la propiedad (`editor_header`, `editor_publication`, `editor_published`, `editor_review`, `editor_share`, `editor_video`, `editor_data`, `editor_invited_next`) | `editor_back`, `editor_preview`, `editor_publish`, `editor_unpublish`, `editor_share`, `editor_copy_link`, `editor_share_whatsapp`, `editor_view_live`, `editor_rotate_link`, `editor_reread_listing`, `editor_mark_reviewed`, `editor_main_style` (`style_id`), `editor_video_open`, `editor_create_listing_from_photos`, `editor_next_property` |
| Estudio de fotos (`studio_stage`, `studio_versions`, `studio_result`, `studio_create`, `generate_dialog`, `studio_edit`, `studio_batch_bar`, `studio_upload`) | `photos_upload`, `studio_new_version`, `generate_review`, `generate_confirm`, `credits_blocked_buy`, `studio_download`, `studio_use_in_demo`, `studio_show_in_listing`, `studio_show_retouch_in_listing`, `studio_set_cover`, `studio_unset_cover`, `studio_batch_toggle`, `retouch_save` |
| Revisión de una versión (`version_review`) | `review_download`, `review_show_in_listing`, `review_discard`, `review_regenerate` |
| Imágenes (`images_*`) | `images_search_link`, `images_read_listing`, `images_continue`, `images_import`, `images_import_more`, `images_retry_import`, `images_make_listing`, `images_group_make_listing`, `images_group_stage`, `images_group_open`, `images_open_studio`, `images_open_property`, `images_stage_batch`, `images_open_duplicate` |
| Tanda (`batch_*`) | `batch_add_photos`, `batch_review`, `batch_generate`, `batch_retry`, `batch_see_credits`, `batch_adjust_in_editor`, `batch_open_result`, `batch_open_first_ready`, `batch_go_images` |
| Estudio de imágenes (`studio_menu`, `studio_empty`) | `studio_menu_help`, `studio_menu_make_listing`, `studio_menu_open_property`, `studio_empty_from_url` |
| Usuarios (`panel_team`, `team_invite_link`, `team_user_form`, `team_join`) | `team_new_user`, `team_edit_user`, `team_save_user`, `team_remove_user`, `team_renew_link`, `team_copy_invite`, `team_share_whatsapp`, `team_join_one_click`, `team_join_submit` |
| Mi sitio (`panel_site`) | `site_publish`, `site_unpublish`, `site_save`, `site_see_drafts` |
| Créditos (`panel_credits`) | `buy_credits`, `credits_account_history` |
| Alta (`agency_create`, `agency_claim`) | `agency_create_submit`, `claim_demos` |

Eventos de producto nuevos del panel: `credits_limit_viewed` (`where`: se mostró la
pared de «sin créditos» en el estudio o en el diálogo de generar), `property_deleted`,
`property_delete_cancelled`, `site_published`, `site_unpublished`.

### 3.2 Todo clic: `ui_clicked` (v3)

Cualquier clic en `a[href]`, `button`, `summary`, `[role=button|tab|menuitem|option|switch|link]`,
checkbox, radio, archivo o range que **no** sea un CTA con `data-cta` (esos siguen como
`cta_clicked`, para no romper los embudos). Nada en `/admin`. Un clic en un `<label>` que
pasa a su input cuenta una sola vez.

| Propiedad | Valor |
| --- | --- |
| `ui_element` | `button`, `link`, `tab`, `menuitem`, `checkbox`, `radio`, `file`, `summary`, … |
| `ui_id` | nombre estable si el elemento tiene `uiId("…")` (`data-track`): pestañas del editor (`editor_tab_fotos/datos/publicacion`), vistas (`properties_view_cards/table`), paginación, modos (`create_mode_furnish/redesign`), galería de la demo (`demo_gallery_prev/next`, `demo_style_pick`, `demo_tab_*`, `demo_video_*`), … |
| `ui_label` | el texto visible o `aria-label`, recortado a 60 caracteres, con emails, teléfonos y enlaces reemplazados por `[email]`, `[número]`, `[enlace]`. No se envía dentro de `[data-track-private]` o `.ph-no-capture` |
| `ui_area` | la zona: el `area("…")` más cercano (`data-track-area`) o el landmark (`header`, `nav`, `aside`, `footer`, `form`, `dialog`, `main`) |
| `href_kind`, `ui_destination` | en enlaces: `internal` (con la `route` de destino), `external` (solo el dominio), `whatsapp`, `email`, `phone`, `anchor` |
| `new_tab`, `checked`, `in_dialog` | cuando aplica |

### 3.3 Formularios: `form_submitted` (v3)

Un evento por envío, con `form_id` (`formId("…")`, si no su `aria-label` o la zona),
`ui_area` y `fields` (cantidad de campos). **Nunca** lo escrito.

### 3.4 Hasta dónde llegan: `section_viewed` (v3)

Una vez por sección y página, cuando se ve un tercio de la sección (o media pantalla
si es muy alta). Propiedad `section`. En la demo: `demo_prices`, `demo_heading`,
`demo_about`, `demo_description`, `demo_gallery`, `demo_styles_panel`,
`demo_video_card`, `demo_video_aside`, `demo_amenities`, `demo_contact_card`,
`demo_location`, `demo_conditions`, `demo_habita`, `demo_value`, `demo_save_demo`,
`demo_invite_lateral`, `demo_invite_final`, `demo_another_property`, `demo_closing`.
(`demo_hero`, `demo_header_buyer` y `demo_owner_bar` solo nombran la zona de sus clics.)

### 3.5 Mapas de calor y frustración (v3)

`enable_heatmaps` y `capture_dead_clicks` en `instrumentation-client.ts`: PostHog →
Heatmaps muestra dónde cliquean y hasta dónde bajan en cada página (filtrar por URL con
comodín, p. ej. `*/demo/*/presentacion/*`), `$dead_click` marca clics que no producen
nada y `$rageclick` clics repetidos. Las grabaciones de sesión siguen igual.

### Cómo instrumentar un botón nuevo

```tsx
import { area, cta, formId, uiId } from "@/lib/interaction-tracking";

<button {...cta("property_share", "panel_home_recent", "share_sheet", "product_action")}>…</button> // paso de un embudo
<button {...uiId("properties_view_table")}>…</button>   // nombre estable, sin evento propio
<section {...area("demo_gallery", true)}>…</section>    // zona de los clics + section_viewed
<form {...formId("team_user")}>…</form>                  // nombre de form_submitted
```

Sin nada, el clic igual llega como `ui_clicked` con su etiqueta: los ids son para que
los embudos no dependan del texto del botón.

### Comparador antes/después: `comparison_slider_used`

Un evento por **gesto completo** (soltar el mouse o el dedo; con teclado, 1,2 s
sin teclas o al salir del foco), nunca por movimiento. Un toque vertical que el
navegador usa para hacer scroll no cuenta.

`input` (`mouse` / `touch` / `pen` / `keyboard`), `start_position`,
`end_position`, `min_position`, `max_position` (0–100), `travel` (recorrido
total, puede pasar 100), `duration_ms`, `interaction_index` (1 = primera de la
visita: el inicio de la interacción es `timestamp − duration_ms`), `photo_id`,
`photo_index`, `style_id`, `demo_id`, `agency_id`, `surface`.

### Estilos

- `demo_estilo` (existía; enriquecido): `style_id`, `photo_id`, `photo_index`,
  `previous_style_id`, `selection_order` (orden en la visita),
  `distinct_styles`.
- `demo_original` (existía; enriquecido): `photo_id`, `previous_style_id`.
- `demo_style_viewed`: tiempo en pantalla de una foto en un estilo
  (`style_id` = `original` si es la original), solo con la pestaña visible y
  desde 1 s. `view_mode` (`compare` / `staged` / `original`), `duration_ms`,
  `end_reason` (`change`, `hidden`, `pagehide`, `navigation`, `unmount`).
- `demo_compare_opened`, `demo_more_styles_toggled` (`expanded`).

### Galería

- `demo_photo_changed`: `photo_id`, `photo_index`, `from_photo_id`,
  `from_index`, `method` (`arrow`, `swipe`, `thumbnail`, `keyboard`),
  `photos_total`, `photos_seen`.
- `demo_fullscreen_toggled`: `action` (`open`/`close`), `method`
  (`button`/`escape`), `photo_id`.
- `demo_thumbnails_scrolled`: `direction`.

### Tiempo activo: `demo_active_time`

Por tramos (cada vez que se oculta la pestaña, se sale o se navega): el total de
la visita es la **suma**. `active_ms` (visible y con actividad en los últimos
30 s), `visible_ms`, `max_scroll_pct`, `end_reason`.

### Precios y generación en la demo

- Precios es una sección del entorno de la inmobiliaria, con su propio enlace
  (`/demo/<token>/presentacion/<codigo>/precios`): la barra queda arriba y la
  propiedad se oculta debajo. `demo_owner_precios` lleva `origen`
  (`enlace` al entrar por ese link, `encabezado`, `menu_creditos`).
- `demo_prices_closed`: `method` (`button` / `nav` / `history` con el «atrás»
  del navegador), `duration_ms` mirando los planes.
- `demo_generation_failed`, `demo_generation_completed` (`duration_ms`),
  `demo_generation_timeout`.
- Se mantienen `demo_owner_creditos`, `demo_owner_precios`,
  `demo_owner_generar`, `demo_owner_download` (ahora con `photo_id` y
  `style_id`), `demo_owner_buyer_view`, `demo_contacto`, `demo_visita`,
  `demo_publicacion_original`, `demo_cta_click`.

### Registro

| Evento | Significado |
| --- | --- |
| `signup_form_viewed` | Pantalla/formulario visto, una vez por pantalla. `flow`: `agency_start` (pantalla «Creá tu inmobiliaria» sin sesión), `invitation`, `auth_signup`, `auth_login` (con solo Google, el primer ingreso crea la cuenta), `agency_create`, `agency_claim`. |
| `signup_form_started` | Primer carácter escrito o autocompletado (no el autofocus). `first_field` = tipo de campo (`email`, `new-password`, `text`), nunca su valor. |
| `signup_form_submitted` | Envío del formulario. |
| `signup_form_error` | `error_kind`: `captcha`, `terms`, `credentials`, `signup_refused`, `account_exists`, `api_<status>`, `signin`, `network`, `google_signin`; `step` en la invitación. Nunca el mensaje ni lo escrito. |
| `account_created` | La cuenta existe: `method` = `invitation_password`, `email_password` (`confirmation_pending: true`) o `google` (One Tap, cuenta nueva detectada por su fecha de creación). |
| `auth_google_completed` | Ingreso con Google One Tap completado (`new_account`). |

Las propiedades de contexto (`origin`, `has_invite`, `demo_id`, `from_plan`,
`mode`) acompañan a todos. Se mantienen `registro`, `agency_signup_started`,
`agency_created`, `agency_claimed`, `demo_to_agency_signup_completed`.

### Activación (una vez)

`first_import_started`, `first_import_completed`,
`first_generation_started`, `first_generation_completed`: el primer
`property_import_*` / `property_ai_generation_*` (o generación desde la demo,
`source = demo_owner`) de ese navegador, con la fecha como propiedad de persona
(`<evento>_at`). Los eventos de siempre siguen saliendo cada vez.

## 4. Privacidad y calidad

- Ningún evento lee valores de formularios, emails, contraseñas, teléfonos ni el
  código de invitación; los CTAs se identifican por `data-cta`, nunca por su texto.
  El `before_send` sigue redactando `codigo=` en cualquier texto.
- El slider y el scroll se resumen; nada se envía por movimiento.
- Las grabaciones de sesión enmascaran los inputs (configuración por defecto de PostHog).
- **Navegación:** el beacon de salida de PostHog se comprime de forma asíncrona y no
  sobrevive a una navegación en la misma pestaña (pasa también con su `$pageleave`).
  Por eso los clics que salen de la página envían su evento por beacon en el mismo
  clic y avisan a los temporizadores (`habita:leaving`) para que reporten antes.
  Cerrar la pestaña o pasar a otra app (ocultarla) sí envía los de salida.
- `demo_vista` se dispara una vez por demo: antes se repetía en cada refresco de
  la página mientras se generaba un estilo (cada 8 s), igual que el aviso de visita
  al servidor.
- Rendimiento: el módulo de clics se carga aparte (`import()` en
  `instrumentation-client.ts`); un solo listener de clic delegado; el tiempo activo
  usa un intervalo de 5 s y listeners pasivos.

## 5. Tableros, embudos y acciones (como código)

Definidos en `src/lib/analytics-setup.ts`; `tests/analytics-setup.test.ts` falla si un
tablero lee un evento que el código ya no envía. Para crearlos o actualizarlos en el
proyecto de PostHog (busca por nombre y la etiqueta `habita-setup`, no duplica):

```bash
POSTHOG_PROJECT_ID=… POSTHOG_PERSONAL_API_KEY=… node --experimental-strip-types scripts/posthog-setup.ts
```

```bash
POSTHOG_PROJECT_ID=… POSTHOG_PERSONAL_API_KEY=… node --experimental-strip-types scripts/posthog-setup.ts --apply --rename-project="habita"
```

Sin `--apply` solo muestra lo que haría. `--rename-project` cambia el nombre del proyecto
(antes «amoblaia»). La clave personal necesita `action:write`, `dashboard:write`,
`insight:write` y, para renombrar, `project:write`. Todos los gráficos filtran
`app_env = production`, sin `is_internal` y con el filtro de cuentas de prueba del proyecto.

**Acciones** (un paso del embudo que acepta varios eventos): «Inmobiliaria creada o
reclamada», «Clic en cualquier elemento» (`cta_clicked` + `ui_clicked`), «Propiedad
compartida», «Generación con IA completada», «Quiso comprar créditos».

**habita · Embudo comercial**

- *Demo → cliente (30 días)*: `demo_vista` (presentación) → `cta_clicked` hacia el alta →
  `signup_form_viewed` → `signup_form_started` → `account_created` → inmobiliaria creada o
  reclamada → `first_import_completed` → `first_generation_completed` → `checkout_creado` →
  `compra_confirmada`.
- *Demo → registro, por CTA* (desglose `cta_id`) y *por dispositivo* (`$device_type`).
- *Registro: dónde abandonan* (desglose `flow`), *Errores del registro* (`error_kind`),
  *Inmobiliarias nuevas por semana*.

**habita · Demos: qué hacen las inmobiliarias**

- *Profundidad de la demo*: abrió → movió el comparador → cambió de estilo → pasó de foto →
  clic en un CTA de habita.
- *CTAs más cliqueados*, *Otros clics* (`ui_label`), *Hasta dónde llegan* (`section_viewed`
  por `section`, visitantes únicos), *Estilos elegidos*, *Demos vistas por inmobiliaria*,
  *Tiempo activo por demo* (SQL: visitas, mediana y total por demo).

**habita · Panel: activación y uso**

- *Activación del panel (14 días)*: inmobiliaria lista → empezó una importación → importó →
  pidió una generación → generación lista → publicó → compartió.
- *Créditos: del límite a la compra*: `credits_limit_viewed` → clic para comprar →
  `checkout_creado` → `compra_confirmada`.
- *Importación: lectura → propiedad* (desglose por portal, `source`).
- *CTAs más cliqueados en el panel*, *Clics por pantalla* (`route`), *Otros clics en el panel*,
  *Pantallas más vistas*, *Formularios enviados*, *Frustración* (`$dead_click`, `$rageclick`).

### Journey individual

- Tabla SQL por persona/sesión con eventos en orden:

  ```sql
  SELECT timestamp, distinct_id, `$session_id`, event, properties.route,
         properties.demo_id, properties.cta_id, properties.ui_id, properties.ui_label,
         properties.section, properties.photo_id, properties.style_id, properties.`$device_type`
  FROM events
  WHERE properties.tracking_version >= 2
    AND coalesce(toString(properties.is_internal), '') != 'true'
    AND timestamp > now() - INTERVAL 30 DAY
    AND (properties.demo_id IS NOT NULL OR properties.agency_id IS NOT NULL)
  ORDER BY distinct_id, timestamp
  LIMIT 1000
  ```

- Lista de grabaciones filtrada por sesiones con `demo_vista` (`owner_mode = true`) o `cta_clicked` `habita_b2b`.
- Desde cualquier evento, «View recording» abre la grabación de esa sesión.

## 6. Validación pendiente en PostHog

En esta sesión, el PostHog conectado era el proyecto de Maru Coach, sin eventos
de Habita, así que **no hay validación contra el proyecto de producción de Habita**
ni se crearon los dashboards. Se validaron los payloads reales que arma el SDK
(ver la PR), con un colector local detrás del proxy `/ingest`.

Para validar en Habita, con un dispositivo marcado con `?habita_interno=1`
(los eventos llegan igual, solo quedan marcados):

1. Abrir el enlace de presentación de una demo de prueba con invitación y, en
   PostHog → Activity, filtrar por `is_internal = true`.
2. Recorrido A: mover el slider (mouse, teclado y en el teléfono con el dedo),
   cambiar estilos, recorrer fotos y salir. Esperar `comparison_slider_used` (uno
   por gesto), `demo_estilo`, `demo_style_viewed`, `demo_photo_changed`,
   `demo_active_time`.
3. Recorrido B: Créditos → Ver precios → Volver, y Precios de la barra →
   «atrás» del navegador. Esperar `cta_clicked` (`owner_credits`,
   `owner_pricing`, `owner_nav_pricing`, `prices_back`), `demo_owner_precios` y
   `demo_prices_closed`. Abrir el link de precios del admin: `demo_owner_precios`
   con `origen = enlace`.
4. Recorrido C: Crear propiedad → alta por invitación con un email de prueba →
   panel. Esperar `cta_clicked` `owner_crear`, `signup_form_viewed/started/submitted`,
   `account_created`, `agency_claimed`, y `agency_id` en los eventos siguientes.
5. Recorrido D: importar una publicación, generar **una** versión (usa un crédito
   de regalo) y descargarla. Esperar `first_import_*`, `first_generation_*` y
   `property_version_downloaded`.
6. Recorrido E (v3): en el panel, tocar pestañas del editor, el menú «Más», importar y
   compartir. Esperar `cta_clicked` con los ids de §3.1, `ui_clicked` con `route` y
   `ui_area`, `form_submitted` y, en la demo, `section_viewed` al bajar.
7. Comprobar que ningún evento tenga emails, contraseñas ni el código (buscar
   el código en Activity) y que `$current_url` muestre `codigo=[oculto]`.
