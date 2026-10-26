# Demos comerciales para inmobiliarias

Herramienta interna para preparar, con fotos reales de una inmobiliaria, una galería ambientada con IA y compartirla por WhatsApp con un enlace único.

- Panel privado: `/admin/demos` (también enlazado desde `/administracion`).
- Página pública: `/demo/<token>`, sin registro.

## Puesta en marcha

1. **Aplicar la migración** `supabase/migrations/202610260001_commercial_demos.sql` en Supabase (SQL Editor). Se puede re-ejecutar. Crea `agencies`, `demo_properties`, `demo_photos`, `demos` y la función `amobla_reserve_demo_generation`. Aplicarla **antes** de desplegar el código: sin ella el panel y la página pública responden error, pero el resto de la app funciona igual.
2. **Habilitar administradores**: agregar el email de cada cuenta del equipo a `ADMIN_EMAILS` en Vercel (separados por comas) y redeployar. La cuenta debe existir y tener el email verificado (Google o email confirmado). No hay ninguna forma de volverse administrador desde el navegador. Para dar acceso solo al panel de demos (sin cobros ni el resto del admin) sin tocar Vercel, agregar el email a `DEMO_EDITOR_EMAILS` en `src/lib/commerce/http.ts`.
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
5. En cada foto: elegir el ambiente, un nombre visible opcional y Amoblar (vacío) o Rediseñar (con muebles).
6. **Ambientar con IA** en una foto, o seleccionar varias y **Ambientar seleccionadas** con un estilo. Se procesan de a una (una generación en curso por cuenta, como en el estudio). Se puede cerrar la pestaña: al volver, el editor retoma las que siguen en curso.
7. Tocar cada propuesta para compararla con la original. Revisar paredes, aberturas, pisos, dimensiones y vistas. **Aprobar para la demo** o **Descartar**. **Regenerar con IA** crea otra propuesta.
8. Ordenar con las flechas, ocultar fotos con el ojo y elegir la portada con la estrella (es la imagen del enlace en WhatsApp).
9. **Vista previa** muestra exactamente la página pública, también en borrador.
10. **Publicar demo** → **Copiar enlace** o **Compartir por WhatsApp**. **Despublicar** corta el acceso al instante; **Generar un enlace nuevo** invalida el anterior.

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
- Transparencia: aviso completo arriba y al pie, etiqueta «Ambientación virtual con IA» en cada foto modificada y la original siempre disponible (comparador o botón).
- Metadatos Open Graph con imagen 1200×630 de la portada, para la vista previa de WhatsApp. `noindex`.

### Atribución y analítica
- «Probar amoblaIA» lleva a `/estudio?utm_source=demo_comercial&utm_medium=whatsapp&utm_campaign=demos_inmobiliarias&demo=<id>&inmobiliaria=<id>`.
- La página guarda `amoblaia_demo_ref` en `localStorage` y registra en PostHog las propiedades `demo_id` y `demo_inmobiliaria_id`, que acompañan los eventos siguientes del visitante (`registro`, `foto_subida`, …).
- Eventos: `demo_vista` y `demo_cta_click` (con `demo_id`, `inmobiliaria_id`, `fotos`, `ambientadas`). PostHog solo envía en producción. La vista previa del panel no envía eventos.

## Límites conocidos
- Hasta 40 fotos por demo. Los originales y resultados cuentan en el espacio de la cuenta que los sube (320 MB) y en el presupuesto global (800 MB).
- Las ambientaciones son secuenciales (una generación en curso por cuenta).
- No incluye CRM, automatizaciones de WhatsApp, scraping, códigos promocionales ni panel de analítica (fuera del alcance del MVP).
