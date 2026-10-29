# Demos comerciales para inmobiliarias

Herramienta interna para preparar, con fotos reales de una inmobiliaria, una galería ambientada con IA y compartirla por WhatsApp con un enlace único.

- Panel privado: `/admin/demos` (también enlazado desde `/administracion`).
- Página pública: `/demo/<token>`, sin registro.

## Puesta en marcha

1. **Aplicar la migración** `supabase/migrations/202610260001_commercial_demos.sql` en Supabase (SQL Editor). Se puede re-ejecutar. Crea `agencies`, `demo_properties`, `demo_photos`, `demos` y la función `amobla_reserve_demo_generation`. Aplicarla **antes** de desplegar el código: sin ella el panel y la página pública responden error, pero el resto de la app funciona igual.
1b. **Aplicar `supabase/migrations/202610270001_demo_branding.sql`** (también se puede re-ejecutar): agrega `agencies.branding` (logo, colores, tipografía, canal de contacto, enlace de visitas) y `demos.settings` (modo de apertura, franja de presentación, operación, precio, características, referencia). Sin ella, la demo funciona igual pero abre con la foto original, sin marca propia ni botón de contacto, y el panel avisa que no puede guardar esos datos.
1c. **Aplicar `supabase/migrations/202611060001_demo_activity.sql`** (también se puede re-ejecutar): agrega la actividad de cada demo (`demos.activity_*` y la tabla `demo_activity`). Sin ella, la lista muestra todas las demos «Sin actividad» y el resto funciona igual.
1d. **Aplicar `supabase/migrations/202611070001_public_staging.sql`** (también se puede re-ejecutar): generar sin cuenta desde la demo gasta los créditos de regalo de la inmobiliaria (`habita_public_staging_claim`). Sin ella, el botón «Generar» de la vista de la inmobiliaria responde error.
1e. **Aplicar `supabase/migrations/202611080001_activity_purchase.sql`** (también se puede re-ejecutar): agrega el escalón 4, «Suscribió».
2. **Habilitar administradores**: agregar el email de cada cuenta del equipo a `ADMIN_EMAILS` en Vercel (separados por comas) y redeployar. La cuenta debe existir y tener el email verificado (Google o email confirmado). No hay ninguna forma de volverse administrador desde el navegador.
3. Opcional: si el equipo va a ambientar muchas fotos en un día, agregar esas cuentas también a `UNLIMITED_EMAILS` (cupo diario de 1000 en lugar de un tercio de `MAX_GENERATIONS_PER_DAY`).

Verificación de la migración (SQL Editor):

```sql
select has_table_privilege('anon','public.demos','select');            -- false
select has_function_privilege('authenticated',
  'public.amobla_reserve_demo_generation(uuid,uuid,uuid,text,text,text,text,text,integer)','execute'); -- false
```

## Crear una demo

1. Entrar con la cuenta administradora y abrir `/admin/demos` → **Crear nueva demo**.
2. Elegir una inmobiliaria ya cargada o crear una (nombre obligatorio; sitio, contacto y notas internas opcionales). No necesita cuenta en amoblaIA.
3. Completar la propiedad (título obligatorio; ubicación y descripción se ven en la demo; la URL original es interna) → **Crear y cargar fotos**.
4. Arrastrar las fotos (o tocar para elegirlas). Se optimizan en el navegador y se suben de a una.
5. En cada foto: elegir el ambiente, un nombre visible opcional y Amoblar (vacío) o Rediseñar (con muebles). Destildar las que se muestran como son (baños, fachadas, planos).
6. En **Estilos de la demo**, marcar hasta 6 estilos y elegir el **principal** (portada y vista previa de WhatsApp). **Ambientar N imágenes pendientes** genera cada foto marcada en cada estilo que le falte, de a una (una generación en curso por cuenta, como en el estudio). Se puede cerrar la pestaña: al volver, el editor retoma las que siguen en curso. Cada casillero también se puede ambientar o reintentar por separado.
7. Tocar cada versión para compararla con la original. Revisar paredes, aberturas, pisos, dimensiones y vistas. **Descartar** la quita (vuelve la versión anterior de ese estilo, si hay); **Regenerar** crea otra que la reemplaza. Lo que se ve en cada casillero es lo que muestra la demo.
8. En **Inmobiliaria**: logo (PNG, JPG, WebP o SVG; se guarda chico, con transparencia), colores principal y secundario, tipografía de títulos y **cómo la contactan los compradores**: el mismo canal que usa en su sitio (WhatsApp, formulario o página de contacto, teléfono o email). «Coordinar una visita» aparece solo si se carga un enlace real.
9. En **Propiedad**: la URL de la publicación original (se muestra como «Ver publicación original») y, si figuran en la publicación, operación, precio, características y código de referencia. No se muestra nada que no se cargue.
10. En **Al abrir la demo**: foto original (predeterminado) o ambientación predeterminada con un estilo de la primera foto; y si el enlace de presentación muestra la franja «Demo preparada para… · Por Amobla IA».
11. Ordenar con las flechas, ocultar fotos con el ojo y elegir la portada con la estrella. Destildar un estilo lo quita de la demo (sus versiones quedan en "Descartadas", recuperables).
11b. En **Antes de compartir**: los avisos privados (contacto faltante, precio en conflicto, sin mapa, estilos de otro tipo de inmueble, apertura no disponible), **Volver a leer la publicación** (compara título, ubicación, descripción e importes con la demo; nada se guarda hasta tocar «Usar el de la publicación» o «Marcar conflicto») y **Marcar como revisada** (guarda la fecha de revisión).
11c. En **Estilos de la demo**, el **tipo de inmueble**: con «Oficina» se ofrecen «Oficina ejecutiva» y «Equipo de trabajo» (escritorios, sillas de trabajo, guardado; nunca sofás, camas ni TV) y las ambientaciones residenciales dejan de mostrarse (no se borran ni se renombran: hay que generar las de oficina).
11d. En **Ficha de la propiedad**: operación, referencia, características, precio con moneda, conflicto de precio (privado), expensas, disponibilidad, requisitos, datos con íconos, descripción completa, características y servicios, mapa (precisión y coordenadas), agente asignado, texto del cierre y título/descripción para compartir.
12. **Vista previa** muestra exactamente la página pública, también en borrador, como comprador o como presentación.
13. **Publicar demo** → hay dos enlaces: **presentación** (`/demo/<token>?presentacion=1`, para la inmobiliaria, con la franja si está activada) y **compradores** (`/demo/<token>`, limpio). **Compartir por WhatsApp** le manda los dos a la inmobiliaria. **Despublicar** corta el acceso al instante; **Generar un enlace nuevo** invalida el anterior.

## Cómo funciona

### Autorización
- Mismo criterio que la administración existente (`requireAdmin`): cuenta verificada cuyo email está en `ADMIN_EMAILS`. Lo aplican las páginas (`requireAdminPage`, en el servidor: sin sesión → `/acceso`, sin permiso → 404), cada ruta de `/api/admin/demos/*` y la ruta de imágenes del panel.
- Las tablas nuevas tienen RLS activo y ningún permiso para `anon` ni `authenticated`: solo el servidor (service role) las lee. Los permisos de los usuarios normales no cambian.

### Generación y costos
- Las fotos se guardan como `projects` del administrador que las sube, en el bucket privado existente (`<usuario>/demos/<hash>.jpg`), con `original_hash = 'demo:<sha256>'`. Ese prefijo las separa de la biblioteca personal (no aparecen en Mis fotos) y evita mezclarlas con fotos del estudio.
- Cada ambientación pasa por `amobla_reserve_demo_generation`, que asocia el proyecto a una asignación `demo:<usuario>` **con saldo cero** y llama a la reserva normal (`amobla_reserve_batch`). Resultado: no se descuenta ningún crédito (ni de clientes ni de la cuenta del administrador), la calidad es la paga sin marca de agua, y siguen valiendo el bloqueo por cuenta, el presupuesto de almacenamiento y la idempotencia. Las demos no tienen cupo diario (se reserva con un tope de 1.000.000); sí cuentan en el total del día, así que muchas ambientaciones de demos pueden agotar el cupo global (`MAX_GENERATIONS_PER_DAY`) del estudio de los clientes ese día. Queda registro en `admin_audit` y el uso/costo en `generations`, como cualquier generación.
- El motor es el mismo (`runJob`, `renderPhoto`, `buildPrompt`) con sus restricciones arquitectónicas. Solo se ofrecen Amoblar y Rediseñar.
- Un usuario que no es administrador no puede llegar a esta función: la ruta exige admin y la función SQL solo la ejecuta el servidor.

### Página pública
- Solo existe si la demo está publicada; en borrador o despublicada responde 404. Se consulta en cada visita.
- Recibe únicamente nombre de la inmobiliaria, título, ubicación, descripción y las fotos visibles. Nunca notas, contacto, sitio, URL original, rutas de almacenamiento ni ids de cuentas.
- Las imágenes salen por `/demo/<token>/imagen/<foto>`, que vuelve a comprobar publicación y visibilidad, redimensiona y cachea 10 minutos en el CDN. Tras despublicar, la página deja de estar disponible al instante; una imagen ya cacheada puede seguir respondiendo hasta 10 minutos a quien tenga su URL exacta.
- Es la ficha de la inmobiliaria: su logo, colores y nombre; sin el encabezado ni el pie de amoblaIA, sin precios ni botones de suscripción. Solo «Tecnología de amoblaIA», discreto, al pie.
- Orden: encabezado (logo, Propiedad · Ubicación · Contacto, «Ver publicación original», «Consultar»), identificación (título, ubicación, operación, precio o «Consultar alquiler/precio», características), galería con ambientación opcional, datos con íconos, descripción (resumida con «Ver descripción completa» si es larga; las líneas con «-» son listas), características y servicios, ubicación, condiciones, tarjeta de contacto (agente con foto o iniciales, WhatsApp, alternativas, publicación original) y cierre («¿Te imaginás trabajando acá?» en oficinas) con «Coordinar una visita» solo por un canal real (enlace de visitas o WhatsApp).
- Precio: solo si está cargado y sin conflicto. Con un conflicto, el precio ni siquiera llega a la página.
- Mapa: OpenStreetMap, cargado al acercarse a la sección. Zona y ubicación aproximada se muestran como un área sin marcador, con las coordenadas redondeadas (≈1 km y ≈100 m) y el radio publicado por el sitio (zona: 700 m a 3 km, 1 km si no hay; aproximada: 150 m a 3 km, 300 m si no hay); solo una dirección exacta lleva marcador. Sin coordenadas, solo el texto. Cómo se detecta y cómo corregirlo: `docs/HABITA_INMOBILIARIAS.md`, sección 9.
- Contacto: primero el WhatsApp del agente, si no el canal de la inmobiliaria; sin contacto válido, la acción principal es «Ver publicación original».
- Galería única (flechas, contador, pantalla completa y miniaturas), sin categorías de ambientes ni nombres de ambientes en los textos alternativos. Cada foto abre con su original completa; junto a la foto, el panel «Imaginá tu oficina a tu estilo» (o «este espacio») con los estilos de esa foto (en el celular, debajo). Elegir un estilo activa el comparador al 50 % («Original» / «Ambientado con IA»; cada etiqueta se oculta cuando su lado casi no se ve); «Volver al original» lo quita. Cada foto recuerda su estado durante la visita; nada se traslada de una foto a otra. Las fotos sin ambientación ocultan el panel.
- Modo B (ambientación predeterminada): la primera foto abre ambientada en el estilo elegido, identificada, con «Comparar con original» y «Volver al original». Si esa foto no tiene ese estilo, abre con la original.
- En comparación, arrastrar sobre la foto mueve solo la barra; las flechas y miniaturas cambian de foto. Fuera de la comparación, deslizar cambia de foto.
- «Consultar a [Inmobiliaria]» usa el canal configurado; con WhatsApp prepara un mensaje con el título, la referencia y el enlace a la publicación, y el comprador decide enviarlo.
- Qué se muestra: por foto y estilo, la última versión terminada que no se descartó. Elegir un estilo solo muestra una imagen existente: nunca genera ni consume créditos. Si una imagen no carga, queda la original y se ofrece reintentar.
- Las ambientaciones se muestran en las proporciones de la original, sin deformar ninguna. La generación usa tamaño automático: si la ambientada vuelve con otra proporción, el comparador recorta sus bordes y la alineación puede no ser exacta.
- Metadatos Open Graph con imagen 1200×630 de la portada, mitad original y mitad en el estilo principal (`og=1`), con las etiquetas «Original» y «Ambientación ilustrativa con IA» (PNG pregenerados en `og-labels.ts`). Título y descripción configurables por propiedad. La imagen de vista previa no cambia cómo abre la galería. `noindex`.
- El comparador muestra ambas imágenes en el marco de la original, sin deformarlas ni cambiar de tamaño al activarse. El panel marca «Encuadre distinto al original» cuando una ambientación tiene otra proporción (más de 3 %): revisarla o regenerarla antes de publicar.

### Actividad de cada demo (lista del equipo)
- Cuatro escalones; cuenta el más alto alcanzado: **1 Ingresó** (visita a la página pública), **2 Interactuó** (primer clic en estilos, comparador o contacto, o descarga de una foto en la vista de demostración), **3 Creó su panel** (la inmobiliaria reclamó su cuenta; sirve para todas sus demos), **4 Suscribió** (la cuenta de la inmobiliaria compró créditos: un pago aprobado; sirve para todas sus demos).
- Cada visitante se identifica con un id aleatorio guardado en su navegador (`habita_visitante`), sin datos personales. Cada paso se cuenta una sola vez por visitante y demo.
- **Las visitas del equipo no cuentan**: el servidor descarta cualquier paso hecho con una sesión de administrador. En un navegador sin sesión, la visita sí cuenta; para no contarla, abrí el enlace ya logueado.
- Ruta: `POST /api/demo/<token>/actividad` (`{ visitor, kind }`, con `kind` en `visita`, `interaccion` o `descarga`). Responde siempre 204 para no revelar nada de la demo.
- Lectura: `demos.activity_level`, `activity_at` y `activity_visitors`, actualizadas por `habita_record_demo_activity` (solo `service_role`).
- Los botones de la lista: **Vista inmobiliaria** (con la franja) y **Vista comprador** (ficha limpia), ambos desde la vista previa del admin, que no registra nada. **Copiar enlace** copia el enlace de la inmobiliaria; si todavía no tiene cuenta, el enlace trae un código de invitación nuevo (uno por copia, de un solo uso). **Copiar enlace comprador** copia la ficha. **WhatsApp** envía solo el enlace de la inmobiliaria, sin texto armado.

### Atribución y analítica
- «Por Amobla IA» (solo en la franja del enlace de presentación) lleva a `/estudio?utm_source=demo_comercial&utm_medium=whatsapp&utm_campaign=demos_inmobiliarias&demo=<id>&inmobiliaria=<id>`.
- La página guarda `amoblaia_demo_ref` en `localStorage` y registra en PostHog las propiedades `demo_id` y `demo_inmobiliaria_id`, que acompañan los eventos siguientes del visitante (`registro`, `foto_subida`, …).
- Eventos: `demo_vista` (con `version`: comprador o presentación), `demo_estilo` (con `estilo`), `demo_original`, `demo_contacto` (con `canal`), `demo_publicacion_original`, `demo_visita` y `demo_cta_click` (el «Por Amobla IA» de la franja). Todos con `demo_id`, `demo_titulo`, `inmobiliaria` (nombre), `inmobiliaria_id`, `fotos` y `ambientadas`. PostHog solo envía en producción. La vista previa del panel no envía eventos.

## Límites conocidos
- Hasta 40 fotos y 6 estilos por demo; cada estilo es una imagen más por foto.
- Los estilos marcados que todavía no tienen ninguna versión se recuerdan solo en ese navegador hasta que se ambientan.
- Los originales y resultados cuentan en el espacio de la cuenta que los sube (320 MB) y en el presupuesto global (800 MB).
- Las ambientaciones son secuenciales (una generación en curso por cuenta).
- No incluye CRM, automatizaciones de WhatsApp, scraping, códigos promocionales ni panel de analítica (fuera del alcance del MVP).
