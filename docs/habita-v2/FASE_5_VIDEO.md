# Habita V2 — Fase 5: Video

**Estado:** 5A (benchmark) y 5B (video «Clásico» real) hechos. 5C/5D (animación con IA) **esperan aprobación de proveedor y costo**. Los criterios de aceptación de la Fase 5 completa (tres modos utilizables) **no** están cumplidos todavía.

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
| 5C: clip IA por foto («Video IA» / «Ver en movimiento» en la demo) y Equilibrado | **Aprobación de proveedor y costo** (propuesta: fal.ai con Kling 2.6 Pro ~USD 0,35 o Veo 3.1 Fast ~USD 0,50 por clip de 5 s, a confirmar), `FAL_KEY`, prueba de calidad con fotos reales, precio en créditos |
| 5D: Cinematográfico | 5C validado |
| Música con licencia | Pistas con licencia comercial documentada |
| Navegadores sin WebCodecs (iOS < 17) | Hoy: mensaje claro y sugerencia de desktop |
