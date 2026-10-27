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

Eventos:

- `agency_signup_started` y `agency_created` (con `agency_claimed` para el reclamo).
- `property_import_started`, `property_import_completed` y `property_import_failed`
  (con `source` = dominio y `mode` = single o batch).
- `property_ai_generation_started` y `property_ai_generation_completed` (con fotos,
  versiones y créditos).
- `property_published` y `property_shared` (con canal).
- `agency_website_viewed`.
- `demo_agency_cta_clicked` y `demo_to_agency_signup_completed`.

Los eventos no llevan emails, teléfonos ni URLs completas: solo IDs, dominios y
conteos. El `demo_id` ya queda registrado como super propiedad al ver una demo.

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

## 8. Pendiente

- Prueba de punta a punta contra Supabase y OpenAI reales. Este entorno no tiene
  credenciales: los flujos se verificaron con tests (PGlite para SQL y RLS,
  rutas con base simulada) y con Playwright usando las APIs interceptadas.
- Créditos de prueba para inmobiliarias nuevas. Hoy generar requiere saldo pago.
  Regalar créditos al crear la cuenta es una decisión comercial.
- Invitar colaboradores. El rol existe en el modelo, pero falta la pantalla de invitación.
- Que los sitios se indexen en buscadores. Hoy son `noindex`, para no competir con el
  sitio propio de la inmobiliaria. También quedan pendientes los dominios propios, el
  constructor visual y el CRM: la estructura de `agencies`/`slug`/`site_published`
  ya lo contempla.
- Importación masiva del lado del servidor (sección 6).
