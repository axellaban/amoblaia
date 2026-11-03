# Video para Habita — benchmark y decisiones (Fase 5A)

**Fecha:** 01/11/2026. **Alcance:** solo páginas públicas. No se usaron sesiones autenticadas de Pedra ni de BetterSpace, ni se infirieron llamadas privadas. REA (`npx rea-agents setup`) **no se ejecutó**: requiere aprobación y una sesión autorizada; queda como paso opcional (ver §6).

Clasificación de cada afirmación: **[DOC]** documentación o página pública del proveedor · **[AGR]** agregador de terceros (puede estar desactualizado) · **[HIP]** hipótesis propia · **[NV]** no verificado.

## 1. Competidores

### BetterSpace — [betterspace.ai/ai-real-estate-video](https://betterspace.ai/ai-real-estate-video)
- **[DOC]** Flujo: subir fotos o pegar el link del aviso; la IA ordena las fotos, agrega transiciones y arma el video; se descarga o se publica.
- **[DOC]** Incluye música, narración (voz) y subtítulos generados automáticamente; logo y títulos de marca.
- **[DOC]** «Most property videos are ready in under 15 minutes». Cortes para Reels/TikTok/Stories/Shorts con tamaño automático.
- **[DOC]** Gratis: 2 videos por mes; planes pagos desde USD 29/mes. No publica costo por video ni por clip.
- **[NV]** Presets con nombre, formatos exactos, duración, formato de descarga.

### Pedra — [pedra.ai/es](https://pedra.ai/es)
- **[DOC]** Video de propiedad desde fotos (o filmación real en otra app) con voz, marca, música y subtítulos automáticos; versiones vertical y horizontal.
- **[DOC]** «Animar una foto» (foto → video) cuesta **5 créditos** y es la única acción de video que consume créditos; el video de propiedad figura como «Ilimitado» en el plan Pro (29 €/mes, 100 créditos).
- **[NV]** Tiempo de render, presets, biblioteca de música.

### Lectura para Habita **[HIP]**
1. Ambos separan **montaje** (barato/ilimitado) de **animación IA por foto** (cobrada): coincide con la spec (Clásico vs. Equilibrado/Cinematográfico).
2. El valor percibido viene de «pegar link → video listo» sin editor. Nuestro importador (Fase 1) ya resuelve la primera mitad.
3. Narración y música automáticas son estándar del mercado; para Habita v1 la música necesita licencia clara (§4) y la voz queda fuera de v1.

## 2. Modelos de imagen→video (clip IA de 5–8 s)

Precios por segundo de video, **sujetos a cambio**; confirmar en la página del proveedor antes de contratar.

| Modelo (vía fal.ai salvo indicación) | USD/s | Clip 5 s | Fuente |
| --- | --- | --- | --- |
| Kling 2.6 Pro (sin audio) | 0,07 | ~0,35 | [AGR fal.ai learn, 28/06/2026](https://fal.ai/learn/tools/best-image-to-video-apis-2026) |
| Grok Imagine Video 720p | 0,07 (+ fee por imagen) | ~0,35 | ídem; admite 9:16 y 16:9 |
| Veo 3.1 Fast (sin audio) | 0,10 | ~0,50 (máx. 8 s) | ídem; 16:9 y 9:16 |
| Kling v3 Pro (sin audio) | 0,112 | ~0,56 | ídem |
| Veo 3.1 (sin audio) | 0,20 | ~1,00 | ídem |
| Wan 2.2 i2v flash 480p | 0,015 | ~0,08 | [AGR developersdigest, 10/2026](https://www.developersdigest.tech/blog/image-video-generation-api-pricing-2026) (baja resolución) |

**[NV]** La página de precios de la Gemini API consultada hoy no lista Veo; los precios de Veo de la tabla son de fal.ai. **[NV]** Calidad de movimiento y conservación de la arquitectura en fotos de inmuebles argentinos: hay que medirla con 10 fotos reales antes de elegir (§6).

## 3. Decisiones de Habita (propuestas)

| Tema | Decisión | Por qué |
| --- | --- | --- |
| **Clásico** (fotos + transiciones + textos, sin IA) | **Render en el navegador** (canvas → WebCodecs/H.264 → MP4) y subida del MP4 al storage de Habita | Costo de proveedor cero, sin request de Vercel abierta durante el render, sin cola; funciona en Chrome/Edge y Safari 17+. Fallback documentado para navegadores sin WebCodecs. |
| Clips IA (clip individual, Equilibrado, Cinematográfico) | `VideoProvider` intercambiable; primer adaptador **fal.ai** (una API, varios modelos; cola asíncrona con webhook o polling) | Evita atarse a un modelo; permite empezar con Kling 2.6 Pro o Veo 3.1 Fast y cambiar por calidad/costo. **Requiere aprobación de costo y `FAL_KEY`.** |
| Estados | `video_jobs`: queued → processing → completed / failed (cancelled si el proveedor lo permite), persistidos e idempotentes | Spec §6.3. |
| Créditos | Clásico: **sin crédito** en v1 (costo de proveedor 0). Clip IA: crédito propio por clip, reserva/consumo/devolución atómica en falla técnica | Igual que el mercado (montaje ilimitado, animación cobrada). Precio en créditos a definir con el costo real medido. |
| Formatos | 9:16 (1080×1920) y 16:9 (1920×1080); 30 fps; H.264 MP4 | Reels/WhatsApp y portales. |
| Contenido | Solo fotos y datos reales de la propiedad (título, precio o «Consultar precio», ubicación, ambientes, m²) + logo y contacto de la inmobiliaria; leyenda «Ambientaciones con IA ilustrativas» cuando corresponda | Spec §6.2: no alucinar metraje. |
| Música | **Sin música en v1.** Se agrega solo con pistas de licencia clara (propias o con licencia comercial documentada) | Evita riesgo de derechos. |
| Voz / narración | Fuera de v1 | Costo y riesgo de errores de contenido. |

## 4. Riesgos

- **Derechos de música** (bloqueante para agregar música).
- **Safari iOS**: WebCodecs H.264 disponible desde Safari 17; en iPhone viejos el render del Clásico puede no estar disponible → mensaje claro y alternativa (desktop).
- **Costo IA descontrolado**: cuota por agencia por día y costo visible antes de confirmar; nunca generar sin confirmación.
- **Calidad del clip IA** (deformación de ambientes): prueba ciega con fotos reales antes de habilitar Equilibrado/Cinematográfico.

## 5. Plan por subfases

| Subfase | Contenido | Necesita |
| --- | --- | --- |
| **5A** | Este documento | — |
| **5B** | Sección Video real: elegir propiedad, fotos sugeridas/orden, formato, render Clásico en el navegador, MP4 guardado e historial; `video_jobs` + storage; eventos `video_*` | Nada externo |
| **5C** | Clip IA por foto («Video IA» / «Ver en movimiento») + Equilibrado (2 clips + montaje) vía fal.ai | **Aprobación de proveedor/costo + `FAL_KEY`**, prueba de calidad |
| **5D** | Cinematográfico (todas las fotos animadas, opt-in de costo) | 5C validado |

## 6. Pendiente de investigación con aprobación

- Recorrido autenticado de Pedra/BetterSpace (cuentas de prueba del usuario) con REA para documentar presets, orden, formatos y tiempos reales.
- Prueba de calidad de 2–3 modelos con 10 fotos reales de inmobiliarias de Mar del Plata.
