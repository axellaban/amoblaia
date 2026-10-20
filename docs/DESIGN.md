# Referencia visual y adaptación de amoblaIA

Auditoría: 20/10/2026. Fuente: https://www.virtualstagingai.app/ . Capturas públicas de escritorio (1280 px) y móvil (390 px), más cuenta y biblioteca autenticadas. La marca amoblaIA y las escenas propias se conservan.

## Evidencia y decisiones

Firecrawl identifica **Outfit** como familia principal y de titulares. Reporta acciones azules, superficies blancas, tarjetas grises y una cabecera azul noche. Las capturas visuales muestran acentos verde claro en la oferta destacada y checks. Los tokens de abajo son valores de implementación contrastados visualmente, no una afirmación de extracción exacta de todo el CSS del competidor.

| Rol | Implementación |
| --- | --- |
| Tipografía | Outfit, cargada con next/font |
| Fondo oscuro | #151a2d |
| Superficie secundaria oscura | #232940 |
| Acción principal | #3c59bf |
| Acción al pasar el cursor | #3046aa |
| Destacado | #cbff9a |
| Superficie de tarjeta | #eef0f8 |
| Texto principal | #161b26 |
| Texto secundario | #5c6170 |
| Borde | #e3e5ed |
| Fondo general | Blanco |

Contenedor de 1200 px incluyendo padding de 40 px. En móvil: 16 px laterales. Botones con radio de 12 px; fotos de 14–18 px; tarjetas grandes de 18–24 px. Titular del hero de 56 px en escritorio y 32 px en móvil. Estos tamaños se eligieron para reproducir la jerarquía y permitir texto en español.

## Recorridos observados y aplicados

- **Inicio:** cabecera oscura, hero en dos columnas, foto con selectores de ambiente/estilo, CTA de carga y ventajas. En móvil la foto aparece antes del texto. El CTA abre el estudio dentro del hero.
- **Estudio:** tarjeta blanca sobre fondo oscuro; opciones a la izquierda e imagen a la derecha en escritorio. Selectores compactos, foto original, miniaturas de resultados, comparación y descarga. La versión gratuita explica el acceso completo en una columna adicional.
- **Precios:** banda oscura, selector mensual/anual, cuatro tarjetas y plan destacado verde claro. El anual se muestra inicialmente, indicando importe completo. En móvil se puede expandir la lista de beneficios. Antes de salir a Mercado Pago se confirma plan, importe, renovación y email de pago.
- **Galería:** ambiente seleccionado, una imagen principal, pestañas de estilo y miniaturas. El deslizador antes/después es una opción adicional accesible.
- **Biblioteca:** cabecera clara, navegación por todas las fotos/sin carpeta/papelera y carpetas propias. Búsqueda, nombre, asignación, restauración y eliminación definitiva con confirmación.
- **FAQ:** buscador, filtros por categoría, acordeones y enlaces directos a preguntas.
- **Blog y recursos:** índice con tarjetas, artículos y páginas comerciales informativas.
- **Pie:** newsletter con consentimiento, enlaces principales y soporte. No expone nombre, CUIT ni email personal del titular.

## Adaptación argentina

Voseo, cobro en ARS con Mercado Pago, ocho ambientes (incluidos monoambiente y quincho) y diez estilos diversos. Sin estadísticas comerciales, reseñas, logos de prensa o afiliaciones del competidor. Los ejemplos son seis imágenes originales de dos ambientes; no se presentan como trabajos de clientes. No se promete el tiempo de 10 segundos ni almacenamiento perpetuo de la referencia.

## Límites observados

La cuenta de referencia utilizada no tiene un plan activo. Se observaron biblioteca, carpetas, papelera, configuración, páginas públicas y resultados gratuitos; el editor pago y sus pantallas posteriores a la contratación no pudieron validarse de extremo a extremo. El resultado implementado tiene su propio backend y no utiliza APIs privadas de la referencia. El blog contiene guías originales para Argentina, no una reproducción de todos los artículos del competidor.
