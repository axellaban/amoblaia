# Demos comerciales para inmobiliarias

Herramienta interna para preparar, con fotos reales de una inmobiliaria, una galería ambientada con IA y compartirla por WhatsApp con un enlace único.

- Panel privado: `/admin/demos` (también enlazado desde `/administracion`).
- Página pública: `/demo/<token>`, sin registro.

## Puesta en marcha

1. **Aplicar la migración** `supabase/migrations/202610260001_commercial_demos.sql` en Supabase (SQL Editor). Se puede re-ejecutar. Crea `agencies`, `demo_properties`, `demo_photos`, `demos` y la función `amobla_reserve_demo_generation`. Aplicarla **antes** de desplegar el código: sin ella el panel y la página pública responden error, pero el resto de la app funciona igual.
1b. **Aplicar `supabase/migrations/202610270001_demo_branding.sql`** (también se puede re-ejecutar): agrega `agencies.branding` (logo, colores, tipografía, canal de contacto, enlace de visitas) y `demos.settings` (modo de apertura, franja de presentación, operación, precio, características, referencia). Sin ella, la demo funciona igual pero abre con la foto original, sin marca propia ni botón de contacto, y el panel avisa que no puede guardar esos datos.
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
12. **Vista previa** muestra exactamente la página pública, también en borrador, como comprador o como presentación.
13. **Publicar demo** → hay dos enlaces: **presentación** (`/demo/<token>?presentacion=1`, para la inmobiliaria, con la franja si está activada) y **compradores** (`/demo/<token>`, limpio). **Compartir por WhatsApp** le manda los dos a la inmobiliaria. **Despublicar** corta el acceso al instante; **Generar un enlace nuevo** invalida el anterior.

## Cómo funciona

### Autorización
- Mismo criterio que la administración existente (`requireAdmin`): cuenta verificada cuyo email está en `ADMIN_EMAILS`. Lo aplican las páginas (`requireAdminPage`, en el servidor: sin sesión → `/acceso`, sin permiso → 404), cada ruta de `/api/admin/demos/*` y la ruta de imágenes del panel.
- Las tablas nuevas tienen RLS activo y ningún permiso para `anon` ni `authenticated`: solo el servidor (service role) las lee. Los permisos de los usuarios normales no cambian.

### Generación y costos
- Las fotos se guardan como `projects` del administrador que las sube, en el bucket privado existente (`<usuario>/demos/<hash>.jpg`), con `original_hash = 'demo:<sha256>'`. Ese prefijo las separa de la biblioteca personal (no aparecen en Mis fotos) y evita mezclarlas con fotos del estudio.
- Cada ambientación pasa por `amobla_reserve_demo_generation`, que asocia el proyecto a una asignación `demo:<usuario>` **con saldo cero** y llama a la reserva normal (`amobla_reserve_batch`). Resultado: no se descuenta ningún crédito (ni de clientes ni de la cuenta del administrador), la calidad es la paga sin marca de agua, y siguen valiendo el bloqueo por cuenta, el cupo diario global y por cuenta, el presupuesto de almacenamiento y la idempotencia. Queda registro en `admin_audit` y el uso/costo en `generations`, como cualquier generación.
- El motor es el mismo (`runJob`, `renderPhoto`, `buildPrompt`) con sus restricciones arquitectónicas. Solo se ofrecen Amoblar y Rediseñar.
- Un usuario que no es administrador no puede llegar a esta función: la ruta exige admin y la función SQL solo la ejecuta el servidor.

### Página pública
- Solo existe si la demo está publicada; en borrador o despublicada responde 404. Se consulta en cada visita.
- Recibe únicamente nombre de la inmobiliaria, título, ubicación, descripción y las fotos visibles. Nunca notas, contacto, sitio, URL original, rutas de almacenamiento ni ids de cuentas.
- Las imágenes salen por `/demo/<token>/imagen/<foto>`, que vuelve a comprobar publicación y visibilidad, redimensiona y cachea 10 minutos en el CDN. Tras despublicar, la página deja de estar disponible al instante; una imagen ya cacheada puede seguir respondiendo hasta 10 minutos a quien tenga su URL exacta.
- Es la publicación de la inmobiliaria: su logo, colores y nombre; sin el encabezado ni el pie de amoblaIA, sin precios ni botones de suscripción. Solo «Tecnología de amoblaIA», discreto, al pie.
- Galería única (flechas, contador, pantalla completa y miniaturas), sin categorías de ambientes. Cada foto abre con su original completa; en escritorio, junto a la foto, el panel «Imaginá este espacio a tu estilo» con los estilos de esa foto (en el celular, debajo). Elegir un estilo activa el comparador al 50 % («Original» / «Ambientado con IA»); «Volver al original» lo quita. Cada foto recuerda su estado (estilo, posición de la barra o vuelta al original) durante la visita; nada se traslada de una foto a otra. Las fotos sin ambientación ocultan el panel y la imagen usa todo el ancho.
- Modo B (ambientación predeterminada): la primera foto abre ambientada en el estilo elegido, identificada, con «Comparar con original» y «Volver al original». Si esa foto no tiene ese estilo, abre con la original.
- En comparación, arrastrar sobre la foto mueve solo la barra; las flechas y miniaturas cambian de foto. Fuera de la comparación, deslizar cambia de foto.
- «Consultar a [Inmobiliaria]» usa el canal configurado; con WhatsApp prepara un mensaje con el título, la referencia y el enlace a la publicación, y el comprador decide enviarlo.
- Qué se muestra: por foto y estilo, la última versión terminada que no se descartó. Elegir un estilo solo muestra una imagen existente: nunca genera ni consume créditos. Si una imagen no carga, queda la original y se ofrece reintentar.
- Las ambientaciones se muestran en las proporciones de la original, sin deformar ninguna. La generación usa tamaño automático: si la ambientada vuelve con otra proporción, el comparador recorta sus bordes y la alineación puede no ser exacta.
- Metadatos Open Graph con imagen 1200×630 de la portada, mitad original y mitad en el estilo principal (`og=1`). El título y la descripción del enlace de compradores son de la inmobiliaria. `noindex`.

### Atribución y analítica
- «Por Amobla IA» (solo en la franja del enlace de presentación) lleva a `/estudio?utm_source=demo_comercial&utm_medium=whatsapp&utm_campaign=demos_inmobiliarias&demo=<id>&inmobiliaria=<id>`.
- La página guarda `amoblaia_demo_ref` en `localStorage` y registra en PostHog las propiedades `demo_id` y `demo_inmobiliaria_id`, que acompañan los eventos siguientes del visitante (`registro`, `foto_subida`, …).
- Eventos: `demo_vista` (con `version`: comprador o presentación), `demo_estilo` (con `estilo`), `demo_original`, `demo_contacto` (con `canal`), `demo_publicacion_original`, `demo_visita` y `demo_cta_click` (el «Por Amobla IA» de la franja). Todos con `demo_id`, `inmobiliaria_id`, `fotos` y `ambientadas`. PostHog solo envía en producción. La vista previa del panel no envía eventos.

## Límites conocidos
- Hasta 40 fotos y 6 estilos por demo; cada estilo es una imagen más por foto.
- Los estilos marcados que todavía no tienen ninguna versión se recuerdan solo en ese navegador hasta que se ambientan.
- Los originales y resultados cuentan en el espacio de la cuenta que los sube (320 MB) y en el presupuesto global (800 MB).
- Las ambientaciones son secuenciales (una generación en curso por cuenta).
- No incluye CRM, automatizaciones de WhatsApp, scraping, códigos promocionales ni panel de analítica (fuera del alcance del MVP).
