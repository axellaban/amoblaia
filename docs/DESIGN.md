# Sistema visual de amoblaIA

Referencia: https://www.virtualstagingai.app/ — observada el 20 de octubre de 2026 con navegador, HTML público y Firecrawl (branding, markdown, HTML y screenshot). La inspección visual del navegador prevalece sobre la clasificación automática de Firecrawl, que describía la página como clara pese al hero oscuro observado.

## Extraído de la referencia

- Familia tipográfica **Outfit**: reportada por branding y comprobada en el HTML servido.
- Hero y navegación azul noche, titulares blancos y detalles verdes suaves: observados en screenshot.
- CTA principal azul (`#2E5FCB` reportado por branding), imágenes de propiedades protagonistas y selectores de ambiente/estilo sobre la presentación.
- Jerarquía: navegación → propuesta de valor y ejemplo → atributos → galería → beneficios → pasos → comparación de servicio → FAQ → CTA → footer.
- Imágenes con esquinas redondeadas, botones compactos, espacios amplios y contraste alto en el hero.

## Adaptación implementada

La experiencia y la jerarquía parten de esa referencia; los textos, la marca, el código y el estudio de trabajo se implementaron para amoblaIA. No se afirma equivalencia píxel a píxel ni se reutilizan afirmaciones de Harvard, testimonios, logos de medios o cifras comerciales del producto original.

| Token                | Valor implementado       | Procedencia                               |
| -------------------- | ------------------------ | ----------------------------------------- |
| Fondo oscuro         | `#161C2E`                | Aproximación visual al hero de referencia |
| Texto                | `#171D30`                | Elección de implementación                |
| Verde de acento      | `#C4ED9A`                | Aproximación visual al acento observado   |
| CTA azul             | `#3766D2`                | Adaptación del azul reportado             |
| Fondo claro          | `#FAFBF8`                | Elección de implementación                |
| Fondo estudio        | `#F5F6F2`                | Elección de implementación                |
| Fuente               | Outfit                   | Extraída                                  |
| Contenedor           | 1260 px, padding 40 px   | Elección de implementación                |
| Bordes               | 5–12 px de radio         | Elección inspirada en la referencia       |
| Puntos de adaptación | 600, 800, 1050 y 1450 px | Elección de implementación                |

## Componentes

- Header azul noche con marca amoblaIA, navegación y CTA al estudio. Menú compacto en móvil.
- Hero de dos columnas con comparador manipulable y selectores; apilado en pantallas pequeñas.
- Galería de tres columnas en desktop, una en móvil. Cada tarjeta tiene comparador y caption.
- Estudio de trabajo claro con canvas y controles laterales. En móvil se apilan foto y configuración.
- Modos de edición en selector segmentado; ambientes en grilla de iconos; estilos con muestras de color.
- Modal de acceso con foco inicial, captura de tabulación y cierre por Escape.
- Estados de espera y error legibles. La demo está separada explícitamente de generación real.
- Rango nativo accesible para el comparador, etiquetas en formularios, foco visible y respeto de `prefers-reduced-motion`.

## Imágenes

Los archivos locales y sus fuentes están en ASSETS.md. Se preserva la pareja antes/después sin inventar variantes: solo el dormitorio tiene seis estilos de ejemplo; el resto muestra el estilo moderno. Los siete estilos se ofrecen para generación real con fotos propias.

## Límites de fidelidad

No se inspeccionó una cuenta privada ni se accedió al historial de usuarios del sitio original. El estudio, el acceso de piloto y la persistencia local son decisiones del MVP. Los estados privados del producto original no se presentan como reconstruidos.
