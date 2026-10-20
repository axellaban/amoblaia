# Sistema visual de amoblaIA

La primera versión del MVP tomaba colores, tipografía y jerarquía de un competidor (Virtual Staging AI). Desde octubre de 2026 amoblaIA tiene identidad propia: los tokens viven en `:root` de `src/app/globals.css` y el logo en `src/components/shell.tsx`.

## Concepto

**La puerta a tu próximo hogar.** El isotipo es un arco de puerta, presente en la arquitectura de toda Latinoamérica, con un banco adentro (un espacio ya amoblado) y una chispa que representa la IA. El 404 retoma la idea: «Esta puerta no lleva a ningún ambiente».

Tono: cálido, editorial y concreto, como una revista de casas, no como una herramienta técnica. Las fotos de propiedades son las protagonistas; la interfaz las enmarca con colores de materiales reales (terracota, revoque y vegetación).

## Logo

| Pieza                        | Uso                                                       |
| ---------------------------- | --------------------------------------------------------- |
| `LogoMark` (SVG en código)   | Header, footer y cualquier lugar de la app                |
| `src/app/icon.svg`           | Favicon                                                   |
| `src/app/apple-icon.png`     | Ícono al agregar a pantalla de inicio en iOS              |
| `public/brand/*-oscuro.png`  | Logo horizontal sobre fondos oscuros                      |
| `public/brand/*-claro.png`   | Logo horizontal sobre fondos claros                       |
| `public/brand/*-isotipo-512` | Avatar para redes, WhatsApp Business, Mercado Pago, Google |

Wordmark: «amobla» en Fraunces 600 (SOFT 100, WONK 1) y «IA» en Manrope 800, en arcilla sobre oscuro o en terracota sobre claro. Mantener un margen libre alrededor del isotipo igual a la altura de la chispa. No rotar, no cambiar los colores del isotipo y no usarlo sobre fotos sin una superficie sólida.

## Paleta

| Token               | Valor     | Uso                                                        |
| ------------------- | --------- | ---------------------------------------------------------- |
| `--terracotta`      | `#B4472A` | Única acción principal, acentos sobre claro, isotipo       |
| `--terracotta-dark` | `#983A21` | Hover de la acción principal                               |
| `--forest`          | `#14271F` | Header, hero, secciones oscuras, footer                    |
| `--forest-light`    | `#1D3229` | Superficies sobre verde (barras, tarjetas)                 |
| `--clay`            | `#F2B39A` | Acentos sobre verde: remates de titulares, «IA», detalles  |
| `--paper`           | `#FAF6F0` | Fondo general, revoque cálido                              |
| `--sand`            | `#EFE6DA` | Bandas y superficies secundarias                           |
| `--ink`             | `#1F1C19` | Texto principal                                            |
| `--muted`           | `#6E655C` | Texto secundario                                           |
| `--line`            | `#E8DFD3` | Bordes                                                     |

Contrastes verificados (WCAG): blanco sobre terracota 5,4:1; terracota sobre papel 5,0:1; arcilla sobre verde 8,7:1; texto secundario sobre papel 5,3:1. Hay **un solo color de acción**: todo botón principal es terracota. Los botones oscuros u outline quedan para acciones secundarias.

## Tipografía

- **Fraunces** (display, variable con ejes SOFT, WONK y opsz): `h1`, `h2`, logo y títulos destacados.
- **Manrope** (interfaz y lectura): texto, botones, formularios y etiquetas.
- **Firma de marca:** la frase de cierre de cada titular va en Fraunces itálica, en terracota sobre claro o en arcilla sobre verde. Se marca con un `<span>` dentro del `h1`/`h2` («Mostrá *un hogar.*»).
- Texto base 16 px. Ningún texto baja de 11 px; las etiquetas en mayúsculas usan 11–12 px con tracking de 0,14 em.

## Forma

- Botones tipo píldora, con sombra cálida suave en la acción principal.
- Tarjetas con radio de 10–12 px y bordes de 1 px en `--line`.
- La banda de cierre usa dos arcos de línea fina que repiten el isotipo.

## Experiencia

- Header con una sola acción principal («Ir al estudio»); menú compacto en mobile.
- En mobile, el titular del hero ocupa tres líneas para que el comparador antes/después asome en la primera pantalla, y el CTA ocupa el ancho completo.
- En el estudio, el botón de generar queda fijo al pie de la pantalla en mobile mientras se recorren las opciones.
- Precios: cuatro planes a lo ancho del contenedor, cinta «Para tu cartera» sobre la tarjeta destacada y estado «Próximamente» discreto mientras no haya precio.
- Comparador accesible con teclado, foco visible en terracota y respeto de `prefers-reduced-motion`.

## Imágenes

`src/app/opengraph-image.png` es la imagen al compartir enlaces (1200 × 630): hero con titular y antes/después del living de ejemplo. Las escenas de `public/ejemplos/` son ficticias, creadas con IA e identificadas como ilustrativas; ver ASSETS.md.
