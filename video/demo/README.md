# Video demo de amoblaIA

Dos versiones del mismo video, listas para usar:

| Archivo | Formato | Para |
|---|---|---|
| [`out/amoblaia-horizontal.mp4`](out/amoblaia-horizontal.mp4) | 1920 × 1080, 34 s | web, YouTube, LinkedIn, presentaciones y llamadas de venta |
| [`out/amoblaia-vertical.mp4`](out/amoblaia-vertical.mp4) | 1080 × 1920, 34 s | Reels, TikTok, Shorts, estados de WhatsApp y anuncios |

H.264 + AAC a 30 cuadros, volumen normalizado a −14 LUFS (el estándar de las redes).

## Qué muestra

1. **Gancho:** el living vacío se amobla con una línea que lo recorre («Un ambiente vacío no enamora a nadie»).
2. **La web real:** home → «Subí una imagen gratis» → estudio. Se arrastra la foto, se elige el estilo Nórdico en el menú, se escribe el toque personal y se toca «Crear 3 diseños gratis». Una línea pinta los muebles sobre la foto.
3. **Antes y después:** comparador a pantalla completa (en vertical, antes arriba y después abajo).
4. **8 ambientes · 10 estilos:** grilla con quincho, balcón, cocina, comedor, home office y dormitorio.
5. **Cierre:** logo, «Probalo gratis en amoblaia.vercel.app», sin registro ni tarjeta.

## Cómo está hecho

- **La interfaz es la real.** Playwright navega la web, guarda capturas a 2x y la posición de cada botón y campo (`capture/*.mjs` → `public/amoblaia/shots.json`).
- **[Remotion](https://www.remotion.dev)** (video con React) anima encima: cursor con clics, cámara que acerca y sigue la acción, tipeo, menús, textos y transiciones. El motor está en `src/engine` y el guion del video en `src/amoblaia/script.ts` (tiempos, cámara y cursor) y `src/amoblaia/Video.tsx` (escenas y textos).
- **Horizontal y vertical salen de la misma composición:** en vertical la cámara se acerca más y los textos van arriba.
- **Sonido:** música de Mixkit («Digital Clouds», de Alejandro Magaña, [licencia libre de Mixkit](https://mixkit.co/license/#musicFree), uso comercial permitido dentro del video). Como la licencia no permite redistribuir el archivo suelto, no se versiona: `npm run music` lo baja a `public/music/`. Los clics, teclas y destellos se generan con `scripts/make-sfx.py` (sin licencias de terceros).
- **Licencia de Remotion:** es gratis para personas y empresas de hasta 3 empleados; las más grandes necesitan una [licencia de empresa](https://www.remotion.dev/license).

## Datos y honestidad

- Se captura **producción en modo demo**: no se genera nada ni se gasta API. El script bloquea cualquier POST que pueda generar costo.
- La foto «subida» (`capture/assets/depto-palermo.jpg`) es el living de ejemplo de `public/ejemplos`. El resultado es el ejemplo precargado del mismo living en estilo Nórdico (imagen real del motor). En esa captura se reemplazan los textos «Ejemplo» por el nombre del archivo para que el recorrido siga una sola foto.
- La prueba gratis entrega con marca de agua; el video lo aclara en la nota al pie del cierre.

## Comandos

Desde `video/demo` (Node 22 o más nuevo). Es un proyecto aparte: no se instala con la app ni entra en su build, lint o tests.

```bash
npm ci
npm run studio                 # vista previa interactiva en el navegador
npm run render                 # baja la música y renderiza out/amoblaia-horizontal.mp4 y out/amoblaia-vertical.mp4
npm run stills -- 90,300       # cuadros sueltos en out/stills para revisar
npx tsx scripts/marks.ts amoblaia   # cuadros clave del guion
npm run typecheck
```

Para recapturar la web (si cambió la interfaz):

```bash
node capture/amoblaia.mjs            # producción, modo demo
python3 capture/optimize.py public/amoblaia
```

Si cambian los botones de lugar, el cursor los sigue solo (las cajas salen de la captura); si cambia el flujo, se ajusta `src/amoblaia/script.ts`.
