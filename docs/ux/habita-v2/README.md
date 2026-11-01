# HABITA V2 — paquete de implementación

**Archivo de instrucciones principal:** `HABITA_V2_SPEC_AND_CLAUDE_PROMPT.md`.

## Prioridad de referencias

1. **La especificación Markdown manda siempre** sobre detalles visuales que difieran (las imágenes representan estados de la evolución).
2. `visual_references/final-panel-desktop.png`: **REFERENCIA FINAL** del look & feel del panel: solo 3 CTA grandes en home, barra izquierda con Sitio web y 4 módulos futuros (Tour 360 / Planos / Redes / API) sin «Próximamente» en sidebar. Este mockup es la base para el panel.
3. `visual_references/demo-desktop-and-mobile-design.png`: referencia de la demo en desktop y el diseño base responsive (slider, estilos, CTA, ficha debajo).
4. `visual_references/demo-mobile-and-listing-details.png`: **referencia más avanzada** de la interacción mobile, lápiz/crear video en estilos, descargar/compartir, crear propiedad y ficha completa debajo.
5. `visual_references/future-feature-page-example.png`: referencia del estado futuro **solo del contenido principal** tras clic en Tour 360: ilustración, «Próximamente», opt-in. **Ignorar** cualquier badge «Próximamente» que aparezca en la navegación del ejemplo: la decisión final prohíbe esos badges.
6. `visual_references/current-mobile-demo-*.{jpeg,png}`: screenshots del estado existente, para comparar y detectar regresiones; **no** son el diseño final.

## Reglas de interpretación de mockups

- Datos, nombres de propiedades, número de fotos, precios y fotos en los mockups son **ilustrativos**. Nunca hardcodearlos ni inventar información real.
- «Guardar panel» aparece en algunos mockups; en producción debe verse solo cuando el visitante esté en demo temporal y todavía deba guardar su espacio, no para usuarios ya autenticados.
- «Ver en movimiento» debe aparecer solo si hay clip generado. Nunca habilitar un botón de video falso.
- La decisión definitiva de Home es **tres tarjetas solamente**: Crear demostraciones, Estudio de imágenes, Video.
- Los cuatro módulos de futuro aparecen **solo en sidebar**, clicables, sin etiquetas Próximamente. Su página interna declara «Próximamente» y mide interés explícito.
- La demo está concebida como **dentro de un panel temporal de inmobiliaria**. Integrar contexto de inmobiliaria/guardar/precios con la interfaz limpia de foto y estilos.
- No reproducir el navegador/chrome de los screenshots en la interfaz de la aplicación.

## Cómo usar el paquete

1. Extraer el ZIP dentro o junto al repositorio `amoblaia` (recomendado en `docs/habita-v2/`).
2. En Claude Code, abrir `HABITA_V2_SPEC_AND_CLAUDE_PROMPT.md` y seguir la sección **«Al iniciar esta ejecución»**.
3. Auditar la rama realmente descargada antes de modificar código. Crear rama de trabajo; no hacer merge a `main` sin aprobación.
4. Ejecutar en fases con tests, capturas del preview de Vercel y comparativa contra estas imágenes.
