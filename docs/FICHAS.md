# Estado actual, propuestas y fichas compartibles — 24 de octubre de 2026

Propuesta de valor: «Ayudá a tus clientes a imaginar cómo vivir en una propiedad, mostrando siempre su estado real junto a propuestas de ambientación virtual».

## Antes de publicar

1. **Aplicar en Supabase `supabase/migrations/202610240001_property_showcases.sql`** (SQL Editor; se puede re-ejecutar). Sin ella el estudio y la biblioteca siguen funcionando como antes, pero revisar propuestas, `/fichas`, `/ficha/…` y `/embed/…` responden error o «no disponible».
2. Opcional: `EMBED_FRAME_ANCESTORS` en Vercel para limitar qué sitios pueden insertar la ficha (por ejemplo `https://inmobiliaria.com.ar https://*.inmobiliaria.com.ar`). Vacía = cualquier sitio, solo en `/embed/`.
3. Redeploy. No requiere servicios ni dependencias pagas nuevas.

## Qué cambia

**Comparación.** En el estudio, cada propuesta se ve junto a la foto original con los títulos «Estado actual» y «Propuesta de ambientación virtual»: en paralelo en desktop y apiladas en el celular. El deslizador queda como vista alternativa. La vista ampliada muestra la propuesta con una miniatura del estado actual (un toque la amplía) y permite alternar con las flechas. Cambiar de variante o estilo no oculta el original.

**Rótulo.** «Ambientación virtual · Mobiliario agregado digitalmente», agregado por código (`src/lib/disclosure.ts`), nunca pedido al modelo:
- En pantalla, sobre la propuesta (estudio, ficha y embed).
- En las descargas, dibujado en el canvas. En Amoblar/Rediseñar/Vaciar es obligatorio; Mejorar foto y Atardecer conservan la opción de exportar sin rótulo y usan su propio texto.
- En las imágenes que reciben los compradores, quemado en el servidor (`stampDisclosure`, PNG pre-renderizado para no depender de fuentes). El rótulo de la página lo cubre en pantalla; una copia guardada o reenviada lo conserva.

**Generación.** Los prompts de Amoblar y Rediseñar limitan el cambio a muebles y decoración móviles: no repintar, no cambiar pisos ni aberturas, no tapar manchas, grietas ni humedad, no ampliar el ángulo ni hacer ver el ambiente más grande o luminoso. Los colores de las variantes aplican solo a muebles y textiles; «Lujo» habla de muebles con mármol, no de pisos. Un prompt reduce cambios, no los garantiza: por eso existe la revisión.

**Revisión.** Cada propuesta de Amoblar/Rediseñar de una cuenta verificada puede marcarse como revisada, quitarse la revisión o descartarse (`PATCH /api/proposals/:id`). Descartar la oculta del estudio y de las fichas; no devuelve fotos ni cambia los límites de variantes. Regenerar es el botón existente «Generar otra variante», con las reglas de créditos de siempre. No existe un modo de reforma o cambio de materiales; Vaciar, Mejorar foto y Atardecer siguen separados y nunca entran en una ficha.

**Descargas.** Foto original, propuesta con rótulo, comparativa vertical (celular/WhatsApp, 1280 px de ancho) y horizontal. Cada foto se escala completa, sin recortes ni deformaciones (`src/lib/comparison-layout.ts`). El botón de compartir del celular envía la comparativa vertical.

**Fichas (`/fichas`).** Título, inmobiliaria y logo opcionales, WhatsApp, y ambientes elegidos entre las fotos con propuestas. Cada ficha tiene un enlace `/ficha/<token>` (token aleatorio de 24 bytes) que se puede activar, desactivar o borrar.
- El comprador ve primero la foto real; «Explorá este ambiente amoblado» muestra la comparación y solo los estilos con propuestas revisadas. Un ambiente sin propuestas muestra solo el estado actual con un aviso.
- «Consultar por esta propiedad» y «Coordinar una visita» abren WhatsApp con el título, el enlace y, si corresponde, el ambiente y estilo. El comprador decide si envía.
- Nada de la ficha genera imágenes ni usa fotos del plan.
- Qué es público lo decide SQL (`amobla_public_showcase`, `amobla_public_showcase_asset`, solo `service_role`): ficha activa, ambientes con foto fuera de la papelera, propuestas revisadas y no descartadas. No viajan ids de cuenta, emails, nombres de archivo ni rutas.
- Las imágenes salen de `/ficha/<token>/imagen/<ref>`, que verifica la ficha en cada pedido: desactivar corta también las fotos (un navegador puede conservar una copia hasta 60 s). `Cross-Origin-Resource-Policy: same-origin`.
- Sin Meta Pixel, Google Ads, cabecera ni pie de amoblaIA. `noindex`.

**Embed (`/embed/ficha/<token>`).** Misma ficha, compacta y sin navegación. Es la única ruta enmarcable: `frame-ancestors *` (o `EMBED_FRAME_ANCESTORS`); el resto de la app pasó de solo `X-Frame-Options: DENY` a sumar `frame-ancestors 'none'`. «Insertar en mi web» da un iframe más un script opcional que ajusta la altura (solo acepta mensajes del origen de amoblaIA y de ese iframe). Requiere una web que permita iframes; si no, se comparte el enlace.

**Analítica (PostHog, solo producción).** `ficha_abierta`, `ambientacion_explorada`, `estilo_seleccionado`, `contacto_clic` (con `origen`: `enlace` o `embed`) y `comparativa_descargada`. Propiedades: id de ficha, número de ambiente, estilo, tipo de contacto. Sin nombres, teléfonos, emails ni texto libre. `contacto_clic` es un clic, no un mensaje enviado ni una visita. PostHog registra la URL de la página como siempre; en la ficha incluye el token, que ya es el enlace compartido.

## Cómo probar

- **Comparativa:** estudio → generar (o «Ver transformación de ejemplo») → «Lado a lado» / «Deslizador» → ampliar → «Descargar» → las cuatro opciones.
- **Revisión:** con cuenta verificada, abrir una foto con propuestas → «Marcar como revisada» / «Descartar». La miniatura revisada lleva un check.
- **Ficha:** `/fichas` → «Nueva ficha» → agregar ambientes → «Guardar ambientes» → «Ver ficha» en una ventana privada. Probar estilos, WhatsApp, desactivar y recargar.
- **Embed:** copiar el código de «Insertar en mi web» en una página HTML de otro dominio (o un bloque HTML personalizado). Desactivar la ficha y recargar: muestra «no disponible».

## Verificación realizada

- 247 tests (41 archivos), TypeScript, ESLint, `next build` y `npm audit` aprobados. Nuevos: `showcases-db` (SQL real en PGlite: permisos, RLS, qué es público, desactivar), `showcase-routes` (rutas públicas y privadas) y `showcase-shared` (WhatsApp, embed, layout sin recortes, prompts, cabeceras de enmarcado).
- Build de producción contra un doble de Supabase en HTTP que ejecuta las migraciones reales: 32 comprobaciones de punta a punta, incluido el iframe en otro origen con Chromium, el bloqueo de `/ficha` enmarcada, el ajuste de altura, el contexto de WhatsApp y la desactivación.
- Revisión visual desktop y 390 px de ficha, embed, estudio, visor y `/fichas`, y de las comparativas exportadas.

## Límites

- No se probó contra el Supabase real ni con una generación real de OpenAI: la fidelidad de los prompts nuevos se debe evaluar con fotos reales antes de prometer resultados.
- El rótulo quemado en el servidor usa DejaVu Sans; el de pantalla y las descargas, la fuente del sitio.
- Varias propuestas del mismo estilo se muestran como «Opción 1, 2…».
- El logo se guarda como JPG sobre blanco (el bucket solo admite JPG).
- No hay medición de vistas por ficha dentro del producto: los eventos quedan en PostHog.
