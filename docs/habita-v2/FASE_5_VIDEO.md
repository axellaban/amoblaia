# Habita V2 — Fase 5: Video

**Estado:** 5A (benchmark), 5B (video «Clásico» real) y 5C/5D (animación con IA por fal.ai: «Foto en movimiento» y «Recorrido cinematográfico») hechos en código. **Hoy los modos con IA se muestran como «Próximamente» y solo se usa el Clásico** (decisión del 03/11/2026). Se habilitan con `HABITA_VIDEO_AI=1` + `FAL_KEY` en Vercel y la migración `202611210001_video_ai.sql`, después de la prueba de calidad con fotos reales. «Equilibrado» también figura como «Próximamente».

## 5A — Benchmark y decisiones

[`docs/video/COMPETITOR_RESEARCH.md`](../video/COMPETITOR_RESEARCH.md): Pedra y BetterSpace (páginas públicas), precios por segundo de modelos imagen→video (Kling, Veo, Grok, Seedance, Wan), decisiones, riesgos y plan. REA no se ejecutó (requiere aprobación y sesión autorizada).

## 5B — Video «Clásico» (sin IA, sin créditos)

| Pieza | Archivo |
| --- | --- |
| Plan de escenas (puro): placa inicial con datos reales, una escena por foto con movimiento suave, fundidos, placa final con contacto | [`src/lib/video/plan.ts`](../../src/lib/video/plan.ts) |
| Render en el navegador: canvas → WebCodecs H.264 High → MP4 (`mp4-muxer`, MIT); leyenda «Ambientación virtual con IA» en fotos ambientadas | [`src/lib/video/render.ts`](../../src/lib/video/render.ts) |
| Jobs persistidos (`property_videos`), idempotentes por clave, completados solo si el MP4 está en el storage, abandonados → fallidos a los 30 min | [`src/lib/video/server.ts`](../../src/lib/video/server.ts) |
| API: GET (historial con links de 1 h), POST (crear + URL firmada de subida directa a Supabase, sin pasar por el límite de 4,5 MB de Vercel), PATCH (confirmar/fallar). Permisos con `requireDemoAccess` (viewer solo ve) | [`src/app/api/panel/videos/route.ts`](../../src/app/api/panel/videos/route.ts) |
| Pantalla `/panel/video`: propiedad → fotos sugeridas (ambientadas primero) y ordenables → estilo → formato 9:16/16:9 → resumen con costo («Sin créditos») → progreso con cancelar → preview, descargar MP4, compartir, historial | [`src/components/video-studio.tsx`](../../src/components/video-studio.tsx), [`src/app/panel/video/page.tsx`](../../src/app/panel/video/page.tsx) |
| Migración (aplicada el 01/11/2026): bucket privado `property-videos` (MP4, 100 MB, sin políticas públicas) y tabla `property_videos` sin acceso para `anon`/`authenticated` | [`202611190001_property_videos.sql`](https://github.com/axellaban/amoblaia/blob/claude/friendly-shannon-54k8z1/supabase/migrations/202611190001_property_videos.sql) |

**Equilibrado y Cinematográfico** se muestran con su descripción y «Próximamente: se habilita con la animación con IA»; no se pueden elegir y el servidor los rechaza (409) hasta habilitarlos. Nada simula un video que no existe.

**Visibilidad:** `/panel/video` y la tarjeta Video se ven en preview; en producción, cuando se active `NEXT_PUBLIC_HABITA_VIDEO=1` (recomendado ahora que el Clásico funciona de verdad).

### Evidencia

- **Render real verificado** en Chromium con el código de producción: MP4 vertical y horizontal, `h264 High`, 1080×1920 / 1920×1080, 30 fps, 441 cuadros, 14,7 s, ~8 MB; render ≈ 5 s con 4 fotos (salida de `ffprobe` en este documento).
- Cuadros del MP4: [`video-classic-vertical-frames.jpg`](../ux/habita-v2/evidencia/fase-5/video-classic-vertical-frames.jpg) (placa inicial · foto ambientada con leyenda · foto original · placa final) y [`video-classic-horizontal-crossfade.jpg`](../ux/habita-v2/evidencia/fase-5/video-classic-horizontal-crossfade.jpg) (fundido).
- Pantalla: [`video-studio-desktop.jpg`](../ux/habita-v2/evidencia/fase-5/video-studio-desktop.jpg), [`video-studio-mobile-viewport.jpg`](../ux/habita-v2/evidencia/fase-5/video-studio-mobile-viewport.jpg), [`video-studio-mobile.jpg`](../ux/habita-v2/evidencia/fase-5/video-studio-mobile.jpg) (datos ilustrativos).
- Tests: [`tests/video.test.ts`](../../tests/video.test.ts) — plan, recorte sin deformar, sugerencia, idempotencia, clave ajena, modos IA rechazados, completado solo con archivo en storage y bajo el límite, fallo con motivo, abandonados → fallidos, links solo para completados, migración (bucket privado MP4, constraints, sin acceso).

```
stream|codec_name=h264|profile=High|width=1080|height=1920|r_frame_rate=30/1|nb_frames=441
format|duration=14.700000|size=8080234
stream|codec_name=h264|profile=High|width=1920|height=1080|r_frame_rate=30/1|nb_frames=441
format|duration=14.700000|size=8195610
```

### Eventos PostHog

`video_section_viewed`, `video_property_selected`, `video_photos_selected`, `video_mode_selected`, `video_format_selected`, `video_generate_clicked`, `video_generation_started`, `video_generation_completed` (`duration_ms`, `video_ms`, `size_kb`, `credits_charged: 0`, `provider: browser`), `video_generation_failed` (`error_code`: `unsupported_browser`, `cancelled`, `api_<status>`, `render`), `video_preview_played`, `video_downloaded`, `video_shared`.

## 5C/5D — Animación con IA (fal.ai)

Decisión (03/11/2026): **fal.ai** con **LTX-2 Fast** (`fal-ai/ltx-2/image-to-video/fast`, USD 0,04 por segundo a 1080p; un clip de 6 s ≈ USD 0,24). Es la opción económica para empezar; el modelo se cambia con `FAL_VIDEO_MODEL` sin tocar el resto (Kling 2.6 Pro ≈ USD 0,35 por clip de 5 s como opción de mayor calidad, a probar). Sora quedó descartado: OpenAI cerró su API de video el 24/09/2026.

| Modo | Fotos | Créditos | Costo de proveedor estimado |
| --- | --- | --- | --- |
| Foto en movimiento | 1 (la primera del orden) | **3** | ≈ USD 0,24 (+ un reintento si falla) |
| Recorrido cinematográfico | 2 a 6 | **10** | ≈ USD 0,48–1,44 |

**Cómo funciona**

1. El estudio muestra el costo en créditos y pide confirmación. El servidor crea el video, **cobra los créditos antes de cualquier costo de proveedor** (`habita_video_charge`: primero los créditos que vencen antes, una fila de `credit_ledger` por bolsa usada, nunca dos veces el mismo video; nunca usa la prueba gratis) y manda cada foto a fal (la misma imagen que muestra el estudio, con su ambientación si se eligió, recortada a 16:9 y enviada como data URI: nada queda público; `X-Fal-Store-IO: 0`).
2. La consigna pide solo un movimiento de cámara y prohíbe agregar, sacar o cambiar objetos, personas o textos (`clipPrompt`).
3. Cada lectura del historial (el estudio la repite cada 6 s mientras anima) avanza los videos: consulta la cola de fal, copia cada clip terminado al bucket privado `property-videos` (`<inmobiliaria>/<propiedad>/<video>/clip-N.mp4`) y, si una foto falla, la reenvía **una vez**. El cron diario hace lo mismo con los videos que nadie volvió a mirar.
4. Con todos los clips guardados, **el navegador arma el MP4** con el mismo motor del Clásico (placas opcionales, fundidos, cualquiera de los 4 formatos), dibujando cada clip cuadro a cuadro, con la leyenda «Movimiento generado con IA» (o «Ambientación y movimiento con IA»). Si se cierra la página, el historial muestra «Clips listos» y «Terminar video»; un armado fallido se puede reintentar sin volver a pagar.
5. **Reintegro:** si fal no acepta las fotos, si una foto falla dos veces o si la animación pasa de 40 minutos, el video queda fallido y los créditos vuelven a las mismas bolsas, una sola vez (`habita_video_refund`). Un video fallido que todavía tenga créditos se reintegra en la lectura siguiente.

| Pieza | Archivo |
| --- | --- |
| Modos, créditos, fotos por modo, tiempos, consigna | `src/lib/video/plan.ts` |
| Cola de fal (enviar, estado, resultado, descarga; solo direcciones de fal) | `src/lib/video/fal.ts` |
| Inicio con cobro, avance, reintentos, reintegro, subida del armado | `src/lib/video/ai.ts` |
| Historial con avance de la IA y links a los clips | `src/lib/video/server.ts` |
| API: POST (modo IA), GET (avanza), PUT (dónde subir el armado), PATCH | `src/app/api/panel/videos/route.ts` |
| Armado con clips en el navegador | `src/lib/video/render.ts` (`loadClip`, `seekClips`) |
| Estudio: modos con costo («Próximamente» hasta activarlos), ventana de confirmación con saldo, avance por foto, «Terminar video» | `src/components/video-studio.tsx` |
| Migración: `property_video_clips`, `credit_ledger.video_id`, `payer_id`, `clips_ready_at`, funciones de cobro y reintegro | [`202611210001_video_ai.sql`](https://github.com/axellaban/amoblaia/blob/claude/video-ia-fal/supabase/migrations/202611210001_video_ai.sql) |
| Tests | `tests/video-ai.test.ts` |

**Quién paga:** la cuenta de la inmobiliaria (su dueño), como las ambientaciones. Desde la edición administrativa del equipo, una inmobiliaria con cuenta no se cobra (403, igual que las ambientaciones); el equipo puede usar «Entrar como la inmobiliaria».

**Activación:** la migración aplicada, `FAL_KEY` y `HABITA_VIDEO_AI=1` en Vercel. Sin `HABITA_VIDEO_AI=1` los modos IA se ven como «Próximamente» y el servidor los rechaza (409), aunque la clave esté cargada: así el equipo puede probar fal sin abrirlos a las inmobiliarias.

**Pantallas (diseño aprobado el 03/11/2026):** el editor de siempre con cuatro estilos (Clásico · Foto en movimiento 3 créditos · Recorrido cinematográfico 10 créditos · Equilibrado), una ventana de confirmación con el costo, el saldo y lo que queda (nada se cobra antes), el avance foto por foto en «Generar video», «Los clips con IA están listos · Terminar video» al volver, el armado con «Pausar» y el mismo «¡Video listo!».

**Eventos PostHog:** los mismos de video, con `provider: fal`, `credits_quoted`, `credits_charged`, `animated_photo_count`; errores nuevos `provider_submit` y `join_<paso>`.

## Crear video — versión definitiva (V1A)

Las tres entradas (propiedad existente, importar desde URL, subir fotos) terminan en el mismo editor `/panel/video?propiedad=<id>`. El sidebar (`PanelNav`) no cambió: captura antes/después idéntica píxel a píxel ([`00-sidebar-antes-despues.jpg`](../ux/habita-v2/evidencia/crear-video/00-sidebar-antes-despues.jpg)).

| Cambio | Dónde |
| --- | --- |
| Cuatro formatos reales: 9:16 (1080×1920), 16:9 (1920×1080), 4:5 (1080×1350), 1:1 (1080×1080). `VIDEO_FORMATS`, `VIDEO_SIZE`, `FORMAT_INFO`, `formatRatio`, `videoFileName` | `src/lib/video/plan.ts` |
| Información opcional: `planVideo(n, formato, { intro, outro })`; sin información el MP4 es solo fotos (sin placas ni textos). `videoCards` arma las placas solo con los campos elegidos y disponibles | `src/lib/video/plan.ts`, `src/lib/video/render.ts` |
| Placas centradas y medidas: se achican si no entran en el área segura (8 %) en ningún formato | `src/lib/video/render.ts` |
| Respeta «Mostrar en demostración»: la información sale de la ficha **con visibilidad aplicada**; lo oculto no llega al video. Grupos de fotos sin ficha: solo datos de la inmobiliaria | `src/app/panel/video/page.tsx` |
| Ancho, alto y cómo se hizo cada video (`options`: fotos en orden, ambientaciones sí/no, campos) → «Exportar en otro formato» sin volver a elegir fotos; cada formato es un MP4 propio en el historial | `src/lib/video/server.ts`, migración |
| Editor: barra (título, Guardado, Vista previa, Generar video · Sin créditos), Fotos y orden, Estilo (Clásico; Equilibrado/Cinematográfico «No disponible»), visor con los cuadros reales (`drawFrame` a media resolución) y tira ordenable (botones y arrastrar), Formato de exportación, Texto del video, Ubicación en la demostración, resumen, progreso real, errores con «Reintentar», «¡Video listo!» | `src/components/video-studio.tsx` |
| Selector compartido: para video, selección visual + «Continuar», buscador, miniaturas al subir; el grupo subido no crea ficha ni publica nada | `src/components/start-picker.tsx` |
| Ubicación por defecto de demostraciones **nuevas**: «Debajo de las fotos»; las existentes conservan la suya | `createDemo` en `src/lib/demos/server.ts` |
| Demo pública y editor: el reproductor usa la proporción real de cualquiera de los cuatro formatos | `demo-view.tsx`, `demo-editor.tsx` |

**Migración a aplicar:** [`202611200001_video_formats.sql`](https://github.com/axellaban/amoblaia/blob/claude/wizardly-meitner-9e5lzh/supabase/migrations/202611200001_video_formats.sql). Antes de aplicarla, 9:16 y 16:9 siguen funcionando (sin guardar `options`); 4:5 y 1:1 responden 409 con el nombre de la migración.

### MP4 reales (render en Chromium con el código de producción, 4 fotos)

```
codec_name=h264|profile=High|width=1080|height=1920|r_frame_rate=30/1|nb_read_frames=441|duration=14.7|size=8085602  vertical
codec_name=h264|profile=High|width=1920|height=1080|r_frame_rate=30/1|nb_read_frames=441|duration=14.7|size=8090199  horizontal
codec_name=h264|profile=High|width=1080|height=1350|r_frame_rate=30/1|nb_read_frames=441|duration=14.7|size=8009717  vertical-4x5
codec_name=h264|profile=High|width=1080|height=1080|r_frame_rate=30/1|nb_read_frames=441|duration=14.7|size=8051562  cuadrado
codec_name=h264|profile=High|width=1080|height=1080|r_frame_rate=30/1|nb_read_frames=321|duration=10.7|size=7837909  cuadrado, solo fotos
```

Los cinco se decodifican completos con `ffmpeg -f null`. Cuadros: `mp4-cuadros-*.jpg` en [`evidencia/crear-video`](../ux/habita-v2/evidencia/crear-video/).

### Capturas (datos ilustrativos, componentes reales)

`01a`–`01d` entradas · `02` editor · `03a/03b/03c` información activada/desactivada · `04` cuatro formatos · `05`/`06` vista previa 9:16, 16:9, 4:5, 1:1 · `07` progreso · `08` video listo · `09` ubicación · `10a`–`10d` mobile (sin scroll horizontal).

### Eventos PostHog nuevos

`video_photos_reordered`, `video_staged_toggled`, `video_info_toggled`, `video_draft_previewed`, `video_used_in_demo`. Los existentes suman `agency_id`, `property_id`, `video_id`, `video_mode`, `video_format`, `photo_count`, `duration_ms`, `device_type`, `is_group` (sin datos personales).

## Pendiente

| Ítem | Necesita |
| --- | --- |
| Probar el Clásico en el preview con una propiedad real: render, subida a Supabase y reproducción en **iPhone Safari** y desktop | Acceso al preview |
| Activar la animación con IA | Prueba de calidad aprobada, `202611210001_video_ai.sql` aplicada, `FAL_KEY` y `HABITA_VIDEO_AI=1` en Vercel |
| Prueba de calidad: 10 fotos reales de inmobiliarias con LTX-2 Fast (y Kling 2.6 Pro para comparar) | `FAL_KEY` y fotos |
| «Ver en movimiento» dentro de la demo pública y modo Equilibrado | Resultado de la prueba de calidad |
| Música con licencia | Pistas con licencia comercial documentada |
| Navegadores sin WebCodecs (iOS < 17) | Hoy: mensaje claro y sugerencia de desktop |
