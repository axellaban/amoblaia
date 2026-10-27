# Prototipo interactivo de showcase · habita.

Prototipo de diseño aislado. No modifica fichas, membresías, créditos, producción ni main. No envía emails ni confirma visitas.

## Abrir sin el visor de archivos del chat

En GitHub, abrir `index.html`, usar el botón **Download raw file / Descargar archivo sin formato**, guardar el archivo y abrirlo con Chrome, Edge, Safari o Firefox. No requiere instalar nada. El archivo contiene su referencia visual y funciona sin servidor.

Ruta al servir la aplicación de esta rama:
`/prototipos/habita-showcase/index.html`

No hace falta mergear a main para revisarlo. Si Vercel genera un Preview de esta rama, usar esa ruta en el dominio del Preview. Publicación y disponibilidad del Preview requieren verificación independiente.

## Interacciones

- Portada con zoom/paneo sutil, pausa/reanudar y preferencia de movimiento reducido.
- Abrir galería desde Fotos, Ambientación o cualquiera de las vistas.
- Navegar con flechas, miniaturas y teclado. Escape cierra; diálogo nativo devuelve foco.
- Modos Original / Ambientado / Comparar y control de comparación cuando están disponibles las imágenes correspondientes.
- Secciones de datos y ubicación; resumen persistente al desplazar.
- Acciones de contacto y visita simuladas, sin envío real.
- Vista móvil y desktop.

## Fotos y fidelidad

El HTML incluye como respaldo recortes CSS de una referencia visual generada a partir de las capturas proporcionadas por el usuario. Están identificados como referencia recreada, no como originales reales. No se simula una comparación real entre esa referencia y una foto original inexistente.

Servido desde el mismo dominio que `/demo/T0hgjaFi5Tgnj9OEbAUDmaYa`, el prototipo intenta leer el HTML público de esa ficha y sus fotos. Extrae los originales de las miniaturas y las variantes expuestas para la foto inicial. El acceso es read-only, same-origin, con timeout y allowlist local de rutas de imagen. No pide credenciales ni envía datos a terceros.

Si la ficha no está disponible o se abre como archivo local, conserva la referencia recreada. Los modos Original/Comparar se desactivan si no hay fuentes reales. La ubicación es una referencia visual estática identificada, no una geocodificación.

## Límites

No es una implementación del panel ni un sustituto de la ficha existente. Los datos de ejemplo se tomaron de capturas y la superficie cubierta conflictiva está pendiente de confirmar. No se agregaron plano, cocina, dormitorios, agente, WhatsApp ni reseñas inexistentes.
