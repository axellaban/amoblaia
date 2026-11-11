# habita para inmobiliarias (MVP, 2026-10-27)

El generador de demos comerciales pasa a ser el núcleo de un panel donde cada
inmobiliaria administra sus propiedades, las transforma con IA, comparte fichas
y publica su catálogo. Todo está construido sobre las tablas, el importador,
la ficha y el motor de generación que ya existían. No hay un sistema paralelo.

El estado inicial quedó marcado con el tag `habita-base-2026-10-27` (`origin/main`
antes de este cambio).

## 1. Auditoría inicial (resumen)

| Pieza existente | Dónde | Cómo se reutiliza |
| --- | --- | --- |
| Inmobiliarias | `agencies` (+ `branding` JSON) | Pasan a tener dueño, `slug` y sitio publicable |
| Propiedades | `demo_properties` | Son las propiedades del panel (`origin`: `admin` o `agency`) |
| Fichas | `demos` (token, `draft`/`published`, `settings`) | Ficha pública, estado publicada/borrador y enlace para compartir |
| Fotos originales | `demo_photos` → `projects` (bucket privado) | Sin cambios; nunca se sobrescriben |
| Versiones IA | `generations` | Varias por foto, con estilo, modelo, uso y costo; la preferida queda en `demo_photos.approved_generation_id` |
| Créditos | `credit_grants`, `credit_ledger`, `amobla_reserve_batch` | Mismo sistema: 1 crédito por foto, versiones incluidas y reembolso automático si falla |
| Importador | `lib/demos/listing.ts`, `listing-details.ts`, `import.ts` | Mismo extractor y la misma protección SSRF |
| Ficha pública | `DemoView` (`/demo/[token]`) | También dentro del sitio `/inmobiliaria/[slug]/[token]` |
| Editor | `DemoEditor` | Modo `agency`: cobra créditos, confirma el costo y oculta las herramientas del equipo |
| Analítica | `lib/analytics.ts` (PostHog) | Eventos nuevos del embudo |

Riesgos encontrados y cómo se resolvieron:

- `addPhoto` reutilizaba proyectos por hash sin filtrar por usuario. Ahora las
  fotos de una inmobiliaria solo reutilizan copias de su dueño (`ownOnly`).
- Un proyecto de demo traspasado seguiría con el grant de demo, de saldo cero
  e ilimitado. El reclamo lo limpia, y `amobla_reserve_demo_generation` rechaza
  inmobiliarias que ya tienen dueño (`AGENCY_HAS_ACCOUNT`).
- Las notas comerciales del equipo (`agencies.notes` y `contact_name`) no se
  exponen nunca. Quedan fuera de las columnas legibles por RLS y se vacían en
  la respuesta del editor para los miembros.
- Las rutas de demos eran solo para el admin. Ahora usan `requireDemoAccess`:
  el admin, o un miembro de la inmobiliaria de esa propiedad. Para cualquier
  otro la propiedad no existe (404), y se lo rechaza antes de leer la propiedad.

## 2. Modelo de datos (migración `202610280001_agency_accounts.sql`)

Es aditiva e idempotente: no borra demos, fotos ni generaciones.

- `agencies`: se agregan `slug` (único), `owner_id` (la cuenta cuyos créditos pagan),
  `claimed_at` y `site_published`.
- `agency_members(agency_id, user_id, role owner|collaborator)`, con una
  inmobiliaria por cuenta por ahora.
- `demo_properties.origin` (`admin` | `agency`), con un índice por `(agency_id, listing_url)`
  para deduplicar.
- `property_imports`: cada importación con su estado (`completed`, `failed` o
  `duplicate`), su error y su fuente. Permite reintentar y medir.
- `agency_claims`: códigos de un solo uso, guardados como hash, que vencen a los 30 días.
- RPCs, solo para `service_role`:
  - `habita_create_agency`: crea la inmobiliaria con su dueño.
  - `habita_claim_agency`: traspasa una inmobiliaria del equipo con un código válido.
    Sus fotos y ambientaciones pasan al dueño y se limpia el grant de demo.
  - `habita_free_slug`.
- RLS: los miembros pueden leer solo las filas de su inmobiliaria (`habita_is_member`).
  Las escrituras siguen siendo exclusivas del servidor.

Créditos: hay un saldo por inmobiliaria, que es el del dueño. Un colaborador
ambienta con los créditos del dueño y el servidor verifica que pertenezca a
esa inmobiliaria.

## 3. Rutas

| Ruta | Qué es |
| --- | --- |
| `/panel` | Inicio: importar por URL, métricas, importaciones fallidas, últimas propiedades |
| `/panel/propiedades` | Listado con búsqueda y filtros; acciones ver, editar, IA, compartir, publicar y eliminar |
| `/panel/propiedades/[id]` | Editor (modo inmobiliaria): fotos, estilos, generación con créditos, comparar, versiones, descargar |
| `/panel/propiedades/[id]/vista-previa` | La ficha tal como la ve el público, incluso en borrador |
| `/panel/creditos` | Saldo, consumo y compra (misma tienda, `/precios`) |
| `/panel/sitio` | Nombre, dirección, WhatsApp, color, logo y publicar el sitio |
| `/panel/empezar` | Alta: crear la inmobiliaria o reclamar demos con código; desde una demo, importar su publicación |
| `/inmobiliaria/[slug]` | Catálogo público: marca, búsqueda, filtros, WhatsApp, aclaración IA |
| `/inmobiliaria/[slug]/[token]` | Ficha individual dentro del sitio |
| `/api/panel` | Resumen (GET), crear inmobiliaria (POST), sitio (PATCH, solo el dueño) |
| `/api/panel/importar` | Vista previa (`preview: true`) o creación con correcciones y fotos elegidas |
| `/api/panel/reclamar` | Reclamo con código |
| `/api/admin/demos/[id]/reclamo` | El equipo crea el enlace de reclamo |

## 4. Flujos

**Importación por URL.** Se valida la URL y se lee la página con el extractor
existente, que solo accede a direcciones públicas y tiene límite de tamaño y de
tiempo. La vista previa es editable (título, ubicación, operación, precio y
descripción) y permite elegir qué fotos se conservan. Si la propiedad ya existe
en la inmobiliaria se avisa (409) y se registra como duplicada. La propiedad se
crea en borrador y las fotos se importan una por una. No se genera nada ni se
usan créditos. Las fallas quedan en `property_imports` y se pueden reintentar
desde el inicio.

**Generación.** Desde la propiedad se eligen fotos y estilos. Antes de empezar,
el panel calcula los créditos que se usarán (1 por cada foto todavía no
ambientada) y pide confirmación. Si no hay saldo, no genera y manda a
«Créditos IA». Usa `amobla_reserve_batch` con la cuenta del dueño, con los
mismos límites, idempotencia y reembolso. Las versiones gratuitas con marca de
agua no se ofrecen en propiedades porque no se pueden publicar. La foto original
nunca se sobrescribe.

**Demo → inmobiliaria.** En el enlace de presentación (`?presentacion=1`) de una
inmobiliaria sin cuenta aparece «¿Te imaginás todas tus propiedades así?». Nunca
aparece para compradores ni para inmobiliarias que ya tienen cuenta. El CTA lleva
a `/panel/empezar?demo=<token>`; el registro conserva el contexto (`next`), el
nombre se precarga y se ofrece importar la publicación original, que es un dato
público. **Abrir una demo nunca alcanza para llevársela.** Las demos del equipo,
con sus ambientaciones, pasan a la cuenta solo con el enlace de un solo uso que
el equipo crea desde el editor y le envía a la inmobiliaria.

## 5. Analítica (PostHog)

El catálogo completo (CTAs, slider, estilos, galería, registro, activación,
atribución, tráfico interno y dashboards) está en
[ANALITICA_DEMOS.md](ANALITICA_DEMOS.md). Ojo: `agency_signup_started` marca la
pantalla de registro **vista**; el inicio real es `signup_form_started`.

Eventos:

- `agency_signup_started` y `agency_created` (con `agency_claimed` para el reclamo).
  `agency_signup_started` sale tanto del formulario sin código como del de invitación
  (`origin` = `demo_invitation` o `invitation`).
- `property_import_started`, `property_import_completed` y `property_import_failed`
  (con `source` = dominio y `mode` = single o batch).
- `property_ai_generation_started` y `property_ai_generation_completed` (con fotos,
  versiones y créditos).
- `property_published` y `property_shared` (con canal).
- `agency_website_viewed`.
- `demo_agency_cta_clicked` y `demo_to_agency_signup_completed`.

Los eventos no llevan emails, teléfonos ni URLs completas: solo IDs, dominios y
conteos. Los de la demo suman el título de la demo y el nombre de la inmobiliaria, que
ya son públicos en esa página. El `demo_id`, `demo_titulo` y `demo_inmobiliaria`
quedan registrados como super propiedades al ver una demo.

Embudo: demo vista → `demo_agency_cta_clicked` → `agency_signup_started` →
`agency_created` → `property_import_completed` → `property_ai_generation_completed`
→ `property_published` → `compra_confirmada`.

## 6. Importación masiva (preparada, no implementada del todo)

Lo que ya existe es una interfaz preliminar: «Tengo varias URLs». Acepta hasta 10
enlaces, los lee de a uno con el extractor individual y muestra el resultado
(lista, duplicada o con error) para elegir cuáles importar como borradores. Los
procesa en serie desde el navegador, sin generar imágenes ni usar créditos.

Para importar entre 100 y 300 propiedades por inmobiliaria haría falta:

1. **Trabajos en el servidor.** Una tabla `import_jobs` (agencia, fuente, estado
   `queued|running|review|done|failed`, total, procesadas, errores) y sus
   `import_job_items` (url, estado, `data` jsonb con la vista previa,
   `property_id`, error, intentos). La lógica por ítem es la misma de
   `/api/panel/importar` con `preview: true`. Al confirmar, se crean las
   propiedades marcadas reutilizando la creación actual. Las fallas reintentan
   con backoff, hasta 3 veces.
2. **Ejecución.** Un worker o cron (como `/api/cron`) que tome ítems con `for update
   skip locked`. Concurrencia de 2 a 3 por dominio y no más de 1 pedido por
   segundo a cada sitio, respetando robots.txt. Las fotos se descargan en lotes
   de 5. Tiempo estimado: unos 5 a 10 minutos cada 300 fichas.
3. **Descubrir URLs.** Para no construir un crawler universal, usar conectores
   por fuente autorizada:
   - el sitemap del sitio de la inmobiliaria;
   - la API o el XML de Tokko Broker, que muchas inmobiliarias ya tienen y pueden
     autorizar con su clave;
   - exportaciones CSV de portales.
   Siempre con autorización explícita de la inmobiliaria sobre sus propias publicaciones.
4. **Deduplicación y actualización.** Por `(agency_id, listing_url)` y, en Tokko,
   por el código de referencia. La reimportación de una ficha existente reutiliza
   `planImport` / `applyImport`: completa lo vacío y nunca pisa ediciones manuales
   sin confirmación.
5. **Costos.** La extracción es HTML (hasta 3 MB) más las fotos (hasta 15 MB cada
   una, normalizadas a JPG de 2048 px). Con 300 propiedades y 20 fotos cada una son
   alrededor de 6.000 fotos y 2 a 3 GB de almacenamiento. Supera el presupuesto
   actual (`USER_STORAGE_LIMIT` de 320 MB por cuenta), así que el almacenamiento
   tiene que crecer o las fotos se importan bajo demanda (por ejemplo, solo la
   portada hasta que se edite la propiedad). No hay costo de IA, porque no se
   genera nada automáticamente.

## 7. Despliegue

1. **Aplicar la migración** `supabase/migrations/202610280001_agency_accounts.sql`
   en el SQL Editor de Supabase, después de las anteriores. Es aditiva e
   idempotente.
   - Antes de aplicarla, las demos del equipo siguen funcionando: los permisos
     toleran que falten las columnas nuevas.
   - El panel de inmobiliarias y los sitios necesitan la migración.
2. **Desplegar la rama.** Vercel lo hace al mergear en `main`. No hay variables nuevas.
3. **Probar con una cuenta de prueba:**
   1. `/panel/empezar` → crear la inmobiliaria.
   2. Importar una URL.
   3. Ambientar una foto con créditos.
   4. Publicar la propiedad.
   5. Publicar el sitio y abrir `/inmobiliaria/<slug>`.
4. **Probar el reclamo.** Desde el editor de una demo del equipo, «Crear enlace para que
   la inmobiliaria se quede con sus demos» → abrir el enlace con otra cuenta.
   Al terminar, en `/admin/inmobiliarias/<id>` → Invitaciones → «Liberar cuenta»
   (`habita_release_agency`, migración `202611150001_agency_release.sql`): la
   inmobiliaria vuelve a quedar sin cuenta, las fotos de las demos vuelven al equipo,
   se borran las propiedades que creó la cuenta de prueba y los créditos de regalo
   sin usar quedan reservados otra vez. Las invitaciones sin usar vuelven a
   funcionar. Se rechaza si la cuenta compró créditos.

## 8. Pendiente

- Prueba de punta a punta contra Supabase y OpenAI reales. Este entorno no tiene
  credenciales: los flujos se verificaron con tests (PGlite para SQL y RLS,
  rutas con base simulada) y con Playwright usando las APIs interceptadas.
- Créditos de prueba para inmobiliarias nuevas. Hoy generar requiere saldo pago.
  Regalar créditos al crear la cuenta es una decisión comercial.
- ~~Invitar colaboradores~~: hecho en la sección 15 (Usuarios del panel).
- Que los sitios se indexen en buscadores. Hoy son `noindex`, para no competir con el
  sitio propio de la inmobiliaria. También quedan pendientes los dominios propios, el
  constructor visual y el CRM: la estructura de `agencies`/`slug`/`site_published`
  ya lo contempla.
- Importación masiva del lado del servidor (sección 6).

## 9. Correcciones del panel (2026-10-27)

### 9.1 Mapas: diagnóstico

Al crear fichas desde una URL, el mapa se perdía o quedaba mal por cinco motivos,
reproducidos con la página real de Russillo y con casos sintéticos:

1. El lector buscaba solo `L.marker([lat, lng])`. Russillo publica
   `L.circle([lat, lng], {radius: 400})`: se tomaba el centro, pero el radio se
   descartaba y la ficha mostraba otra área.
2. Coordenadas en JSON-LD (`geo`), en `data-lat`/`data-lng`, en `google.maps.LatLng`,
   en objetos `{lat, lng}` o en enlaces e iframes de mapas no se leían.
3. La primera coordenada de la página ganaba aunque fuera la de la oficina (pie de
   página, sección «Sucursales», `Organization` del JSON-LD) o la de una propiedad
   relacionada.
4. El mapa detectado se guardaba aunque hubiera dos ubicaciones distintas, sin
   avisar.
5. En el panel de inmobiliarias, el mapa elegido en la vista previa no llegaba a
   la ficha creada.

### 9.2 Cómo se detecta ahora (`src/lib/demos/geo.ts`)

- **Formatos leídos:** JSON-LD (`geo` de la propiedad, no del vendedor o la oficina),
  `meta` `place:location` / `geo.position`, Leaflet `L.circle` (con su radio),
  `L.marker` / `circleMarker` / `L.latLng`, `setView` / `flyTo` / `center` (solo como
  vista, de baja confianza), `google.maps.LatLng`, objetos `{lat, lng}` en cualquier
  orden, atributos `data-lat`/`data-lng` y enlaces o iframes de Google Maps
  (`?q=`, `ll=`, `/place/lat,lng`, `!3d!4d`, `@lat,lng,zoom`, `embed pb`),
  OpenStreetMap (`mlat/mlon`, `#map=`, `bbox`), Waze, Apple Maps, Bing y `geo:`.
- **Contexto:** se descarta lo que está en el pie, en secciones de oficina o
  sucursal y después del final de la ficha (relacionadas). Los candidatos a menos
  de 300 m se agrupan; varias fuentes que coinciden suben la confianza.
- **Resultado:** «Mapa detectado» (se guarda), «Requiere revisión» (dos lugares
  parecidos o solo una vista del mapa: se muestra pero no se guarda sin elegir) o
  «No encontrado».
- **Precisión:** nunca se marca «Exacta» sola. Un círculo de más de 600 m o una
  vista del mapa es «Zona»; lo demás, «Aproximada».
- **Límites:** solo se lee el HTML que entrega el servidor (sin ejecutar
  JavaScript remoto ni `eval`). Los mapas que se cargan después por API o en un
  iframe de otro sitio sin coordenadas en el enlace no se ven: la vista previa lo
  dice y pide el enlace. Los enlaces cortos (`maps.app.goo.gl`, `goo.gl/maps`) no
  se siguen, para no abrir conexiones nuevas: hay que abrirlos y pegar el enlace
  largo o las coordenadas. No hay geocodificación de direcciones ni credenciales
  nuevas. Se mantienen las protecciones de lectura (direcciones públicas,
  redirecciones, tamaño y TLS).

### 9.3 Guías cortas

**Importar y corregir un mapa.** Pegá la URL y tocá «Importar propiedad». En la
vista previa, el bloque **Mapa** dice el estado. Si «Requiere revisión», abrí
«ver en el mapa» de cada opción y elegí la de la propiedad. Si «No encontrado», elegí
«Cargar otra ubicación» y pegá el enlace de Google Maps, OpenStreetMap, Waze o Apple
Maps (o la latitud y la longitud; acepta coma decimal). En «Qué mostrar» elegí
Zona, Aproximada o Exacta. Después se puede cambiar en la ficha: Datos → Mapa.

**Recuperar una importación parcial.** En Inicio, «Importaciones pendientes» muestra
«Importada parcialmente: X de Y fotos». «Reintentar N fotos» descarga solo las
que faltan. Si faltan los datos, «Completar datos» abre la ficha con «Volver a leer
la publicación». Una fallida se reintenta con «Reintentar». Confirmar dos veces la
misma importación crea una sola propiedad, y dos importaciones simultáneas de la
misma URL se rechazan.

**Publicar y compartir con catálogo privado.** «Publicar ficha» hace visible esa
propiedad en su enlace propio (`/demo/<token>`) aunque el catálogo no esté
publicado. «Publicar catálogo» (Mi sitio web) publica `/inmobiliaria/<slug>`; desde
ahí, el enlace para compartir pasa a ser el del catálogo. Si el catálogo es privado,
«Vista previa de mi sitio» lo muestra solo a tu equipo. Cambiar la dirección del
catálogo avisa que los enlaces viejos del catálogo dejan de funcionar; los de
`/demo/` siguen andando.

**Saldo y permisos.** La inmobiliaria tiene un solo saldo: el de la cuenta del dueño,
que paga todas las ambientaciones. Los colaboradores ven ese saldo y quién paga,
nunca su saldo personal, y no ven planes ni historial. Antes de ambientar, el panel
muestra cuántas fotos usan crédito y cuántas son versiones gratis (foto ya pagada
con cobertura vigente). Si el saldo no se puede leer, se muestra «No disponible», no 0.

### 9.4 Migración `202610290001_panel_reliability.sql`

Es aditiva e idempotente y va **después** de `202610280001_agency_accounts.sql`.
Agrega el estado `partial` y las columnas de seguimiento en `property_imports`
(fotos totales, hechas y pendientes, datos guardados, clave de pedido, huella de la
vista previa), un índice único que impide dos importaciones simultáneas de la misma
URL, `agency_claims.revoked_at`, la nueva `habita_claim_agency` (rechaza invitaciones
revocadas), `habita_agency_counts` y `habita_admin_agencies`. Las funciones son solo
para `service_role`.

1. En un proyecto de prueba (no en producción): abrí el SQL Editor y ejecutá el
   archivo completo.
2. Verificá: `select habita_agency_counts('<id de una inmobiliaria>');` y
   `select * from habita_admin_agencies(null, 5, 0);`.
3. Si volvés a ejecutar `202610280001`, ejecutá después `202610290001` otra vez:
   la primera redefine `habita_claim_agency` sin el control de revocación.
4. Sin esta migración, el panel muestra error con «Reintentar» (no un panel vacío) y
   la importación responde error, porque necesita las columnas nuevas.

### 9.5 Vista del equipo

`/admin/inmobiliarias` lista las inmobiliarias con su etapa, calculada a partir
de los datos: Sin cuenta, Invitación pendiente, Cuenta reclamada y Primera propiedad
publicada. También muestra las importaciones parciales o fallidas y las
ambientaciones en revisión. Tiene búsqueda y paginación con el total real. El
detalle es de solo lectura, salvo las invitaciones: crear un enlace (vence a los 30
días y sirve una vez) y revocar uno pendiente; las dos acciones quedan en
`admin_audit`. No se implementó la vista de soporte como cliente.

### 9.6 Sin validar en este entorno

- Supabase real: la migración se probó con PGlite (todas las migraciones en orden,
  RLS, conteos de más de 300, concurrencia, revocación), pero no se aplicó en
  ningún proyecto.
- Las URLs reales de otros portales (Zonaprop, Argenprop, MercadoLibre, sitios con
  Tokko o Properati). Hace falta una URL de cada uno para confirmar qué formato de
  mapa publican. Russillo se verificó con su HTML real guardado.
- Compartir nativo en teléfonos reales: se probó con `navigator.share` simulado
  (aceptado, cancelado, no permitido) y con el portapapeles rechazado.

## 10. Invitación por WhatsApp y créditos de regalo (2026-10-27)

### 10.1 Invitar a una inmobiliaria a su panel

En `/admin/demos`, cada demo de una inmobiliaria sin cuenta tiene **Invitar a su
panel**. El botón crea un enlace personal (sirve una vez y vence a los 30 días) y
abre WhatsApp con el mensaje listo; también se puede copiar el enlace. Al abrirlo,
la inmobiliaria solo carga **email y contraseña** y entra directo a su panel con
sus demos, fotos y ambientaciones. Si el email ya tiene cuenta, entra con su
contraseña (o con Google) y las demos pasan a esa cuenta.

- El enlace es la prueba de la invitación: la cuenta nueva se crea ya verificada,
  sin el email de confirmación. Por eso el enlace es de un solo uso y se puede
  revocar desde `/admin/inmobiliarias/<id>`.
- Si el traspaso falla, la cuenta recién creada se borra: no quedan cuentas a medias.
- Requisitos en Supabase: **Authentication → Providers → Email** habilitado (el
  ingreso con contraseña lo usa). Si está activa la verificación anti-bots
  (Turnstile), el formulario la muestra.

### 10.2 Créditos de regalo

En `/admin/inmobiliarias/<id>`, **Créditos de regalo**: cantidad (1 a 1000) y motivo.

- Con cuenta: se suman al saldo de la inmobiliaria (la cuenta del dueño).
- Sin cuenta: quedan reservados y pasan a su saldo cuando acepta la invitación.
  La invitación lo dice («Incluye N créditos de regalo»).
- Todo queda en `credit_ledger` y en `admin_audit` con el motivo.
- **Bienvenida:** toda inmobiliaria nueva arranca con 10 créditos. Si la prepara
  el equipo, quedan reservados hasta que acepta la invitación; si se crea desde el
  panel, van directo a la cuenta del dueño. Las que ya existían no cambian.
  Migración `202611050001_welcome_agency_credits.sql` (va después de
  `202611040001`; idempotente). Verificación:
  `select column_default from information_schema.columns where table_name='agencies' and column_name='free_credits_pending';` → `10`.

### 10.3 Migración `202610300001_agency_free_credits.sql`

Es aditiva e idempotente y va después de `202610290001`. No redefine ninguna función
anterior. Agrega `agencies.free_credits_pending`, `habita_agency_credit` y
`habita_apply_agency_credits` (solo para `service_role`). Se aplica igual que las
anteriores: en el SQL Editor, pegar el archivo completo y ejecutar **Run**.
Verificación: `select free_credits_pending from agencies limit 1;`.
Sin esta migración, la sección de créditos avisa que falta y no deja regalar.

### 10.4 Apertura con ambientación

«Ambientación predeterminada» se puede elegir cuando al menos una foto visible tiene
un estilo listo (antes solo se miraba la primera foto). Las fotos con ese estilo
abren comparadas; las demás, con la original.

## 11. Editor foto a foto, espacios y administración por inmobiliarias (2026-10-27)

### 11.1 Qué cambió

- **Editor de la propiedad** (el mismo para `/admin/demos/[id]` y `/panel/propiedades/[id]`).
  - «Fotos y espacios» está abierta por defecto. «Datos», «Ubicación y mapa», «Características y condiciones», «Marca y contacto» y «Publicación y compartir» están plegadas y su encabezado muestra un resumen real.
  - Plegar no guarda, no borra y no detiene nada. Un enlace con `?seccion=…` o `#…` abre esa sección y le pone el foco. `?volver=` acepta solo rutas locales de `/panel` o `/admin`.
- **Tarjeta por foto.** La imagen grande va a la izquierda, con botones Original / Versión / Comparar, y el panel a la derecha (abajo en el celular).
  - Cada estilo muestra su estado real: Sin crear, Pendiente en esta pestaña, En cola en el servidor, Generando, Creada, Falló o En revisión técnica.
  - Las acciones de cada estilo son Crear, Ver, Descargar, Reintentar o Descartar y crear otra.
  - «Incluir en lote», «Se muestra / Oculta» y «Usar de portada» son controles separados. Sacar una foto del lote nunca oculta sus versiones.
  - El historial (ver, descargar, mostrar esta, descartar, recuperar) está en «Más».
- **Lote.** Es una barra compacta con los estilos, las fotos incluidas y las versiones faltantes. «Crear versiones faltantes» no rehace lo creado ni reenvía lo que está en revisión técnica.
  - El lote y la creación individual usan un solo controlador: cotización del servidor, una confirmación y una versión por vez.
  - El doble clic se ignora desde antes de cotizar. Si un pedido se queda sin respuesta, reintentarlo usa la misma clave (no se reserva dos veces). «Crear otra versión» es un intento nuevo.
  - La cola de lo que todavía no se envió vive en la pestaña: si se cierra, solo sigue la versión que ya estaba en el servidor, y al volver se la sigue sin generarla de nuevo.
- **Quién paga.** La cotización, la reserva y el editor aplican la misma regla (`stagingRule`). El equipo crea gratis las demos de inmobiliarias sin cuenta. Una inmobiliaria con cuenta paga con el saldo del dueño. El equipo nunca gasta ese saldo desde administración, salvo que sea el dueño, y la interfaz dice por qué.
- **Descarga directa.** Es el JPEG guardado (hasta 2048 px), con nombre «propiedad - espacio - estilo». No usa créditos ni exige saldo, publicar o regenerar. Mantiene la autorización (equipo o miembros de esa inmobiliaria) y nunca expone Storage.
- **Espacios.** Se pueden crear, renombrar, cambiar de tipo, ordenar y eliminar (las fotos pasan a otro espacio o a «Sin organizar»). Las fotos se suben directo a un espacio y se mueven de a una o varias juntas («Organizar varias fotos»).
  - Las fotos anteriores quedan en «Sin organizar». Mover una foto no copia proyectos ni consume créditos.
  - Si el tipo del espacio y el ambiente con que se crea la foto no coinciden, se avisa y se ofrece corregirlo, pero no se cambia solo.
- **Mis propiedades.** Cada tarjeta o fila muestra la portada, la referencia, los espacios, las versiones listas, en curso y con problemas (de datos reales) y la próxima acción útil, que lleva directo a la sección correspondiente.
  - Al volver se conservan los filtros, la página y la vista.
  - Las respuestas atrasadas se descartan (petición versionada y cancelada). Mientras hay versiones en curso, la lista se refresca sola.
- **Administración.** `/admin` lleva a `/admin/inmobiliarias`, y Demos sigue disponible como vista secundaria.
  - Cada inmobiliaria muestra su etapa: Sin cuenta, Invitación creada sin aceptar, Cuenta reclamada, Cuenta creada por la inmobiliaria o Primera propiedad publicada.
  - También muestra sus propiedades (publicadas y en borrador), el saldo disponible y los créditos reservados por separado. Un saldo desconocido se muestra como «No disponible», nunca como 0.
  - «Ver propiedades» abre una lista paginada (10 por página, sin descargar fotos ni versiones). La fila abierta y la página quedan en la URL.
  - «Agregar propiedad» abre `/admin/demos/nueva?inmobiliaria=<id>`, y el servidor valida esa inmobiliaria.
  - «Agregar créditos» abre un único diálogo reutilizable.

### 11.2 Migración `202610310001_property_spaces.sql`

Es aditiva e idempotente y va después de `202610300001`. No redefine funciones anteriores. Agrega:

- `property_spaces`, con lectura solo para miembros, y `demo_photos.space_id`, opcional, con una clave foránea compuesta: una foto solo puede estar en un espacio de su propia propiedad. Borrar un espacio deja sus fotos sin espacio.
- `agency_credit_requests` y `habita_agency_credit_once`: una clave por pedido, así que el doble clic, el reintento y otra pestaña acreditan una sola vez. Reusar la clave con otra cantidad se rechaza.
- `habita_admin_agency_balances`: el saldo disponible y el reservado de una página de inmobiliarias.

Pasos en local o staging (no en producción sin revisar):

1. En el SQL Editor del proyecto de prueba, pegar el archivo completo y ejecutar **Run**.
2. Verificar que existan la tabla y la columna nuevas:
   ```sql
   select count(*) from information_schema.columns
   where table_name = 'demo_photos' and column_name = 'space_id';
   ```
   y que la función de saldos responda:
   ```sql
   select * from habita_admin_agency_balances(array(select id from agencies limit 3));
   ```
3. Sin esta migración, el editor funciona igual: todas las fotos quedan en «Sin organizar» y se avisa que falta la migración. Lo que no funciona es crear espacios y regalar créditos (se avisa y no se acredita nada).

### 11.3 Guía breve por rol

**Inmobiliaria (dueño o colaborador)**
1. En «Mis propiedades», usá el botón de la tarjeta (próxima acción) o tocá la foto para entrar a «Fotos y espacios».
2. Creá los espacios reales (Living, Dormitorio principal, Dormitorio 2…) y movés las fotos con el selector «Espacio» de cada una, o varias juntas con «Organizar varias fotos».
3. En cada foto, tocá «Crear» en el estilo que quieras. Se muestra el costo antes de empezar. Lo creado se ve, se compara y se descarga desde la misma tarjeta, también mientras se crea otra.
4. Para varias fotos: marcá «Incluir en lote», elegí los estilos y tocá «Crear N versiones faltantes».
5. Completá las secciones plegadas y publicá desde el encabezado. La marca y el canal de consultas los edita el dueño en «Mi sitio web».

**Equipo de habita**
1. `/admin` abre Inmobiliarias. Buscá, abrí «Ver propiedades» y entrá a «Editar fotos» o «Abrir ficha». Al volver, la fila sigue abierta.
2. «Agregar propiedad» crea dentro de esa inmobiliaria.
3. «Agregar créditos»: cantidad y motivo, con confirmación. Si la inmobiliaria tiene cuenta, los créditos van al saldo del dueño; si no, quedan reservados hasta que acepte la invitación. Es un regalo o ajuste auditado, no una venta.
4. En el detalle, «Aplicar ahora» dice cuántos créditos se movieron, si no había nada pendiente o que falló. Un fallo nunca se muestra como 0.
5. En una inmobiliaria con cuenta, el editor permite ver y descargar, pero no crear: las versiones se crean desde su panel, con sus créditos.

### 11.4 Límites y pendientes

- Agrupar fotos en un espacio no hace que los muebles coincidan entre ángulos: cada foto se crea por separado y no hay generación multivista.
- «Revisada» no se inventa: no hay una aprobación persistida por versión. Existen «Se muestra» (la versión elegida para ese estilo), «Oculta» (la foto) y «Publicada» (la ficha). Cerrar la vista ampliada no guarda nada.
- La cola pendiente no sobrevive a cerrar la pestaña. Solo se persiste el trabajo que ya está en el servidor.
- No se validó contra Supabase ni OpenAI reales: se usaron tests con PGlite (SQL, RLS, idempotencia), tests de rutas con base simulada y Playwright con las APIs interceptadas. No se generaron imágenes ni se otorgaron créditos reales.

## 12. Vista de soporte (ver el panel como una inmobiliaria)

En `/admin/inmobiliarias`, cada inmobiliaria tiene **Ver su panel**. Abre `/panel` tal como lo ve su dueño (propiedades, créditos, sitio y editor), con un banner que lo indica y un botón para salir.

- No se inicia sesión con la cuenta de la inmobiliaria. Una cookie firmada (`habita_soporte`) nombra al miembro del equipo y a la inmobiliaria y vence en una hora. Solo vale para esa persona del equipo: otra cuenta con la misma cookie ve su propio panel.
- Es **solo lectura**: el servidor rechaza todo cambio hecho desde el panel mientras dure la vista, incluido crear versiones con IA, que además nunca usan el saldo de la inmobiliaria.
- Entrar y salir quedan registrados en `admin_audit` (`agency_support_view`, `agency_support_end`). Si no se puede registrar, la vista no se abre.

### 12.1 Entrar como la inmobiliaria (2026-10-30)

Junto a **Ver como cliente** está **Entrar como la inmobiliaria** (en la lista y en la ficha de cada inmobiliaria). Pide confirmación y abre su panel con los **permisos de su dueño**, para probar todo como lo haría ella:

- Los cambios son reales: sitio, marca, propiedades, publicar, importar, usuarios. Las ambientaciones se cobran con los créditos de la inmobiliaria, como desde su propio panel.
- No compra créditos: el botón se oculta, porque una compra quedaría en la cuenta del miembro del equipo.
- Misma cookie firmada, con el modo dentro de la firma (una vista de solo lectura no se puede convertir en este modo). Vence en una hora y vale solo para esa inmobiliaria: las propiedades de otras siguen con las reglas del equipo.
- Banner naranja en todas las páginas del panel, con **Salir de la inmobiliaria**. Entrar y salir quedan en `admin_audit` (`agency_support_act`, `agency_support_act_end`); lo que se crea queda a nombre del miembro del equipo.

## 13. Importar imágenes (grupos de fotos sin ficha, 2026-10-28)

Entrada nueva en el inicio, al lado de «Crear demostraciones». Trae fotos desde
un enlace, varios enlaces o archivos del dispositivo, las elige por origen e
importa sin crear ni publicar una ficha. Importar no genera imágenes ni usa
créditos.

**Modelo.** Migración aditiva `202611040001_photo_groups.sql`: `demos.kind`
(`ficha` | `fotos`, por defecto `ficha`). Un grupo de fotos es una fila de
`demos` con `kind = 'fotos'` y su propiedad. Así las fotos, las versiones, las
descargas y el editor (`/panel/propiedades/[id]`) siguen funcionando igual.
Además:

- No aparece en «Mis propiedades» ni cuenta en los totales del inicio
  (`agencyProperties` filtra `kind`; `habita_agency_counts` se reemplazó para contar solo fichas).
- No se puede publicar: `publicacion` responde 409 hasta que se crea la ficha.
- «Crear ficha con estas fotos» solo cambia `kind` a `ficha` (queda en borrador).
  Las fotos, las versiones y el enlace se conservan; no se publica nada.

**Rutas nuevas** (todas con `requireAgency`):

| Ruta | Qué hace |
| --- | --- |
| `GET /api/panel/imagenes` | Grupos de fotos sin ficha, con conteos reales |
| `POST /api/panel/imagenes` | Importa las fotos elegidas de un enlace (`url`, `key`, `images`). Idempotente por `key`; un enlace ya cargado responde 409 con `duplicateOf` |
| `POST /api/panel/imagenes/grupo` | Crea un grupo vacío para archivos subidos (`name`) |
| `POST /api/panel/imagenes/[id]/ficha` | Convierte el grupo en ficha (borrador) |

Lectura de enlaces, descarga de fotos y reporte (`PATCH /api/panel/importar`) son
los mismos que usa la importación de propiedades: el navegador descarga, el
servidor registra qué faltó en `property_imports`.

**Pantalla.** `/panel/imagenes?metodo=url|many|files` con tres pestañas (el
estado se conserva al cambiar), lectura por enlace con su estado real
(en espera, leyendo, lista, duplicada, con error), selección por origen y
«Importar N fotos». Un enlace con error se puede reintentar sin bloquear a los
demás. Los archivos se validan con `src/lib/photo-limits.ts` (JPG, PNG o WebP,
hasta 3 MB, el mismo límite que el servidor).

**Bandeja de fotos importadas** (`/panel/imagenes/lote?grupo=<id>`, componente
`agency-batch.tsx`, reglas en `src/lib/agency/batch-plan.ts`):

- Grupos a la izquierda (selector compacto en móvil), fotos al centro con
  «Elegir para ambientar» y su ambiente, y «Aplicar a las elegidas» a la derecha
  (acción y estilo del catálogo). «Sumar fotos» agrega archivos a un grupo.
- El ambiente nunca se adivina: `demo_photos.room` vale `living` por defecto, así
  que la bandeja solo da por conocido el ambiente de la última versión creada. Si
  no hay, muestra «Sin asignar» y no deja continuar hasta elegirlo o quitar la foto.
- Un estilo que no corresponde al tipo de inmueble de un grupo, o un grupo que
  esta cuenta no puede ambientar (`staging.blocked`, la regla del editor), queda
  afuera y se dice por qué. Las versiones que existen, están en curso o en
  revisión técnica no se vuelven a crear.
- «Revisar y generar» pide `/costo` a cada grupo y suma los créditos contra el
  único saldo que los paga: dos grupos que entran por separado pueden no entrar
  juntos. Un saldo desconocido bloquea; nunca se lee como cero ni como suficiente.
- La generación usa la misma ruta por foto, de a una versión, con su clave de
  idempotencia. Sin respuesta: «Sin respuesta», no se reenvía sola y su reintento
  usa la misma clave. Respuestas 401/402/403/409/429/503 detienen el resto
  («Sin enviar»). Nunca dice que está todo listo si algo falló.
- La selección, los ambientes y la posición se guardan en `sessionStorage`:
  sobreviven a ir al editor y volver («Volver al lote» usa `?volver=`), pero no a
  cerrar la pestaña. La página lo dice y avisa antes de salir con versiones sin enviar.

**Editor con un grupo:** muestra «Fotos sin ficha», usa «Versión seleccionada» en
lugar de «Se muestra en la ficha», oculta «Usar de portada», «Vista previa» y
«Publicar», y ofrece «Crear ficha con estas fotos».

**Límites conocidos:**

- No se guarda una tanda para seguir después («Guardar y seguir después» quedó
  fuera, como permite el pedido): eso requiere persistencia nueva.
- Reintento de archivos subidos: si la respuesta se pierde después de guardar,
  el reintento puede duplicar esa foto (la subida no deduplica por contenido).
- En `/admin` (vista del equipo) los grupos aparecen como borradores; no se filtraron.
- Validado con un arnés de Vite y Playwright con respuestas simuladas, no contra
  Supabase ni generaciones reales.

## 14. De la demo a probar el panel (2026-10-28)

La demo pasa a ser la entrada a un panel que ya tiene esa misma propiedad
preparada, con la invitación privada que ya existía.

**Recorrido:** demo → «Probar esta propiedad en mi panel» → crear acceso o
ingresar → editor de esa propiedad.

- **El enlace.** «Crear enlace para que la inmobiliaria se quede con sus demos»
  (editor de la demo, equipo) devuelve además `presentationUrl`:
  `/demo/<token>?presentacion=1&codigo=<código>`, junto con un mensaje sugerido
  para enviar. Es el mismo código de un solo uso, que vence a los 30 días.
- **La demo.** Solo en modo presentación y para una inmobiliaria sin cuenta, el
  servidor valida el código (`invitationOf`). Si es vigente y de esa misma
  inmobiliaria, aparece «Probá con esta misma propiedad» debajo del selector de
  estilos y al final, con el mismo texto y destino (`src/lib/agency/demo-invite.ts`).
  Si venció o es de otra inmobiliaria, se dice que no está disponible. Sin código
  queda el llamado anterior. El enlace para compradores no muestra nada de esto y
  no da acceso.
- **El acceso** (`/panel/empezar?codigo=…&demo=…`): «Tu propiedad está preparada»,
  con la propiedad y su antes/después, y el formulario corto de siempre (email y
  contraseña, o ingresar con la cuenta). No pide datos comerciales. Quien ya
  trabaja en esa inmobiliaria entra directo al editor.
- **La llegada:** el editor de esa propiedad con `?bienvenida=1`: «Empezá con una
  foto» y «¿Querés probar con otra propiedad?» con el importador de siempre.
- **Créditos de bienvenida:** no se asignan solos. El equipo los carga con
  «Agregar créditos» y se mencionan solo cuando están asignados.

**Embudo** (PostHog): vista de la demo (`demo_vista`, versión `presentacion`) →
`demo_agency_cta_clicked` (`origen`: `demo_invitacion_lateral` o
`demo_invitacion_final`) → `agency_claimed` (`origin`: `demo_invitation`) →
`invited_property_opened` → `property_version_downloaded` →
`property_ai_generation_completed` → `invited_next_property_clicked` y
`property_import_completed`.

**El código no sale a terceros.** Antes, el enlace de invitación cargaba el píxel
de Meta y la etiqueta de Google Ads con la URL completa, código incluido. Ahora
el píxel no carga si la URL o la página anterior tienen `codigo=`, Google recibe
`page_location` y `page_referrer` redactados, y PostHog redacta el código en
`before_send`.

**La demo dentro del panel** (modo inmobiliaria de `src/components/demo-view.tsx`).
Con una invitación vigente, el enlace de presentación muestra la misma ficha que
ven los compradores, completa, con el panel de la inmobiliaria arriba en
«modo demostración».

- **Encabezado fijo verde:** el logo y el nombre de la inmobiliaria, Inicio,
  Mis propiedades (1), Imágenes, Créditos (con los de regalo), «Crear propiedad»
  y «Guardar mi panel». Debajo, el aviso de modo demostración y «Ver como
  comprador». En el celular las secciones se deslizan en una fila.
- **Estilos de cada foto:** arriba el original («Ver original»), después las
  versiones preparadas y el resto del catálogo; se ven 4 y «Más estilos»
  despliega los demás. Una versión preparada tiene «Descargar»; un estilo sin
  preparar aparece grisado, nunca marcado, con «Generar».
- **Sin cuenta:** se puede mirar, comparar y descargar el original y cada
  versión preparada, porque las imágenes son las públicas de la demo.
- **Lo que pide acceso:** «Generar», guardar, crear y el resto de las secciones
  llevan a la invitación, que pide el acceso y muestra el costo antes de usar
  créditos.
- **Ficha de compradores:** «Ver como comprador» (`&vista=ficha`) la muestra con
  el acceso de siempre.
- **Datos:** solo usa los datos públicos de la demo. No hay rutas ni permisos
  nuevos, y una demo pública sin código sigue sin mostrar nada de esto.

## 15. Usuarios del panel (2026-10-30)

El dueño y los administradores de una inmobiliaria crean accesos para su
equipo en **Panel → Usuarios** (`/panel/usuarios`).

**Roles** (`agency_members.role`):

| Rol | Puede |
| --- | --- |
| Dueño (`owner`) | Todo. Es la cuenta que paga y la única que compra créditos. Uno por inmobiliaria; no se cambia ni se quita desde el panel. |
| Administrador (`admin`) | Todo menos comprar créditos: propiedades, sitio web, marca, eliminar propiedades y usuarios. |
| Edición (`editor`) | Cargar, importar, editar, ambientar con IA (con los créditos de la inmobiliaria) y publicar. No elimina ni toca el sitio. |
| Solo vista (`viewer`) | Ver propiedades y compartir sus enlaces. Toda escritura responde 403. |

El antiguo `collaborator` pasa a `editor`.

**Limitar a algunas propiedades:** a un usuario de edición o solo vista se le
puede asignar una lista de propiedades (`agency_members.property_ids`, ids de
`demo_properties`). Solo ve esas en el inicio, en "Mis propiedades", en el
editor, en las imágenes y en las fotos importadas; cualquier otra responde 404.
Un usuario limitado no crea propiedades nuevas ni importa: las carga un
administrador y después se le asignan.

**Flujo:** Crear usuario (nombre, email, rol, propiedades) → el panel muestra
un enlace `/panel/unirme?codigo=…` con botones de copiar y de WhatsApp. El
enlace sirve una vez, para ese email, y vence a los 14 días; solo se guarda su
hash (`agency_invites.code_hash`), así que no se vuelve a mostrar: desde la
lista se genera uno nuevo y el anterior deja de funcionar. Quien lo abre elige
una contraseña y entra directo al panel; si ese email ya tiene cuenta, entra
con ella (o con Google) y se suma con un clic. Una cuenta trabaja con una sola
inmobiliaria. Quitar un acceso lo corta en el siguiente pedido (la membresía se
lee en cada request). Todo queda en `admin_audit`.

**Migración** `202611110001_agency_team.sql`: roles nuevos, `property_ids`,
`display_name`, `invited_by`, tabla `agency_invites` y RPC
`habita_join_agency` (solo `service_role`). Aditiva e idempotente. Hasta
aplicarla, el panel sigue funcionando y "Usuarios" avisa que falta.

**Rutas:** `GET/POST /api/panel/usuarios`, `PATCH/DELETE
/api/panel/usuarios/[id]`, `POST /api/panel/unirme`.

