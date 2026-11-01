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

## Pendiente

| Ítem | Necesita |
| --- | --- |
| Probar el Clásico en el preview con una propiedad real: render, subida a Supabase y reproducción en **iPhone Safari** y desktop | Acceso al preview |
| 5C: clip IA por foto («Video IA» / «Ver en movimiento» en la demo) y Equilibrado | **Aprobación de proveedor y costo** (propuesta: fal.ai con Kling 2.6 Pro ~USD 0,35 o Veo 3.1 Fast ~USD 0,50 por clip de 5 s, a confirmar), `FAL_KEY`, prueba de calidad con fotos reales, precio en créditos |
| 5D: Cinematográfico | 5C validado |
| Música con licencia | Pistas con licencia comercial documentada |
| Navegadores sin WebCodecs (iOS < 17) | Hoy: mensaje claro y sugerencia de desktop |
